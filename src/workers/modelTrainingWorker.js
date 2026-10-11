// =====================================================================
//  RECOMENDADOR DE PLANOS DE SAÚDE: o "cérebro" do sistema
// =====================================================================
//
//  O QUE ESTE ARQUIVO FAZ
//  Ele aprende com os beneficiários que já existem (quem contratou o quê)
//  e depois indica quais planos e serviços combinam com cada pessoa.
//
//  ONDE ELE RODA
//  Num "Web Worker": um ajudante do navegador que trabalha em paralelo,
//  para a tela não travar enquanto a rede neural treina.
//  A tela manda pedidos ("treine!", "recomende para fulano!") e este
//  arquivo responde com mensagens (postMessage).
//
//  DE ONDE VEIO
//  É o mesmo sistema de recomendação da loja (Módulo 3 da Disciplina 01),
//  com os "produtos" trocados por planos de uma operadora FICTÍCIA.
//  Os nomes dos campos foram mantidos iguais aos da aula:
//
//      campo do código  →  significado aqui
//      ---------------     ----------------------------------------------
//      category         →  segmento (Ambulatorial, Completo, Odontológico,
//                          Serviço adicional)
//      color            →  abrangência (Municipal, Regional, Nacional)
//      price            →  mensalidade em R$
//      purchases        →  planos e serviços que o beneficiário contratou
//
//  AS 7 ETAPAS (na ordem em que aparecem abaixo)
//      1. Configurações (pesos)
//      2. Contexto: preparar os dados
//      3. Transformar um PLANO em números
//      4. Transformar um BENEFICIÁRIO em números
//      5. Montar os exemplos de treino
//      6. Criar e treinar a rede neural
//      7. Recomendar
// =====================================================================

// Biblioteca de IA do Google para JavaScript (baixada da internet).
import 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
// Nomes das mensagens trocadas com a tela (ex.: "trainModel", "recommend").
import { workerEvents } from '../events/constants.js';

console.log('Worker do recomendador de planos iniciado');

// Memória do worker: guardamos aqui o contexto e a rede depois do treino,
// para poder recomendar mais tarde sem treinar de novo.
let _globalCtx = {};
let _model = null;


// =====================================================================
// ETAPA 1: CONFIGURAÇÕES
// =====================================================================

// Importância de cada característica de um plano (soma = 1).
// O segmento pesa mais: quem tem odonto tende a se interessar por outros
// serviços parecidos; quem tem plano completo, por complementos.
// (Foi o desafio da aula 3: mudar esses números muda o que é "parecido".)
const WEIGHTS = {
    category: 0.4, // segmento
    color: 0.3,    // abrangência
    price: 0.2,    // mensalidade
    age: 0.1,      // idade média de quem costuma contratar o plano
};

// Peso da idade do PRÓPRIO beneficiário. É bem maior que os outros porque,
// em plano de saúde, a idade é o que mais muda a necessidade da pessoa.
// (Melhoria em relação à aula: lá a idade quase não influenciava.)
const USER_AGE_WEIGHT = 1.0;

// Segmentos que são "plano principal". Quem já tem um deles não recebe
// indicação de outro plano principal, só de serviços complementares.
const PLANOS_PRINCIPAIS = ['Ambulatorial', 'Completo'];

// Normalização: coloca qualquer número na escala de 0 a 1.
// Fórmula: (valor - mínimo) / (máximo - mínimo)
// Exemplo: idades de 19 a 75 → 47 anos vira (47-19)/(75-19) = 0,5
// O "|| 1" evita divisão por zero se máximo e mínimo forem iguais.
const normalize = (value, min, max) => (value - min) / ((max - min) || 1);


