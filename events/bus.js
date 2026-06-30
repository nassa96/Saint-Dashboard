/**
 * OMNIVEX EVENT BUS
 * Central nervous system for all market + agent events
 */

class EventBus {
  constructor() {
    this.subscribers = {};
    this.history = [];
  }

  on(event, fn) {
    if (!this.subscribers[event]) {
      this.subscribers[event] = [];
    }
    this.subscribers[event].push(fn);
  }

  emit(event, data) {
    const payload = {
      event,
      data,
      ts: Date.now()
    };

    this.history.push(payload);

    if (this.subscribers[event]) {
      this.subscribers[event].forEach(fn => fn(payload));
    }
  }

  getLast(n = 50) {
    return this.history.slice(-n);
  }

  getAll() {
    return this.history;
  }
}

module.exports = EventBus;
EOF
