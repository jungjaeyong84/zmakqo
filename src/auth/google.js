// src/auth/google.js
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;

function normalizeBaseUrl(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.replace(/\/+$/, "");
}

function firstHeaderValue(value) {
  return String(value || "")
    .split(",")[0]
    .trim();
}

function resolveGoogleBaseUrl(req = null) {
  const envBaseUrl = normalizeBaseUrl(
    process.env.GOOGLE_OAUTH_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    process.env.BASE_URL
  );
  if (!req || typeof req !== "object") {
    return envBaseUrl || "http://localhost:3000";
  }

  const forwardedProto = firstHeaderValue(req.headers && req.headers["x-forwarded-proto"]);
  const forwardedHost = firstHeaderValue(req.headers && req.headers["x-forwarded-host"]);
  const host = forwardedHost || firstHeaderValue(req.get && req.get("host"));
  const proto = forwardedProto || req.protocol || (envBaseUrl && envBaseUrl.startsWith("https://") ? "https" : "http");
  if (host) {
    return `${proto}://${host}`.replace(/\/+$/, "");
  }
  return envBaseUrl || "http://localhost:3000";
}

function resolveGoogleCallbackUrl(req = null) {
  return `${resolveGoogleBaseUrl(req)}/auth/google/callback`;
}

// allowlist
function isAllowedEmail(email) {
  const allow = (process.env.ALLOWLIST_EMAIL || "").trim().toLowerCase();
  if (!allow) return false;
  return (email || "").trim().toLowerCase() === allow;
}

// Tailscale IPv4(100.64.0.0/10)
function isTailscaleIp(ipRaw) {
  if (!ipRaw) return false;
  const ip = String(ipRaw).replace("::ffff:", "").trim();
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a === 100 && b >= 64 && b <= 127;
}

function setupGoogleAuth() {
  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  const baseUrl = resolveGoogleBaseUrl();
  const callbackURL = resolveGoogleCallbackUrl();

  // DEBUG: print runtime oauth config once
  // eslint-disable-next-line no-console
  console.log("[OAUTH_CONFIG]", { baseUrl, callbackURL, allowlist: (process.env.ALLOWLIST_EMAIL || "").trim().toLowerCase() });


  if (!clientID || !clientSecret) {
    const allowLocal = String(process.env.ALLOW_LOCAL_NO_OAUTH || "1") === "1";
    if (allowLocal) {
      console.log("[OAUTH_DISABLED_LOCAL] GOOGLE_CLIENT_ID/SECRET missing; running without login");
      // LOCAL_OAUTH_DUMMY_STRATEGY_V1
      // Register a dummy "google" strategy so passport.authenticate("google") does not crash.
      passport.use("google", new (require("passport-strategy"))(function(req, options, done){
        // not used
        return done(null, false);
      }));
      return;
    }
    throw new Error("Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET");
  }
  // LOCAL_OAUTH_OPTIONAL_V1

  passport.use(
    new GoogleStrategy(
      { clientID, clientSecret, callbackURL },
      (accessToken, refreshToken, profile, done) => {
        const email =
          profile?.emails && profile.emails.length > 0
            ? profile.emails[0].value
            : null;

        if (!email || !isAllowedEmail(email)) {
          return done(null, false, { message: "NOT_ALLOWED" });
        }
        return done(null, { email });
      }
    )
  );

  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((obj, done) => done(null, obj));
}

// ✅ 공개 경로 예외 (운영 모니터링용: health/report + webhook/auth)
function isPublicPath(req) {
  const p = String(req.path || "");

  if (p === "/login") return true;
  if (p === "/logout") return true;

  if (p.startsWith("/auth/")) return true;
  if (p.startsWith("/health")) return true;   // /health, /health/firestore 포함
  // local only: settings api open
  const isLocal = (process.env.RUNTIME_MODE === "local") || (process.env.NODE_ENV !== "production");
  if (isLocal && p.startsWith("/api/settings/")) return true;
  if (p.startsWith("/report/")) return true;  // /report/latest, /report/weekly

  if (p === "/webhook/tv") return true;
  if (p.startsWith("/webhook/")) return true;
  if (isLocal && p.startsWith("/ui/settings/")) return true; // local only UI settings

  return false;
}

/**
 * ensureAuth
 * - 기본: Google OAuth 세션 필요
 * - 예외:
 *   1) 공개 경로(health/report/webhook/auth/login/logout)
 *   2) TAILSCALE_AUTH_BYPASS=1 + Tailscale IP(100.64/10)
 */
function ensureAuth(req, res, next) {
  const allowLocal = String(process.env.ALLOW_LOCAL_NO_OAUTH || "0") === "1";
  if (allowLocal) {
    // LOCAL_ENSUREAUTH_BYPASS_V1
    return next();
  }
  if (isPublicPath(req)) return next();

  const bypassOn = String(process.env.TAILSCALE_AUTH_BYPASS || "0") === "1";
  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.ip ||
    req.connection?.remoteAddress ||
    null;

  if (bypassOn && isTailscaleIp(ip)) return next();

  if (req.isAuthenticated && req.isAuthenticated()) return next();

  return res.redirect("/login");
}

module.exports = {
  setupGoogleAuth,
  ensureAuth,
  resolveGoogleBaseUrl,
  resolveGoogleCallbackUrl,
  __test: {
    normalizeBaseUrl,
    resolveGoogleBaseUrl,
    resolveGoogleCallbackUrl,
  },
};
