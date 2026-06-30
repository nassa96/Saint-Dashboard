class FitnessEngine {
  calculate(history = []) {
    let score = 0;

    for (const t of history) {
      if (t.execution?.pnl) score += t.execution.pnl * 100;
      if (t.risk?.approved) score += 0.2;
      if (!t.risk?.approved && t.signal?.signal === "LONG") score -= 0.1;
    }

    return score;
  }
}

module.exports = FitnessEngine;