// =====================================================================
// ETAPA 2: CONTEXTO (preparar os "ingredientes")
// Calcula uma vez só as informações que as etapas seguintes vão usar.
// =====================================================================
function makeContext(users, catalog) {
    // Faixas de idade e de mensalidade (para a normalização).
    const ages = users.map(u => u.age);
    const prices = catalog.map(p => p.price);
    const minAge = Math.min(...ages);
    const maxAge = Math.max(...ages);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);

    // Lista de abrangências e segmentos diferentes, sem repetir.
    const colors = [...new Set(catalog.map(p => p.color))];
    const categories = [...new Set(catalog.map(p => p.category))];

    // Dá um número de posição para cada um, ex.: { Municipal: 0, Regional: 1, Nacional: 2 }
    // (usado no one-hot: "qual interruptor acender").
    const colorsIndex = Object.fromEntries(colors.map((color, index) => [color, index]));
    const categoriesIndex = Object.fromEntries(categories.map((category, index) => [category, index]));

    // Idade média de quem contratou cada plano.
    // Ex.: o "Sênior Completo" é contratado por pessoas mais velhas.
    // Somamos as idades e contamos quantas pessoas contrataram cada plano.
    const midAge = (minAge + maxAge) / 2;
    const ageSums = {};
    const ageCounts = {};
    users.forEach(user => {
        user.purchases.forEach(p => {
            ageSums[p.name] = (ageSums[p.name] || 0) + user.age;
            ageCounts[p.name] = (ageCounts[p.name] || 0) + 1;
        });
    });

    // Média = soma ÷ quantidade (já normalizada de 0 a 1).
    // Plano que ninguém contratou recebe a idade do meio da faixa.
    const productAvgAgeNorm = Object.fromEntries(catalog.map(product => {
        const avg = ageCounts[product.name] ? ageSums[product.name] / ageCounts[product.name] : midAge;
        return [product.name, normalize(avg, minAge, maxAge)];
    }));

    return {
        products: catalog, users,
        minAge, maxAge, minPrice, maxPrice,
        colorsIndex, categoriesIndex, productAvgAgeNorm,
        numCategories: categories.length,
        numColors: colors.length,
        // Tamanho do vetor de um plano:
        // 1 (mensalidade) + 1 (idade) + nº de segmentos + nº de abrangências
        dimentions: 2 + categories.length + colors.length,
    };
}


// =====================================================================
// ETAPA 3: PLANO → NÚMEROS
// A rede neural só entende números. Cada plano vira uma lista assim:
//
//   [ mensalidade, idade média, Ambul., Completo, Odonto, Serviço, Munic., Region., Nacion. ]
//   [   0.22     ,    0.05    ,  0    ,  0.4   ,   0   ,    0   ,   0   ,  0.3   ,   0    ]
//                                         ↑ segmento "ligado"           ↑ abrangência "ligada"
// =====================================================================

// One-hot com peso: uma fileira de "interruptores" com só um ligado.
// Ex.: posição 1 de 4, peso 0.4 → [0, 0.4, 0, 0]
const oneHotWeight = (index, length, weight) => tf.oneHot(index, length).cast('float32').mul(weight);

function encodeProduct(product, context) {
    const price = tf.tensor1d([normalize(product.price, context.minPrice, context.maxPrice) * WEIGHTS.price]);
    // "?? 0.5" = se não houver idade média, usa o meio da escala.
    const age = tf.tensor1d([(context.productAvgAgeNorm[product.name] ?? 0.5) * WEIGHTS.age]);
    const category = oneHotWeight(context.categoriesIndex[product.category], context.numCategories, WEIGHTS.category);
    const color = oneHotWeight(context.colorsIndex[product.color], context.numColors, WEIGHTS.color);
    // concat = junta os pedaços numa lista só.
    return tf.concat([price, age, category, color]);
}


