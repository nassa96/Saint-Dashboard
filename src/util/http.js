/* fetch wrapper with timeout + JSON helpers. Uses Node 18+ global fetch. */

async function httpGet(url, { headers = {}, timeout = 8000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_) {
      /* non-JSON */
    }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

async function httpJson(url, opts) {
  const r = await httpGet(url, opts);
  if (!r.ok) {
    throw new Error(`HTTP ${r.status} for ${url}`);
  }
  return r.json;
}

async function httpRequest(url, { method = "GET", headers = {}, body, timeout = 8000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_) {
      /* non-JSON */
    }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

module.exports = { httpGet, httpJson, httpRequest };
