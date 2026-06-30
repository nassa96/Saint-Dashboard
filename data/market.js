class MarketState {
  constructor() {
    this.price = null;
    this.bid = null;
    this.ask = null;

    this.volume = 0;

    this.spread = 0;

    this.exchange = "NONE";

    this.timestamp = null;

    this.history = [];
  }

  update(data) {

    this.price = data.price;

    this.bid = data.bid;

    this.ask = data.ask;

    this.volume = data.volume;

    this.exchange = data.exchange;

    this.timestamp = Date.now();

    this.spread = this.ask - this.bid;

    this.history.push({
      ts: this.timestamp,
      price: this.price
    });

    if (this.history.length > 5000) {
      this.history.shift();
    }

  }

}

module.exports = new MarketState();
