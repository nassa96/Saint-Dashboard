/* Simple leveled logger with in-memory ring buffer for the dashboard. */

const BUFFER_MAX = 500;
const buffer = [];

function push(level, scope, msg) {
  const entry = { ts: Date.now(), level, scope, msg: String(msg) };
  buffer.push(entry);
  if (buffer.length > BUFFER_MAX) buffer.shift();
  const tag = `[${scope}]`;
  if (level === "error") console.error(tag, msg);
  else if (level === "warn") console.warn(tag, msg);
  else console.log(tag, msg);
  return entry;
}

module.exports = {
  info: (scope, msg) => push("info", scope, msg),
  warn: (scope, msg) => push("warn", scope, msg),
  error: (scope, msg) => push("error", scope, msg),
  recent: (n = 100) => buffer.slice(-n),
};
