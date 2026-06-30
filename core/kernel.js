/* =========================================================
   OMNIVEX KERNEL — STABLE ORCHESTRATOR (NO RECURSION)
========================================================= */

const Chronicle = require("./chronicle");
const EcosystemWarfare = require("./ecosystem/warfare");

class SOPHIA {
  signal() {
    return {
      signal: Math.random() > 0.5 ? "LONG" : "SHORT",
      confidence: Math.random()
    };
  }
}

class AEGIS {
  risk() {
    return {
      approved: Math.random() > 0.3,
      riskScore: Math.random()
    };
  }
}

class SAINT {
  execute(signal) {
    return {
      pnl: (Math.random() - 0.5) * 0.01,
      confidence: signal.confidence
    };
  }
}

class Kernel {
  constructor() {
    this.chronicle = new Chronicle();

    this.agents = {
      SOPHIA: new SOPHIA(),
      AEGIS: new AEGIS(),
      SAINT: new SAINT()
    };

    this.state = {
      cycle: 0,
      capital: { equity: 100 }
    };

    // IMPORTANT: NO RECURSIVE KERNEL CREATION
    this.ecosystem = new EcosystemWarfare({
      populationSize: 3
    });

    console.log("[KERNEL] STABLE MODE ONLINE");
  }

  async tick() {
    this.state.cycle++;

    const signal = this.agents.SOPHIA.signal();
    const risk = this.agents.AEGIS.risk();

    let execution = null;

    if (risk.approved) {
      execution = this.agents.SAINT.execute(signal);
    }

    if (execution?.pnl) {
      this.state.capital.equity += execution.pnl;
    }

    await this.ecosystem.tickAll();

    this.chronicle.append({
      cycle: this.state.cycle,
      signal,
      risk,
      execution,
      equity: this.state.capital.equity
    });

    return this.state;
  }
}

module.exports = Kernel;
