/* ============================================================
   EXCHANGE CREDENTIAL STORE
   Persists venue API keys entered via the Connections page to
   data/credentials.json (git-ignored). These are TRADE-scoped
   exchange keys, not wallet private keys.

   SECURITY: stored as plaintext on the host you control. Only use
   keys with withdrawals DISABLED, and protect the dashboard with
   DASHBOARD_PASSWORD before exposing it to any network.
   ============================================================ */

const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "..", "..", "data", "credentials.json");

function load() {
  try {
    if (!fs.existsSync(STORE_PATH)) return {};
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8")) || {};
  } catch (_) {
    return {};
  }
}

function save(all) {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(all, null, 2), { mode: 0o600 });
    return true;
  } catch (_) {
    return false;
  }
}

function set(venue, creds) {
  const all = load();
  all[venue] = { ...(all[venue] || {}), ...creds };
  save(all);
  return all[venue];
}

function remove(venue) {
  const all = load();
  delete all[venue];
  save(all);
}

module.exports = { load, save, set, remove, STORE_PATH };
