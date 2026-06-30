class ELOHIM {
  constructor(kernel = {}) {
    this.kernel = kernel;

    this.boot();
  }

  boot() {
    console.log("[ELOHIM] Kernel orchestration online");

    // SAFE AGENT ACCESS (FIX)
    const agents =
      this.kernel?.agents ||
      this.kernel?.agentRegistry ||
      this.kernel?.coreAgents ||
      {};

    this.agents = agents;

    if (!agents || Object.keys(agents).length === 0) {
      console.log("[ELOHIM] No agents found — operating in autonomous kernel mode");
      return;
    }

    Object.keys(agents).forEach(a => {
      console.log("[KERNEL] Registered agent:", a);
    });
  }

  getAgents() {
    return this.agents || {};
  }

  tickHint(state) {
    // fallback orchestration logic if no agents exist

    if (!this.agents || Object.keys(this.agents).length === 0) {
      return {
        mode: "AUTONOMOUS",
        signal: Math.random() > 0.5 ? "LONG" : "SHORT",
        confidence: 0.5
      };
    }

    return {
      mode: "AGENTED",
      activeAgents: Object.keys(this.agents),
      signal: "HOLD",
      confidence: 0.5
    };
  }
}

module.exports = ELOHIM;
