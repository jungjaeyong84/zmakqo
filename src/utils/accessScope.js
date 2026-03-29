// src/utils/accessScope.js

// tailscale 대역: 100.64.0.0/10
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

function detectAccessScope(req) {
  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.ip ||
    req.connection?.remoteAddress ||
    null;

  if (isTailscaleIp(ip)) return "tailscale";
  if (!ip) return "unknown";

  const ip2 = String(ip).replace("::ffff:", "").trim();
  if (ip2 === "127.0.0.1" || ip2 === "::1") return "local";

  return "unknown";
}

module.exports = { isTailscaleIp, detectAccessScope };
