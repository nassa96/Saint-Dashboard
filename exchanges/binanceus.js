/**
 * OMNIVEX BINANCE.US CONNECTOR
 * Safe fallback feed (no blocked endpoints)
 */

class BinanceUS {
  constructor() {
    this.name = "binanceus";
    this.interval = null;
  }

  connect(callback) {
    console.log("[BINANCE.US] Simulated feed active");

    const base = 60000;

    const tick = () => {
      const drift = (Math.random() - 0.5) * 200;

      const price = base + drift;

      callback({
        symbol: "BTC-USD",
        bid: price - 5,
        ask: price + 5,
        last: price,
        volume: Math.random() * 80
      });
    };

    tick();
    this.interval = setInterval(tick, 2500);
  }

  disconnect() {
    if (this.interval) clearInterval(this.interval);
  }
}

module.exports = BinanceUS;
EOF
