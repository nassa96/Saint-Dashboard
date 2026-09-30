/* ============================================================
   BASE EXCHANGE CONNECTOR
   Defines the contract every venue adapter must satisfy.
   Live order methods MUST refuse unless the caller passes an
   armed=true flag (the manager only sets this when the global
   kill-switch is fully disengaged).
   ============================================================ */

class BaseExchange {
  constructor(name, creds = {}) {
    this.name = name;
    this.creds = creds;
    this.connected = false;
  }

  hasCredentials() {
    return Boolean(this.creds.key && this.creds.secret);
  }

  // Merge in credentials at runtime (from the Connections page / cred store).
  setCredentials(creds = {}) {
    this.creds = { ...this.creds, ...creds };
    return this;
  }

  // Public, unauthenticated reachability check.
  async testConnection() {
    throw new Error(`${this.name}.testConnection() not implemented`);
  }

  // Authenticated read-only account balances.
  async getBalances() {
    throw new Error(`${this.name}.getBalances() not implemented`);
  }

  // Live order. Implementations must throw if !armed.
  async placeOrder(/* order, armed */) {
    throw new Error(`${this.name}.placeOrder() not implemented`);
  }
}

module.exports = BaseExchange;
