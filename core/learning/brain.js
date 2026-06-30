class LearningBrain {
  constructor() {
    this.scores = {
      SOPHIA: 0,
      AEGIS: 0,
      SAINT: 0
    };
  }

  update(tick, reward) {
    const { signal, risk, execution } = tick;

    // SOPHIA learns from signal usefulness
    this.scores.SOPHIA += reward * 0.6;

    // AEGIS learns from risk correctness
    this.scores.AEGIS += risk.approved ? reward * 0.3 : -reward * 0.3;

    // SAINT learns from execution outcome
    if (execution) {
      this.scores.SAINT += execution.pnl * 100;
    }
  }

  getScores() {
    return this.scores;
  }
}

module.exports = LearningBrain;
