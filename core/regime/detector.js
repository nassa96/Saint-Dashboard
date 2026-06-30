class RegimeDetector {
  detect(marketHistory) {
    if (!marketHistory || marketHistory.length < 5) {
      return "UNKNOWN";
    }

    const prices = marketHistory.map(p => p.price);
    const latest = prices[prices.length - 1];
    const prev = prices[0];

    const delta = (latest - prev) / prev;

    const volatility = this.std(prices);

    if (volatility > 500) return "VOLATILE_SPIKE";
    if (Math.abs(delta) < 0.002) return "CHOP";
    if (delta > 0.01) return "TRENDING_UP";
    if (delta < -0.01) return "TRENDING_DOWN";

    return "LOW_VOL";
  }

  std(arr) {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance =
      arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;

    return Math.sqrt(variance);
  }
}

module.exports = RegimeDetector;
