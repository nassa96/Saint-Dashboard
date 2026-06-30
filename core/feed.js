class Feed {
  constructor() {
    this.price = 100;
    this.external = false;
  }

  injectMarketPrice(p) {
    this.price = p;
    this.external = true;
  }

  simulate() {
    if (this.external) return this.price;

    this.price += (Math.random() - 0.5) * 0.5;
    return this.price;
  }
}

module.exports = Feed;
