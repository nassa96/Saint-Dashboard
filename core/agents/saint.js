module.exports = {
  execute(signal, kernel) {
    kernel.log(`EXECUTING TRADE → ${JSON.stringify(signal)}`);

    kernel.state.cycle += 1;
  }
};
