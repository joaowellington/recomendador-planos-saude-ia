import { View } from './View.js';

export class ProductView extends View {
    // DOM elements
    #productList = document.querySelector('#productList');

    #buttons;
    // Templates and callbacks
    #productTemplate;
    #onBuyProduct;

    constructor() {
        super();
        this.init();
    }

    async init() {
        this.#productTemplate = await this.loadTemplate('./src/view/templates/product-card.html');
    }

    onUserSelected(user) {
        // Enable buttons if a user is selected, otherwise disable them
        this.setButtonsState(user.id ? false : true);
    }

    registerBuyProductCallback(callback) {
        this.#onBuyProduct = callback;
    }

    render(products, disableButtons = true) {
        if (!this.#productTemplate) return;

        // Lista vazia: o beneficiário já tem tudo o que poderia ser indicado.
        if (products.length === 0) {
            this.#productList.innerHTML = `
                <div class="col-12">
                    <div class="alert alert-success">
                        Este beneficiário já tem todos os planos e serviços que poderiam ser indicados.
                        Nada a recomendar. Para testar, cancele um item clicando nele em "Planos e serviços contratados".
                    </div>
                </div>`;
            return;
        }
        // Monta um cartão para cada plano. Depois de "Recomendar planos", os planos
        // chegam em ordem (do mais indicado ao menos indicado) com a nota da rede (score).
        const html = products.map((product, posicao) => {
            return this.replaceTemplate(this.#productTemplate, {
                id: product.id,
                name: product.name,
                category: product.category,
                price: product.price.toFixed(2).replace('.', ','),
                scoreBadge: product.score == null ? ''
                    : `<span class="badge score-badge mb-2">${posicao + 1}ª indicação · nota ${(product.score * 100).toFixed(0)}%</span>`,
                color: product.color,
                product: JSON.stringify(product)
            });
        }).join('');

        this.#productList.innerHTML = html;
        this.attachBuyButtonListeners();

        // Disable all buttons by default
        this.setButtonsState(disableButtons);
    }

    setButtonsState(disabled) {
        if (!this.#buttons) {
            this.#buttons = document.querySelectorAll('.buy-now-btn');
        }
        this.#buttons.forEach(button => {
            button.disabled = disabled;
        });
    }

    attachBuyButtonListeners() {
        this.#buttons = document.querySelectorAll('.buy-now-btn');
        this.#buttons.forEach(button => {

            button.addEventListener('click', (event) => {
                const product = JSON.parse(button.dataset.product);
                const originalText = button.innerHTML;

                button.innerHTML = '<i class="bi bi-check-circle-fill"></i> Contratado';
                button.classList.remove('btn-primary');
                button.classList.add('btn-success');
                setTimeout(() => {
                    button.innerHTML = originalText;
                    button.classList.remove('btn-success');
                    button.classList.add('btn-primary');
                }, 500);
                this.#onBuyProduct(product, button);

            });
        });
    }
}