// =====================================================================
// ETAPA 4: BENEFICIÁRIO → NÚMEROS
// O beneficiário vira uma lista do MESMO tamanho da de um plano.
//
//   • Com planos contratados: é a MÉDIA das listas dos planos que ele tem
//     (um "retrato" do perfil dele), com a posição da idade trocada pela
//     idade dele mesmo.
//   • Sem planos (novo beneficiário), ou quando pedimos "somenteIdade":
//     tudo zero, menos a idade. Assim a rede recomenda pelo que pessoas
//     da mesma faixa de idade costumam contratar.
// =====================================================================
function encodeUser(user, context, somenteIdade = false) {
    const idade = tf.tensor1d([normalize(user.age, context.minAge, context.maxAge) * USER_AGE_WEIGHT]);

    if (user.purchases.length && !somenteIdade) {
        // stack = empilha as listas dos planos; mean(0) = média coluna por coluna.
        const media = tf.stack(user.purchases.map(product => encodeProduct(product, context))).mean(0);
        // Monta: [mensalidade média] + [idade dele] + [resto da média]
        return tf.concat([
            media.slice([0], [1]),
            idade,
            media.slice([2], [context.dimentions - 2]),
        ]).reshape([1, context.dimentions]); // formato "1 linha"
    }

    return tf.concat([
        tf.zeros([1]),                     // mensalidade: desconhecida
        idade,                             // idade: a única informação
        tf.zeros([context.numCategories]), // segmentos: desconhecidos
        tf.zeros([context.numColors]),     // abrangências: desconhecidas
    ]).reshape([1, context.dimentions]);
}


// =====================================================================
// ETAPA 5: EXEMPLOS DE TREINO
// Para cada beneficiário e cada plano, criamos um exemplo:
//     entrada  = lista do beneficiário + lista do plano
//     resposta = 1 se ele tem esse plano, 0 se não tem
// (igual ao Titanic: sobreviveu 1, não sobreviveu 0)
//
// MELHORIA em relação à aula: cada beneficiário entra DUAS vezes,
// uma com o perfil completo e outra "só com a idade". Assim a rede também
// aprende a recomendar para quem ainda não tem nenhum plano.
// =====================================================================
function createTrainingData(context) {
    const inputs = [];  // entradas
    const labels = [];  // respostas (1 ou 0)

    context.users
        .filter(u => u.purchases.length) // só quem já tem algum plano ensina a rede
        .forEach(user => {
            const vetorCompleto = encodeUser(user, context).dataSync();
            const vetorSoIdade = encodeUser(user, context, true).dataSync();
            // Usa as listas de números dos planos já calculadas em trainModel
            // (calcular de novo para cada pessoa deixaria o treino bem mais lento).
            context.productVectors.forEach(({ name, vector: productVector }) => {
                // some = "existe algum?" → ele contratou este plano?
                const label = user.purchases.some(p => p.name === name) ? 1 : 0;
                for (const userVector of [vetorCompleto, vetorSoIdade]) {
                    inputs.push([...userVector, ...productVector]); // "..." = espalhar a lista
                    labels.push(label);
                }
            });
        });

    return {
        xs: tf.tensor2d(inputs),                     // tabela de entradas
        ys: tf.tensor2d(labels, [labels.length, 1]), // coluna de respostas
        inputDimention: context.dimentions * 2,      // beneficiário + plano
    };
}


