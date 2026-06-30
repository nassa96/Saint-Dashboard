class ExecutionRouter {
  constructor(config = {}) {
    const {
      mode = "PAPER",
      brokers = {}
    } = config || {};

    this.mode = mode; // PAPER | LIVE
    this.brokers = brokers;

    this.slippage = 0.0005;
  }

  async execute(signal, state) {
    if (this.mode === "PAPER") {
      return this.paperFill(signal, state);
    }

    if (this.mode === "LIVE") {
      return this.liveFill(signal, state);
    }

    return null;
  }

  paperFill(signal, state) {
    const price = state?.market?.price || 60000;

    const slippage = price * this.slippage;

    const fillPrice =
      signal.signal === "LONG"
        ? price + slippage
        : price - slippage;

    const pnl =
      signal.signal === "LONG"
        ? (Math.random() - 0.5) * 0.01
        : (Math.random() - 0.5) * 0.01;

    return {
      agent: "EXECUTION_ROUTER",
      mode: "PAPER",
      status: "FILLED",
      price: fillPrice,
      pnl,
      size: 0.1,
      confidence: signal.confidence,
      ts: Date.now()
    };
  }

  async liveFill(signal, state) {
    const broker = this.brokers?.default;

    if (!broker) {
      return this.paperFill(signal, state);
    }

    try {
      const order = await broker.placeOrder({
        side: signal.signal === "LONG" ? "BUY" : "SELL",
        size: 0.1,
        symbol: "BTC-USD"
      });

      return {
        agent: "EXECUTION_ROUTER",
        mode: "LIVE",
        status: "FILLED",
        broker: broker.name,
        orderId: order.id,
        ts: Date.now()
      };
    } catch (e) {
      return {
        agent: "EXECUTION_ROUTER",
        mode: "LIVE_FALLBACK",
        error: e.message,
        fallback: true,
        ...this.paperFill(signal, state)
      };
    }
  }
}

module.exports = ExecutionRouter;
