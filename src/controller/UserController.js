export class UserController {
    #userService;
    #userView;
    #events;
    constructor({
        userView,
        userService,
        events,
    }) {
        this.#userView = userView;
        this.#userService = userService;
        this.#events = events;
    }

    static init(deps) {
        return new UserController(deps);
    }

    async renderUsers(nonTrainedUser) {
        const users = await this.#userService.getDefaultUsers();

        this.#userService.addUser(nonTrainedUser);
        const defaultAndNonTrained = [nonTrainedUser, ...users];

        this.#userView.renderUserOptions(defaultAndNonTrained);
        this.setupCallbacks();
        this.setupPurchaseObserver();

        this.#events.dispatchUsersUpdated({ users: defaultAndNonTrained });

    }

    setupCallbacks() {
        this.#userView.registerUserSelectCallback(this.handleUserSelect.bind(this));
        this.#userView.registerPurchaseRemoveCallback(this.handlePurchaseRemove.bind(this));
    }

    setupPurchaseObserver() {

        this.#events.onPurchaseAdded(
            async (...data) => {
                return this.handlePurchaseAdded(...data);
            }
        );

    }

    async handleUserSelect(userId) {
        const user = await this.#userService.getUserById(userId);
        this.#events.dispatchUserSelected(user);
        return this.displayUserDetails(user);
    }

    async handlePurchaseAdded({ user, product }) {
        const updatedUser = await this.#userService.getUserById(user.id);
        // Guarda só os dados do plano (sem a nota "score" da recomendação)
        const { score, ...plano } = product;
        updatedUser.purchases.push(plano)

        await this.#userService.updateUser(updatedUser);

        const lastPurchase = updatedUser.purchases[updatedUser.purchases.length - 1];
        this.#userView.addPastPurchase(lastPurchase);
        this.#events.dispatchUsersUpdated({ users: await this.#userService.getUsers() });
        // Atualiza as indicações na hora: o plano contratado sai da lista
        this.#events.dispatchRecommend(updatedUser);
    }

    async handlePurchaseRemove({ userId, product }) {
        const user = await this.#userService.getUserById(userId);
        const index = user.purchases.findIndex(item => item.id === product.id);

        if (index !== -1) {
            user.purchases.splice(index, 1); // directly remove one item at the found index
            await this.#userService.updateUser(user);

            const updatedUsers = await this.#userService.getUsers();
            this.#events.dispatchUsersUpdated({ users: updatedUsers });
            // Atualiza as indicações na hora: o plano cancelado volta a ser indicado
            this.#events.dispatchRecommend(user);
        }
    }


    async displayUserDetails(user) {
        this.#userView.renderUserDetails(user);
        this.#userView.renderPastPurchases(user.purchases);

    }

    getSelectedUserId() {
        return this.#userView.getSelectedUserId();
    }
}
