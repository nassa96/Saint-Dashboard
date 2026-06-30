class RiskEngine {
  constructor() {
    this.maxDrawdown = 0.12;
    this.maxPosition = 0.2;
    this.emergencyStop = false;
  }

  evaluate(context) {
    if (this.emergencyStop) {
      return { approved: false, reason: "EMERGENCY_STOP" };
    }

    const riskScore =
      Math.random() * 0.5 +
      (context.volatility || 0.2);

    const approved = riskScore < 0.6;

    return {
      approved,
      riskScore,
      reason: approved ? "PASS" : "BLOCK"
    };
  }

  triggerEmergency() {
    this.emergencyStop = true;
  }

  reset() {
    this.emergencyStop = false;
  }
}

module.exports = RiskEngine;
