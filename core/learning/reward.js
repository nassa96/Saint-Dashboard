class RewardSystem {
  compute({ execution, capital, risk, signal }) {
    let reward = 0;

    // Profit signal (primary driver)
    if (execution?.pnl) {
      reward += execution.pnl * 10;
    }

    // Reward correct directional conviction
    if (execution?.pnl > 0 && signal?.confidence > 0.6) {
      reward += 0.05;
    }

    // Penalize blocked trades (missed opportunity or bad signal)
    if (!execution && risk?.approved === false) {
      reward -= 0.02;
    }

    // Drawdown penalty (survival pressure)
    if (capital?.drawdown > 0.03) {
      reward -= capital.drawdown * 0.5;
    }

    // Reward capital growth
    if (capital?.equity > capital?.peak) {
      reward += 0.02;
    }

    return reward;
  }
}

module.exports = RewardSystem;
