class Survival {
  constructor() {
    this.maxDrawdown = 0.2;
    this.killSwitch = false;
  }

  evaluate(capitalState, riskState) {
    const dd = capitalState.drawdown || 0;

    if (dd > this.maxDrawdown) {
      this.killSwitch = true;
    }

    if (riskState?.riskScore > 0.9) {
      this.killSwitch = true;
    }

    return {
      allowed: !this.killSwitch,
      reason: this.killSwitch ? "SURVIVAL_BLOCK" : "OK"
    };
  }

  reset() {
    this.killSwitch = false;
  }
}

module.exports = Survival;
