# Gera uma base FICTÍCIA de beneficiários com padrões por faixa de idade.
# Nenhum dado real: nomes sorteados de listas genéricas, sem dados de saúde.
# Rodar (nesta pasta tools):  python gerar_beneficiarios.py
import json, random, pathlib
random.seed(42)  # mesma base toda vez
DATA = pathlib.Path(__file__).resolve().parent.parent / "data"
cat = json.load(open(DATA / "products.json", encoding="utf-8"))
by = {p["name"]: p for p in cat}
nomes = ["Ana","Bruno","Carla","Daniel","Eduarda","Felipe","Gabriela","Henrique","Isabela","João","Karen","Leonardo",
         "Mariana","Nicolas","Olívia","Paulo","Quésia","Renato","Sabrina","Tiago","Úrsula","Vinícius","Wesley","Yasmin"]
sobrenomes = ["Silva","Souza","Oliveira","Santos","Lima","Pereira","Costa","Almeida","Rocha","Nunes","Martins","Barbosa"]

def escolhe(opcoes):  # opcoes: [(nome, peso)]
    return random.choices([o for o, _ in opcoes], [w for _, w in opcoes])[0]

def perfil(idade):
    if idade < 30:
        plano = escolhe([("Essencial Ambulatorial", 5), ("Ambulatorial Plus", 3), ("Completo Enfermaria", 2)])
        extras = {"Telemedicina 24h": .7, "Odonto Básico": .4, "Check-up Anual": .05}
    elif idade < 45:
        plano = escolhe([("Completo Enfermaria Regional", 35), ("Completo Apartamento", 40), ("Completo Apartamento Nacional", 25)])
        extras = {"Odonto Plus": .5, "Telemedicina 24h": .35, "Check-up Anual": .3, "Remoção Aeromédica": .2}
    elif idade < 58:
        plano = escolhe([("Completo Apartamento", 50), ("Completo Apartamento Nacional", 30), ("Completo Enfermaria Regional", 20)])
        extras = {"Check-up Anual": .6, "Odonto Plus": .4, "Remoção Aeromédica": .35, "Telemedicina 24h": .15}
    else:
        plano = escolhe([("Sênior Completo", 75), ("Completo Apartamento", 25)])
        extras = {"Check-up Anual": .8, "Remoção Aeromédica": .5, "Odonto Básico": .25}
    itens = [plano] + [e for e, prob in extras.items() if random.random() < prob]
    return [by[i] for i in itens]

usados, users = set(), []
for i in range(1, 61):
    while True:
        nome = f"{random.choice(nomes)} {random.choice(sobrenomes)}"
        if nome not in usados: usados.add(nome); break
    idade = random.choice([random.randint(19, 29), random.randint(30, 44), random.randint(45, 57), random.randint(58, 75)])
    users.append({"id": i, "name": nome, "age": idade, "purchases": perfil(idade)})

json.dump(users, open(DATA / "users.json", "w", encoding="utf-8"), ensure_ascii=False, indent=4)
print(len(users), "beneficiários fictícios gerados em data/users.json")
