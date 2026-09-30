/* ============================================================
   DASHBOARD AUTH
   Lightweight session auth with HMAC-signed tokens (no external
   deps). Active only when config.auth.enabled (i.e. a password is
   set). Protects REST + WebSocket; leaves /api/health and the
   login route open.
   ============================================================ */

const crypto = require("crypto");

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

class Auth {
  constructor(config) {
    this.cfg = config.auth;
    this.enabled = this.cfg.enabled;
    this.secret =
      this.cfg.sessionSecret || crypto.randomBytes(32).toString("hex");
  }

  _b64u(buf) {
    return Buffer.from(buf).toString("base64url");
  }

  sign(payload) {
    const body = this._b64u(JSON.stringify(payload));
    const sig = crypto.createHmac("sha256", this.secret).update(body).digest("base64url");
    return `${body}.${sig}`;
  }

  verify(token) {
    if (!token || typeof token !== "string" || !token.includes(".")) return null;
    const [body, sig] = token.split(".");
    const expected = crypto.createHmac("sha256", this.secret).update(body).digest("base64url");
    if (
      sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    )
      return null;
    try {
      const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      if (!payload.exp || Date.now() > payload.exp) return null;
      return payload;
    } catch (_) {
      return null;
    }
  }

  checkCredentials(user, password) {
    if (!this.enabled) return false;
    const uOk = safeEqual(String(user || ""), this.cfg.user);
    const pOk = safeEqual(String(password || ""), this.cfg.password);
    return uOk && pOk;
  }

  issueToken(user) {
    return this.sign({ u: user, exp: Date.now() + SESSION_TTL_MS });
  }

  _tokenFromReq(req) {
    // Authorization: Bearer <t>, or cookie "saint_session", or ?token=
    const auth = req.headers?.authorization;
    if (auth && auth.startsWith("Bearer ")) return auth.slice(7);
    const cookie = req.headers?.cookie || "";
    const m = cookie.match(/(?:^|;\s*)saint_session=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
    if (req.query && req.query.token) return req.query.token;
    return null;
  }

  isAuthed(req) {
    if (!this.enabled) return true;
    return Boolean(this.verify(this._tokenFromReq(req)));
  }

  /** Express middleware protecting everything except open paths. */
  middleware(openPaths = []) {
    return (req, res, next) => {
      if (!this.enabled) return next();
      if (openPaths.some((p) => req.path === p || req.path.startsWith(p))) return next();
      if (this.isAuthed(req)) return next();
      if (req.path.startsWith("/api/")) {
        return res.status(401).json({ error: "unauthorized", authRequired: true });
      }
      return res.redirect("/login.html");
    };
  }

  /** Verify a WebSocket upgrade request (uses cookie or ?token=). */
  verifyWs(req) {
    if (!this.enabled) return true;
    // Build a minimal query object from the URL
    try {
      const url = new URL(req.url, "http://localhost");
      const token =
        url.searchParams.get("token") ||
        (req.headers.cookie || "").match(/(?:^|;\s*)saint_session=([^;]+)/)?.[1];
      return Boolean(this.verify(token && decodeURIComponent(token)));
    } catch (_) {
      return false;
    }
  }
}

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // still do a comparison to reduce timing signal
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

module.exports = Auth;
