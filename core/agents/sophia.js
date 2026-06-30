module.exports = {
  process(marketData, kernel) {
    const signal = {
      type: "DEMO_SIGNAL",
      strength: Math.random(),
      price: marketData.price || 0
    };

    kernel.emit("SIGNAL_GENERATED", signal);
  }
};
