/* ============================================================
   NOTIFIER — Telegram + Discord alerts.
   Fires on high-score memecoin detections (deduped) and fills.
   All sends are best-effort and never throw into the engine.
   ============================================================ */

const { httpRequest } = require("../util/http");
const log = require("../util/logger");

const DEDUP_TTL_MS = 6 * 60 * 60 * 1000; // don't re-alert same token for 6h

class Notifier {
  constructor(config) {
    this.cfg = config.alerts;
    this._seen = new Map(); // token address -> ts
    this._sent = 0;
    this._lastError = null;
  }

  get channels() {
    const c = [];
    if (this.cfg.telegramToken && this.cfg.telegramChatId) c.push("telegram");
    if (this.cfg.discordWebhook) c.push("discord");
    return c;
  }

  get enabled() {
    return this.channels.length > 0;
  }

  async _telegram(text) {
    const url = `https://api.telegram.org/bot${this.cfg.telegramToken}/sendMessage`;
    const res = await httpRequest(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.cfg.telegramChatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
      timeout: 7000,
    });
    if (!res.ok) throw new Error(`telegram HTTP ${res.status}`);
  }

  async _discord(text) {
    const res = await httpRequest(this.cfg.discordWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
      timeout: 7000,
    });
    if (!res.ok && res.status !== 204) throw new Error(`discord HTTP ${res.status}`);
  }

  async send(text) {
    if (!this.enabled) return { sent: false, reason: "no channels configured" };
    const results = {};
    for (const ch of this.channels) {
      try {
        if (ch === "telegram") await this._telegram(text);
        else if (ch === "discord") await this._discord(text);
        results[ch] = "ok";
        this._sent++;
      } catch (e) {
        results[ch] = e.message;
        this._lastError = e.message;
        log.warn("ALERT", `${ch} send failed: ${e.message}`);
      }
    }
    return { sent: true, results };
  }

  notifyFill(fill) {
    if (!this.cfg.onFills || !this.enabled) return;
    const arrow = fill.side === "BUY" ? "🟢" : "🔴";
    const txt =
      `${arrow} *${fill.mode || "PAPER"} ${fill.side}* ${fill.symbol}\n` +
      `Notional: $${fill.notional} @ ${fill.price}\n` +
      (fill.venue ? `Venue: ${fill.venue}\n` : "") +
      `_${new Date(fill.ts).toISOString()}_`;
    this.send(txt).catch(() => {});
  }

  notifyMemecoins(candidates = []) {
    if (!this.enabled) return;
    const now = Date.now();
    // clean expired dedup entries
    for (const [k, ts] of this._seen) if (now - ts > DEDUP_TTL_MS) this._seen.delete(k);
    for (const c of candidates) {
      if (c.source === "SIM") continue; // never alert on simulated data
      if (c.score < this.cfg.memecoinMinScore) continue;
      const key = c.address || `${c.chain}:${c.symbol}`;
      if (this._seen.has(key)) continue;
      this._seen.set(key, now);
      const flags = (c.flags || []).join(", ") || "none";
      const txt =
        `🚀 *Memecoin detected: ${c.symbol}* (${c.rating}, score ${c.score})\n` +
        `Chain: ${c.chain} · Price: $${c.priceUsd}\n` +
        `Liquidity: $${(c.liquidityUsd || 0).toLocaleString()} · Vol24h: $${(c.volume24h || 0).toLocaleString()}\n` +
        `1h: ${c.change1h}% · Turnover: ${c.turnover}x · Age: ${c.ageHours}h\n` +
        `Flags: ${flags}\n` +
        (c.url ? c.url : "");
      this.send(txt).catch(() => {});
    }
  }

  notifyVolatility(symbol, v) {
    if (!this.enabled) return;
    const txt =
      `⚡ *Extreme volatility regime: ${symbol}*\n` +
      `Percentile: ${v.percentile}th · z-score: ${v.zScore}\n` +
      `EWMA vol: ${v.ewmaVolPct}% · 1σ move: ${v.expectedMove?.oneSigmaPct}% · 2σ: ${v.expectedMove?.twoSigmaPct}%\n` +
      (v.squeeze ? `Squeeze detected (width pct ${v.squeezeWidthPercentile})\n` : "") +
      `${v.reasons.join("; ")}\n` +
      `_Statistical estimate, not a guarantee — see SAFETY.md_`;
    this.send(txt).catch(() => {});
  }

  status() {
    return {
      enabled: this.enabled,
      channels: this.channels,
      onFills: this.cfg.onFills,
      memecoinMinScore: this.cfg.memecoinMinScore,
      sent: this._sent,
      lastError: this._lastError,
      dedupTracked: this._seen.size,
    };
  }
}

module.exports = Notifier;
