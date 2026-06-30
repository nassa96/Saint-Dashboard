/* =========================================================
   OMNIVEX AUTO REPAIR SYSTEM (SAFE BASE)
========================================================= */

class AutoRepair {
  constructor() {
    this.errors = [];
    this.repairLog = [];
  }

  log(error) {
    this.errors.push({
      ts: Date.now(),
      error: error?.message || String(error)
    });
  }

  analyze(state) {
    if (!state) return { status: "EMPTY" };

    if (state.capital?.equity < 50) {
      return { status: "LOW_CAPITAL", action: "STABILIZE" };
    }

    return { status: "OK", action: "NONE" };
  }

  repair(state) {
    const result = this.analyze(state);

    if (result.action === "STABILIZE") {
      state.capital.equity += 1;
    }

    this.repairLog.push({
      ts: Date.now(),
      result
    });

    return state;
  }
}

module.exports = AutoRepair;
