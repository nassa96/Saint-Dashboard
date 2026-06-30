const fs = require("fs");

class Chronicle {
  constructor(file = "./core/chronicle.json") {
    this.file = file;
    this.events = this.load();
  }

  load() {
    try {
      return JSON.parse(fs.readFileSync(this.file));
    } catch {
      return [];
    }
  }

  save() {
    fs.writeFileSync(this.file, JSON.stringify(this.events, null, 2));
  }

  append(event) {
    this.events.push({
      ts: Date.now(),
      ...event
    });

    if (this.events.length > 2000) {
      this.events = this.events.slice(-2000);
    }

    this.save();
  }

  getLast(n) {
    return this.events.slice(-n);
  }
}

module.exports = Chronicle;
