class Regime {
  detect(price, prev) {
    const move = (price - (prev || price)) / (prev || price);

    const vol = Math.abs(move);

    if (move < -0.03) return "CRASH";
    if (vol > 0.02) return "HIGH_VOL";
    if (vol < 0.005) return "LOW_VOL";
    if (move > 0.02) return "TREND_UP";

    return "CHOP";
  }
}

module.exports = Regime;
