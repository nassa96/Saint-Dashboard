function safeRequire(path, fallback = null, label = "MODULE") {
  try {
    return require(path);
  } catch (e) {
    console.log(`[BOOT] ${label} missing -> using fallback`);
    return fallback;
  }
}

function stub(name) {
  return class {
    constructor() {
      this.__stub = true;
      this.name = name;
    }

    __warn() {
      console.log(`[STUB] ${name} called but not implemented`);
    }
  };
}

module.exports = {
  safeRequire,
  stub
};
