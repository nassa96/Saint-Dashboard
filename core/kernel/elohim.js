/**
 * OMNIVEX ELOHIM KERNEL
 * Central orchestration brain
 */

class ELOHIM {
  constructor() {
    this.state = {
      mode: "SIMULATION",
      risk: "LOW",
      cycle: 0,
      lastSignal: null
    };

    this.agents = {};
    this.eventLog = [];
  }

  registerAgent(name, agent) {
    this.agents[name] = agent;
    this.log(`Agent registered: ${name}`);
  }

  emit(event, payload = {}) {
    const entry = {
      event,
      payload,
      timestamp: Date.now()
    };

    this.eventLog.push(entry);
    this.log(`EVENT → ${event}`);

    this.route(event, payload);
  }

  route(event, payload) {
    switch (event) {

      case "MARKET_TICK":
        if (this.agents.SOPHIA) {
          this.agents.SOPHIA.process(payload, this);
        }
        break;

      case "SIGNAL_GENERATED":
        this.state.lastSignal = payload;

        if (this.agents.AEGIS) {
          this.agents.AEGIS.validate(payload, this);
        }
        break;

      case "EXECUTE":
        if (this.agents.SAINT) {
          this.agents.SAINT.execute(payload, this);
        }
        break;

      default:
        this.log(`No route for event: ${event}`);
    }
  }

  log(msg) {
    console.log(`[ELOHIM] ${msg}`);
  }

  getState() {
    return this.state;
  }
}

module.exports = new ELOHIM();