// =====================================================================
// ETAPA 6: CRIAR E TREINAR A REDE NEURAL
// Camadas: entrada → 128 → 64 → 32 → 1
//   • relu: deixa passar só valores positivos (o "porteiro")
//   • sigmoid na saída: devolve uma chance de 0 a 1 ("vai se interessar?")
// =====================================================================
async function configureNeuralNetAndTrain(trainData) {
    const model = tf.sequential(); // camadas uma depois da outra
    model.add(tf.layers.dense({ inputShape: [trainData.inputDimention], units: 128, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));

    model.compile({
        optimizer: tf.train.adam(0.01), // quem ajusta os pesos (0.01 = tamanho do ajuste)
        loss: 'binaryCrossentropy',     // régua do erro para respostas sim/não
        metrics: ['accuracy'],          // acompanhar a % de acertos
    });

    // fit = treinar. 30 voltas nos dados (epochs): com mais voltas a rede
    // começa a DECORAR os exemplos em vez de aprender o padrão.
    await model.fit(trainData.xs, trainData.ys, {
        epochs: 30,
        batchSize: 32,  // estuda de 32 em 32 exemplos
        shuffle: true,  // embaralha a ordem a cada volta
        callbacks: {
            // A cada volta, avisa a tela para atualizar o gráfico.
            onEpochEnd: (epoch, logs) => {
                postMessage({ type: workerEvents.trainingLog, epoch, loss: logs.loss, accuracy: logs.acc });
            }
        }
    });

    return model;
}

// Roda as etapas 2 a 6 em sequência quando a tela pede "treine!".
async function trainModel({ users }) {
    postMessage({ type: workerEvents.progressUpdate, progress: { progress: 50 } });
    const catalog = await (await fetch('/data/products.json')).json(); // lista de planos

    const context = makeContext(users, catalog);
    // Guarda a lista de números de cada plano, para usar na recomendação.
    context.productVectors = catalog.map(product => ({
        name: product.name,
        meta: { ...product },                              // dados para mostrar na tela
        vector: encodeProduct(product, context).dataSync(), // dados para a rede
    }));
    _globalCtx = context;

    const trainData = createTrainingData(context);
    _model = await configureNeuralNetAndTrain(trainData); // await = espera terminar

    postMessage({ type: workerEvents.progressUpdate, progress: { progress: 100 } });
    postMessage({ type: workerEvents.trainingComplete });
}


// =====================================================================
// ETAPA 7: RECOMENDAR
// Para o beneficiário escolhido, pergunta à rede a nota (0 a 1) de cada
// plano, aplica as regras de negócio, ordena e manda para a tela.
// =====================================================================
function recommend(user) {
    if (!_model) return; // ainda não treinou: nada a fazer
    const context = _globalCtx;

    // Junta a lista do beneficiário com a de CADA plano e pede as notas à rede.
    const preverNotas = (userVector) => {
        const inputs = context.productVectors.map(({ vector }) => [...userVector, ...vector]);
        return _model.predict(tf.tensor2d(inputs)).dataSync();
    };

    // Nota final = média de duas opiniões da rede:
    //   • pelo perfil completo (o que ele já contratou)
    //   • só pela idade (o que pessoas da idade dele contratam)
    // Para um novo beneficiário, as duas são iguais.
    const notasPerfil = preverNotas(encodeUser(user, context).dataSync());
    const notasIdade = preverNotas(encodeUser(user, context, true).dataSync());
    const scores = notasPerfil.map((nota, i) => (nota + notasIdade[i]) / 2);

    // Regras de negócio (melhorias em relação à aula):
    //   1. não indicar o que ele já tem;
    //   2. quem já tem plano principal recebe só serviços complementares.
    const jaContratados = new Set(user.purchases.map(p => p.name));
    const temPlanoPrincipal = user.purchases.some(p => PLANOS_PRINCIPAIS.includes(p.category));

    const recommendations = context.productVectors
        .map((item, index) => ({ ...item.meta, score: scores[index] }))
        .filter(item => !jaContratados.has(item.name))
        .filter(item => !(temPlanoPrincipal && PLANOS_PRINCIPAIS.includes(item.category)))
        .sort((a, b) => b.score - a.score); // maior nota primeiro

    postMessage({ type: workerEvents.recommend, user, recommendations });
}


// =====================================================================
// RECEPÇÃO DOS PEDIDOS DA TELA
// Quando a tela manda uma mensagem, olhamos a "action" e chamamos a função certa.
// =====================================================================
const handlers = {
    [workerEvents.trainModel]: trainModel,
    [workerEvents.recommend]: d => recommend(d.user),
};

self.onmessage = e => {
    const { action, ...data } = e.data;
    if (handlers[action]) handlers[action](data);
};
