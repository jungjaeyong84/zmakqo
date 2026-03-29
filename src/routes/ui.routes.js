const express = require("express");
const router = express.Router();
const { FieldValue } = require("firebase-admin/firestore");
const { normalizeProviderId } = require("../utils/providerUtils");

const SETTINGS_CHANGE_COLLECTION = "settings_change_log";

function reqUserCompat(req) {
  try {
    return req.user && (req.user.email || req.user.id || req.user.name)
      ? String(req.user.email || req.user.id || req.user.name)
      : null;
  } catch (_) {
    return null;
  }
}

function logLegacyRiskBudgetChange({ db, provider, before, after, req } = {}) {
  if (!db) return Promise.resolve(false);
  const beforeStr = JSON.stringify(before || {});
  const afterStr = JSON.stringify(after || {});
  if (beforeStr === afterStr) return Promise.resolve(false);

  const createdAt = new Date().toISOString();
  const createdBy = (reqUserCompat(req) || "ui_compat").slice(0, 120);
  const ipRaw = req ? (req.get("x-forwarded-for") || req.ip || "") : "";
  const actorIp = String(ipRaw || "").split(",")[0].trim();
  const userAgent = req ? String(req.get("user-agent") || "").slice(0, 200) : "";

  const payload = {
    created_at: createdAt,
    created_by: createdBy,
    source: "settings/risk_budget_legacy",
    provider: provider || null,
    scope: provider ? "provider" : "global",
    actor_ip: actorIp || null,
    user_agent: userAgent || null,
    changes: [
      {
        path: "$legacy",
        before: before || {},
        after: after || {},
      },
    ],
  };

  return db.collection(SETTINGS_CHANGE_COLLECTION).add(payload).then(() => true).catch(() => false);
}

function allowLocal() {
  return String(process.env.ALLOW_LOCAL_NO_OAUTH || "0") === "1";
}

function ensureUiPageAuth(req, res) {
  if (allowLocal()) return true;
  if (req.isAuthenticated && req.isAuthenticated()) return true;
  res.redirect("/login");
  return false;
}

function ensureUiApiAuth(req, res) {
  if (allowLocal()) return true;
  if (req.isAuthenticated && req.isAuthenticated()) return true;
  res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  return false;
}

// normalizeProviderId is centralized in providerUtils.

function defaultBudgetUnit(provider) {
  return normalizeProviderId(provider) === "BINANCEFUT" ? "USDT" : "KRW";
}

/**
 * Legacy UI routes (kept for backward compatibility)
 * - /ui/settings/risk: moved to /dashboard/settings?tab=risk
 * - /api/risk/settings: migrated to /api/settings/risk-budget
 */
router.get("/ui/settings/risk", (req, res) => {
  if (!ensureUiPageAuth(req, res)) return;
  return res.redirect(302, "/dashboard/settings?tab=risk");
});

// Legacy API (compat): read from canonical settings/risk_budget
router.get("/api/risk/settings", async (req, res) => {
  if (!ensureUiApiAuth(req, res)) return;
  try {
    const providerRaw = req.query.provider || req.query.exchange || "";
    if (providerRaw) {
      const provider = normalizeProviderId(providerRaw);
      const { getRiskBudgetForProvider } = require("../utils/exchangeSettings");
      const r = await getRiskBudgetForProvider(provider, 0);
      const data = r && r.data ? r.data : null;
      return res.json({
        ok: true,
        deprecated: true,
        provider,
        migrate_to: "/api/settings/risk-budget?provider=" + encodeURIComponent(provider),
        source: r && r.source ? r.source : "unknown",
        data: data || {},
      });
    }

    const { getRiskBudgetCached } = require("../storage/settings");
    const r = await getRiskBudgetCached(0);
    const data = r && r.data ? r.data : null;
    return res.json({
      ok: true,
      deprecated: true,
      migrate_to: "/api/settings/risk-budget",
      source: r.source || "unknown",
      data: data || {},
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "RISK_SETTINGS_GET_ERROR", message: e.message });
  }
});

