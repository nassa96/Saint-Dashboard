/* =========================================================
   OMNIVEX CHRONICLE MEMORY SYSTEM
========================================================= */

class Chronicle {
  constructor() {
    this.events = [];
  }

  append(event) {
    this.events.push(event);
  }

  getLast(n = 20) {
    return this.events.slice(-n);
  }

  getAll() {
    return this.events;
  }
}

module.exports = Chronicle;
