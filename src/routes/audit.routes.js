const express = require("express");
const { auditFillsSignals } = require("../services/fillSignalAudit");
const { auditBinanceExitIntegrity } = require("../services/exitIntegrityAudit");

const router = express.Router();

const DAY_MS = 24 * 60 * 60 * 1000;

function allowLocal() {
  return String(process.env.ALLOW_LOCAL_NO_OAUTH || "0") === "1";
}

function ensureAuthOrSchedulerToken(req, res, next) {
  if (allowLocal()) return next();

  if (req.isAuthenticated && req.isAuthenticated()) return next();

  const expected = String(process.env.SCHEDULER_TOKEN || "");
  const token = String(req.get("x-scheduler-token") || req.get("X-Scheduler-Token") || "");
  if (expected && token === expected) return next();

  return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
}

function isDateOnly(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
}

function addDaysKst(dateOnly, days) {
  const ms = new Date(`${dateOnly}T00:00:00+09:00`).getTime() + days * DAY_MS;
  return new Date(ms).toISOString();
}

function clampIssueLimit(raw, min = 10, max = 2000) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < min) return min;
  if (n > max) return max;
  return Math.trunc(n);
}

router.get("/api/audit/fills-signals", ensureAuthOrSchedulerToken, async (req, res) => {
  try {
    const from = req.query.from ? String(req.query.from) : undefined;
    let to = req.query.to ? String(req.query.to) : undefined;
    if (to && isDateOnly(to)) {
      to = addDaysKst(to, 1);
    }
    const exchange = req.query.exchange ? String(req.query.exchange) : undefined;
    const issueLimit = clampIssueLimit(req.query.limit ?? req.query.issueLimit) ?? undefined;

    const result = await auditFillsSignals({
      from,
      to,
      exchange,
      issueLimit,
    });

    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "AUDIT_FAILED",
      message: err && err.message ? err.message : "UNKNOWN_ERROR",
    });
  }
});

router.get("/api/audit/exit-integrity", ensureAuthOrSchedulerToken, async (req, res) => {
  try {
    const includeFlat = String(req.query.includeFlat || "0") === "1";
    const symbols = req.query.symbols
      ? String(req.query.symbols).split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
      : undefined;
    const result = await auditBinanceExitIntegrity({ symbols, includeFlat });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "EXIT_INTEGRITY_AUDIT_FAILED",
      message: err && err.message ? err.message : "UNKNOWN_ERROR",
    });
  }
});

module.exports = router;
