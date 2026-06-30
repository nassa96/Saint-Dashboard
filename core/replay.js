class ReplayEngine {
  constructor(kernel, chronicle) {
    this.kernel = kernel;
    this.chronicle = chronicle;
  }

  replay(fromCycle = 0, toCycle = null) {
    const events = this.chronicle.all();

    this.kernel.reset();

    for (const event of events) {
      if (event.type !== "TICK") continue;
      if (event.cycle < fromCycle) continue;
      if (toCycle !== null && event.cycle > toCycle) break;

      this.kernel.applyReplayTick(event);
    }

    return {
      status: "REPLAY_COMPLETE",
      fromCycle,
      toCycle: toCycle ?? this.kernel.state.cycle,
      finalState: this.kernel.state
    };
  }
}

module.exports = ReplayEngine;
