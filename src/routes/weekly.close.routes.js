const express = require("express");
const router = express.Router();

const { getFirestore } = require("../storage/firestore");

function requireSchedulerToken(req, res, next) {
  const expected = String(process.env.SCHEDULER_TOKEN || "");
  const token = String(req.get("x-scheduler-token") || req.get("X-Scheduler-Token") || "");
  if (!expected) return res.status(500).json({ ok: false, error: "SCHEDULER_TOKEN_NOT_SET" });
  if (token !== expected) return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  next();
}

async function postJson(url, token, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-scheduler-token": token,
    },
    body: JSON.stringify(body || {}),
  });
  const txt = await res.text();
  let json = null;
  try {
    json = txt ? JSON.parse(txt) : null;
  } catch (_) {
    json = null;
  }
  return { status: res.status, ok: res.ok, json, txt };
}

router.post("/scheduler/weekly-close", requireSchedulerToken, async (req, res) => {
  const db = getFirestore();

  const baseUrl = String(process.env.BASE_URL || "") || `${req.protocol}://${req.get("host")}`;
  const token = String(process.env.SCHEDULER_TOKEN || "");

  // pass-through inputs (optional)
  const input = req.body || {};
  const requestedWeek = String(input.week || "").trim();
  const requestedFrom = input.from;
  const requestedTo = input.to;
  const requestedMarkets = input.markets;
  const requestedExchange = input.exchange;
  const requestedTf = input.tf;

  // 1) eval_weekly
  const r1 = await postJson(`${baseUrl}/scheduler/eval-weekly`, token, {
    week: requestedWeek || undefined,
    from: requestedFrom || undefined,
    to: requestedTo || undefined,
    markets: requestedMarkets || undefined,
    exchange: requestedExchange || undefined,
    tf: requestedTf || undefined,
    mode: "weekly",
  });

  // Derive effective week/range
  const effectiveWeek =
    String(r1?.json?.week || r1?.json?.eval_weekly?.eval_id || requestedWeek || "").trim() || null;
  const range = r1?.json?.eval_weekly?.range || null;

  // 2) promote KEEP (optional, fail-open)
  const r2 = await postJson(`${baseUrl}/scheduler/rules/promote`, token, {
    week: effectiveWeek || undefined,
    decision: "KEEP",
    mode: "weekly",
    exchange: requestedExchange || undefined,
  });

  // 3) drop-sync
  const r3 = await postJson(`${baseUrl}/scheduler/filters/drop-sync`, token, {
    week: effectiveWeek || undefined,
    mode: "weekly",
    exchange: requestedExchange || undefined,
  });

  // 4) report-run (weekly snapshot for dashboard)
  const allowReportRun = String(process.env.AUTO_WEEKLY_REPORT_RUN || "1") !== "0";
  const r4 = allowReportRun
    ? await postJson(`${baseUrl}/scheduler/report-run?mode=weekly`, token, {
      exchange: requestedExchange || undefined,
    })
    : { status: 0, ok: false, json: null, txt: "SKIPPED_AUTO_WEEKLY_REPORT_RUN" };

  // 5) patch-suggest (optional)
  const allowPatchSuggest = String(process.env.AUTO_WEEKLY_PATCH_SUGGEST || "0") === "1";
  const r5 = allowPatchSuggest
    ? await postJson(`${baseUrl}/scheduler/patch-suggest`, token, {
      week: effectiveWeek || undefined,
      from: range?.from || requestedFrom || undefined,
      to: range?.to || requestedTo || undefined,
      exchange: requestedExchange || undefined,
      mode: "weekly",
    })
    : { status: 0, ok: false, json: null, txt: "SKIPPED_AUTO_WEEKLY_PATCH_SUGGEST" };

  // 6) report pack URL (weekly)
  let reportPackUrl = null;
  try {
    const fromMs = Number(range?.from_ms);
    const toMs = Number(range?.to_ms);
    if (Number.isFinite(fromMs) && Number.isFinite(toMs) && fromMs < toMs) {
      const fromISO = new Date(fromMs).toISOString();
      const toISO = new Date(toMs).toISOString();
      const qp = new URLSearchParams({
        from: fromISO,
        to: toISO,
        mode: "weekly",
      });
      if (requestedExchange) qp.set("exchange", String(requestedExchange));
      if (effectiveWeek) qp.set("week", effectiveWeek);
      reportPackUrl = `${baseUrl}/api/report/pack?${qp.toString()}`;
    }
  } catch (_) {
    reportPackUrl = null;
  }

  // 7) write weekly_runs
  const runDoc = {
    created_at: new Date().toISOString(),
    mode: "weekly",
    week: effectiveWeek,
    input: {
      week: requestedWeek || null,
      from: requestedFrom || null,
      to: requestedTo || null,
      markets: Array.isArray(requestedMarkets) ? requestedMarkets : null,
      exchange: requestedExchange || null,
      tf: requestedTf || null,
    },
    eval_weekly: { status: r1.status, ok: r1.ok, json_ok: Boolean(r1.json?.ok), error: r1.json?.error || null },
    rules_promote: { status: r2.status, ok: r2.ok, json_ok: Boolean(r2.json?.ok), error: r2.json?.error || null },
    filters_drop_sync: { status: r3.status, ok: r3.ok, json_ok: Boolean(r3.json?.ok), error: r3.json?.error || null },
    report_run: { status: r4.status, ok: r4.ok, json_ok: Boolean(r4.json?.ok), error: r4.json?.error || null },
    patch_suggest: { status: r5.status, ok: r5.ok, json_ok: Boolean(r5.json?.ok), error: r5.json?.error || null },
    report_pack_url: reportPackUrl,
  };

  try {
    const id = `${effectiveWeek || "WEEK"}_${Date.now()}`;
    await db.collection("weekly_runs").doc(id).set(runDoc, { merge: true });
  } catch (_) {
    // ignore
  }

  return res.json({
    ok: r1.ok && r3.ok,
    week: effectiveWeek,
    range,
    steps: {
      eval_weekly: r1,
      rules_promote: r2,
      filters_drop_sync: r3,
      report_run: r4,
      patch_suggest: r5,
    },
    report_pack_url: reportPackUrl,
  });
});

module.exports = router;
