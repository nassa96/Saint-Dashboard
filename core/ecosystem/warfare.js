/* =========================================================
   ECOSYSTEM WARFARE — STABLE ORCHESTRATION LAYER
========================================================= */

const AgentKernel = require("./agentKernel");

class EcosystemWarfare {
  constructor({ populationSize = 3 }) {
    this.populationSize = populationSize;

    this.kernels = [];
    this.tickCount = 0;

    this.init();
  }

  init() {
    for (let i = 0; i < this.populationSize; i++) {
      this.kernels.push(new AgentKernel(`K_${i}`));
    }
  }

  async tickAll() {
    this.tickCount++;

    const results = [];

    for (const k of this.kernels) {
      const state = await k.tick();

      results.push({
        id: state.genomeId,
        equity: state.capital.equity
      });
    }

    return {
      tick: this.tickCount,
      population: results
    };
  }
}

module.exports = EcosystemWarfare;
