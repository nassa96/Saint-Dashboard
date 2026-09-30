/* ============================================================
   STRATEGY REGISTRY + ENSEMBLE
   Central catalogue of available strategies plus an ensemble that
   blends their scores into one signal. Lets the engine run any
   single strategy or a weighted combination.
   ============================================================ */

const momentum = require("./momentum");
const meanReversion = require("./meanReversion");

const STRATEGIES = {
  momentum,
  meanreversion: meanReversion,
};

function get(name) {
  return STRATEGIES[(name || "").toLowerCase()] || null;
}

function list() {
  return Object.values(STRATEGIES).map((s) => ({
    name: s.name,
    label: s.label,
    params: s.defaultParams,
  }));
}

/**
 * Blend several strategies by averaging their directional scores.
 * @param {number[]} prices
 * @param {object} opts { members: string[], weights?: {name:weight}, params?: {name:params} }
 */
function ensemble(prices, opts = {}) {
  const members = (opts.members && opts.members.length ? opts.members : ["momentum", "meanreversion"])
    .map((n) => get(n))
    .filter(Boolean);
  if (!members.length) return { signal: "FLAT", confidence: 0, score: 0, reasons: ["no members"], indicators: {} };

  const weights = opts.weights || {};
  const perParams = opts.params || {};
  let wSum = 0;
  let scoreSum = 0;
  let confSum = 0;
  const reasons = [];
  const parts = {};

  for (const m of members) {
    const w = weights[m.name] != null ? weights[m.name] : 1;
    const r = m.evaluate(prices, perParams[m.name]);
    parts[m.name] = { signal: r.signal, score: Number(r.score.toFixed(3)), confidence: Number(r.confidence.toFixed(3)) };
    scoreSum += r.score * w;
    confSum += r.confidence * w;
    wSum += w;
    reasons.push(`${m.name}: ${r.signal} (${r.score.toFixed(2)})`);
  }

  const score = wSum ? Math.max(-1, Math.min(1, scoreSum / wSum)) : 0;
  const confidence = wSum ? Math.max(0, Math.min(1, confSum / wSum)) : 0;
  const entry = 0.15;
  let signal = "FLAT";
  if (score > entry) signal = "LONG";
  else if (score < -entry) signal = "SHORT";

  return { signal, confidence, score, reasons, indicators: { ensemble: parts } };
}

module.exports = { STRATEGIES, get, list, ensemble };
