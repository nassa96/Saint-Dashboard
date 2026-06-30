/**
 * OMNIVEX LEARNING LOOP
 * Builds performance memory per agent
 */

class LearningEngine {
  constructor(chronicle) {
    this.chronicle = chronicle;
  }

  getStats() {
    const ticks = this.chronicle.getTicks();

    const stats = {
      SOPHIA: { wins: 0, losses: 0 },
      AEGIS: { approvals: 0, blocks: 0 },
      SAINT: { executions: 0 }
    };

    for (const t of ticks) {
      if (t.signal?.agent === "SOPHIA") {
        t.execution ? stats.SOPHIA.wins++ : stats.SOPHIA.losses++;
      }

      if (t.risk?.agent === "AEGIS") {
        t.risk.approved ? stats.AEGIS.approvals++ : stats.AEGIS.blocks++;
      }

      if (t.execution?.agent === "SAINT") {
        stats.SAINT.executions++;
      }
    }

    return stats;
  }

  getBias() {
    const stats = this.getStats();

    const totalSophia = stats.SOPHIA.wins + stats.SOPHIA.losses || 1;
    const winRate = stats.SOPHIA.wins / totalSophia;

    return {
      sophiaBias: winRate,          // influences LONG/SHORT tendency
      riskTolerance: stats.AEGIS.approvals / (stats.AEGIS.approvals + stats.AEGIS.blocks || 1)
    };
  }
}

module.exports = LearningEngine;
