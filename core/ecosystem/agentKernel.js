/* =========================================================
   LIGHTWEIGHT AGENT KERNEL (NO ECOSYSTEM INSIDE)
========================================================= */

class AgentKernel {
  constructor(id) {
    this.state = {
      genomeId: id,
      cycle: 0,
      capital: { equity: 100 },
      genome: {
        bias: 1,
        aggression: 1,
        stability: 1
      }
    };
  }

  async tick() {
    this.state.cycle++;

    const pnl = (Math.random() - 0.5) * 0.01;

    this.state.capital.equity += pnl;

    return this.state;
  }
}

module.exports = AgentKernel;