// Legacy API (compat): write to canonical settings/risk_budget
router.post("/api/risk/settings", async (req, res) => {
  if (!ensureUiApiAuth(req, res)) return;
  try {
    const body = req.body || {};
    const providerRaw = req.query.provider || req.query.exchange || body.provider || "";
    const provider = providerRaw ? normalizeProviderId(providerRaw) : "";
    const rawOn = String(body.on_exceed || "CLAMP").toUpperCase();
    const on_exceed = (rawOn === "HALT" || rawOn === "SKIP" || rawOn === "STOP") ? "SKIP" : "CLAMP";

    const by_market = {};
    const by = (body.by_market && typeof body.by_market === "object") ? body.by_market : {};
    for (const [mk, v] of Object.entries(by)) {
      const key = String(mk || "").trim();
      if (!key) continue;
      let raw = v;
      if (raw && typeof raw === "object") raw = raw.max_krw ?? raw.maxKrw ?? raw.value ?? null;
      const n = Math.trunc(Number(raw));
      if (!Number.isFinite(n) || n < 0) continue;
      by_market[key] = n;
    }

    const totalRaw = (body.total_max_krw ?? body.total_budget_krw ?? body.total_krw ?? 0);
    const payload = {
      enabled: !!body.enabled,
      on_exceed,
      total_max_krw: Math.trunc(Number(totalRaw || 0)),
      default_max_krw: Math.trunc(Number(body.default_max_krw || 0)),
      by_market,
      updated_at: new Date().toISOString(),
      updated_by: "ui_compat",
    };

    const { getFirestore } = require("../storage/firestore");
    const { invalidateRiskBudgetCache } = require("../storage/settings");
    const db = getFirestore();
    const beforeSnap = await db.collection("settings").doc("risk_budget").get();
    const beforeRaw = beforeSnap.exists ? (beforeSnap.data() || {}) : {};
    const beforeEntry = provider
      ? ((beforeRaw.providers && typeof beforeRaw.providers === "object") ? beforeRaw.providers[provider] : null)
      : beforeRaw;
    let afterEntry = null;

    if (provider) {
      await db.runTransaction(async (tx) => {
        const ref = db.collection("settings").doc("risk_budget");
        const snap = await tx.get(ref);
        const raw = snap.exists ? (snap.data() || {}) : {};
        const providers = (raw.providers && typeof raw.providers === "object") ? { ...raw.providers } : {};
        const merged = {
          ...providers[provider],
          ...payload,
          provider,
          unit: defaultBudgetUnit(provider),
        };
        providers[provider] = merged;
        afterEntry = merged;
        tx.set(ref, { providers }, { merge: true });
      });
      const beforeBy = (beforeEntry && typeof beforeEntry === "object" && beforeEntry.by_market && typeof beforeEntry.by_market === "object")
        ? beforeEntry.by_market
        : {};
      const deletePayload = {};
      for (const mk of Object.keys(beforeBy)) {
        if (!Object.prototype.hasOwnProperty.call(by_market, mk)) {
          deletePayload[`providers.${provider}.by_market.${mk}`] = FieldValue.delete();
        }
      }
      if (Object.keys(deletePayload).length) {
        const ref = db.collection("settings").doc("risk_budget");
        try {
          await ref.update(deletePayload);
        } catch (_) {
          await ref.set(deletePayload, { merge: true });
        }
      }
    } else {
      await db.collection("settings").doc("risk_budget").set(payload, { merge: true });
      const beforeBy = (beforeRaw && typeof beforeRaw.by_market === "object" && beforeRaw.by_market)
        ? beforeRaw.by_market
        : {};
      const deletePayload = {};
      for (const mk of Object.keys(beforeBy)) {
        if (!Object.prototype.hasOwnProperty.call(by_market, mk)) {
          deletePayload[`by_market.${mk}`] = FieldValue.delete();
        }
      }
      if (Object.keys(deletePayload).length) {
        const ref = db.collection("settings").doc("risk_budget");
        try {
          await ref.update(deletePayload);
        } catch (_) {
          await ref.set(deletePayload, { merge: true });
        }
      }
      afterEntry = payload;
    }
    try { invalidateRiskBudgetCache(); } catch (_) {}
    try {
      if (afterEntry) {
        await db.collection("risk_budget_history").add({
          created_at: payload.updated_at,
          created_by: payload.updated_by,
          source: "settings/risk_budget_legacy",
          provider: afterEntry.provider || provider || null,
          snapshot: afterEntry,
        });
      }
    } catch (_) {}
    try {
      await logLegacyRiskBudgetChange({
        db,
        provider,
        before: beforeEntry || {},
        after: afterEntry || payload,
        req,
      });
    } catch (_) {}

    return res.json({
      ok: true,
      deprecated: true,
      stored: provider ? "settings/risk_budget.providers" : "settings/risk_budget",
      migrate_to: provider
        ? "/api/settings/risk-budget?provider=" + encodeURIComponent(provider)
        : "/api/settings/risk-budget",
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "RISK_SETTINGS_POST_ERROR", message: e.message });
  }
});

module.exports = router;
