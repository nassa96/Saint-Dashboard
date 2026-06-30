class BaseExchange {
  constructor(name) {
    this.name = name;
    this.connected = false;
  }

  async connect() {
    throw new Error("connect() not implemented");
  }

  async getPrice(symbol) {
    throw new Error("getPrice() not implemented");
  }

  async placeOrder(order) {
    throw new Error("placeOrder() not implemented");
  }
}

module.exports = BaseExchange;
