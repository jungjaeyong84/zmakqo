#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// scripts/backfill-position-cycle-id.js
//
// 2026-04-27 Stage 3b-2 — 라이브 ACTIVE positions_paper 도큐먼트 중
// `meta.position_cycle_id` 가 비어 있는 것을 찾아서 stamp.
//
// 배경:
//   Stage 3a 가 upsertPosition / upsertPositionMetaOnly 의 write boundary
//   에서 cycle_id 를 자동 stamp 하도록 만들었다. 그러나 *아직 한 번도
//   meta-write 가 들어오지 않은* 라이브 ACTIVE 포지션에는 cycle_id 가 비어
//   있다.  Stage 3b-3 에서 cycle_id 부재를 throw-enforced invariant 로
//   격상하기 위해선 그 전에 라이브 데이터를 정리해야 한다.
//
// 동작:
//   1. positions_paper 컬렉션 스캔.
//   2. ACTIVE 판정 (state != FLAT && (size_pct > 0 || qty_base > 0)).
//   3. meta.position_cycle_id 가 비어 있으면 stamp 대상.
//   4. cycle_id 는 derivePositionCycleId 의 generate 분기를 그대로 사용 —
//      seed 는 meta.entry_event_id (있을 때).
//   5. dry-run 기본. --apply 로 실제 write (upsertPositionMetaOnly 사용 →
//      writer-lease 보호 + Stage 1 invariant validator 통과).
//
// 안전장치:
//   - upsertPositionMetaOnly 는 Stage 1 throw graduation 으로 비프로덕션
//     에서 invariant 위반을 throw 한다.  운영 데이터에 다른 invariant 위반
//     (entry_event_id 부재 등) 이 있으면 backfill 자체가 중단됨.  백필
//     스크립트는 prod 환경에서 도는 게 정석이라 (POSITION_INVARIANT_THROW_ENABLED
//     기본 false) 실제로는 throw 안 함.  CI/dev 에서 실수로 돌릴 때 안전.
//   - throttle: 도큐먼트마다 ~25ms gap 으로 Firestore RPS 절감.
//   - audit log: ops/runtime/position-cycle-id-backfill-<date>.jsonl
//     (touched / skipped / failed 모두 기록).
//
// 사용:
//   node scripts/backfill-position-cycle-id.js              # dry-run
//   node scripts/backfill-position-cycle-id.js --apply      # 실제 stamp
//   node scripts/backfill-position-cycle-id.js --apply --limit 50
// ─────────────────────────────────────────────────────────────────────────────

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");
const {
  upsertPositionMetaOnly,
  __test: positionsPaperTest,
} = require("../src/storage/positionsPaper");

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const LIMIT_FLAG = argv.findIndex((a) => a === "--limit");
const LIMIT = LIMIT_FLAG >= 0 ? Math.max(1, Number(argv[LIMIT_FLAG + 1]) || 0) : Infinity;

const PAGE_SIZE = Math.max(50, Number(process.env.POSITION_CYCLE_BACKFILL_PAGE_SIZE) || 500);
const THROTTLE_MS = Math.max(0, Number(process.env.POSITION_CYCLE_BACKFILL_THROTTLE_MS) || 25);

const AUDIT_DIR = path.resolve(__dirname, "..", "ops", "runtime");
const AUDIT_FILE = path.join(
  AUDIT_DIR,
  `position-cycle-id-backfill-${new Date().toISOString().slice(0, 10)}.jsonl`
);

function ensureAuditDir() {
  if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });
}

function appendAudit(rec) {
  ensureAuditDir();
  fs.appendFileSync(AUDIT_FILE, JSON.stringify({ ts: new Date().toISOString(), ...rec }) + "\n");
}

function upper(v) {
  return String(v || "").trim().toUpperCase() || null;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isActivePosition(doc = {}) {
  const state = upper(doc.state) || upper(doc.position_state);
  const qtyBase = toNum(doc.qty_base);
  const sizePct = toNum(doc.size_pct);
  if (state === "FLAT") return false;
  return (Number.isFinite(qtyBase) && qtyBase > 0)
    || (Number.isFinite(sizePct) && sizePct > 0);
}

function nonEmptyId(v) {
  return String(v == null ? "" : v).trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function* iteratePositionsPaper(db) {
  let lastSnap = null;
  while (true) {
    let q = db.collection("positions_paper").orderBy("__name__").limit(PAGE_SIZE);
    if (lastSnap) q = q.startAfter(lastSnap);
    const page = await q.get();
    if (page.empty) return;
    for (const doc of page.docs) yield doc;
    if (page.docs.length < PAGE_SIZE) return;
    lastSnap = page.docs[page.docs.length - 1];
  }
}

async function main() {
  console.log(`[POSITION_CYCLE_ID_BACKFILL] start mode=${APPLY ? "APPLY" : "DRY_RUN"} limit=${LIMIT === Infinity ? "∞" : LIMIT} throttle=${THROTTLE_MS}ms`);
  appendAudit({ event: "backfill_start", apply: APPLY, limit: LIMIT === Infinity ? null : LIMIT });

  const db = getFirestore();
  const stats = {
    scanned: 0,
    flat_skipped: 0,
    cycle_id_already_present: 0,
    candidates: 0,
    stamped: 0,
    failed: 0,
  };

  for await (const docSnap of iteratePositionsPaper(db)) {
    stats.scanned += 1;
    const data = docSnap.data() || {};
    if (!isActivePosition(data)) {
      stats.flat_skipped += 1;
      continue;
    }
    const meta = data.meta && typeof data.meta === "object" ? data.meta : {};
    const cycleId = nonEmptyId(meta.position_cycle_id);
    if (cycleId) {
      stats.cycle_id_already_present += 1;
      continue;
    }
    stats.candidates += 1;
    const exchange = upper(data.exchange);
    const symbol = upper(data.symbol_or_pair_id || data.symbol);
    const entryEventId = nonEmptyId(meta.entry_event_id);
    const writeToken = nonEmptyId(data.position_write_token) || null;
    const audit = {
      event: APPLY ? "backfill_stamp_attempt" : "backfill_dry_run_candidate",
      pos_id: data.pos_id || docSnap.id,
      exchange,
      symbol,
      state: data.state,
      position_state: data.position_state,
      size_pct: toNum(data.size_pct),
      qty_base: toNum(data.qty_base),
      entry_event_id: entryEventId || null,
      seeded_from_entry_event_id: !!entryEventId,
    };
    if (!APPLY) {
      // dry-run: 후보만 audit 에 기록.  실제 cycle_id 는 apply 시점에 derive
      // 되도록 (timestamp 가 그때를 반영해야 lex-sort 가 의미를 가짐).
      appendAudit(audit);
      console.log(`[DRY] ${exchange} ${symbol} pos=${audit.pos_id} entry=${entryEventId || "<none>"}`);
      if (stats.candidates >= LIMIT) break;
      continue;
    }
    // APPLY 경로 — upsertPositionMetaOnly 가 derivePositionCycleId
    // (META-only 분기) 를 호출하지만 그 분기는 prev 가 빈 cycle_id 를 가질
    // 때 *생성하지 않고* null 을 반환 (Stage 3a 디자인: META 는 사이클 생성
    // 권한 없음).  그러므로 여기서 명시적으로 cycle_id 를 meta 에 넣어
    // explicit override 분기로 들어가게 한다.
    const generatedCycleId = positionsPaperTest.generatePositionCycleId(entryEventId);
    audit.position_cycle_id = generatedCycleId;
    try {
      await upsertPositionMetaOnly({
        exchange,
        symbol,
        runId: `BACKFILL_CYCLE_ID_${Date.now()}`,
        executionMode: data.execution_mode || null,
        meta: {
          ...meta,
          position_cycle_id: generatedCycleId,
        },
        source: "scripts.backfill-position-cycle-id",
        reason: "STAGE_3B2_CYCLE_ID_BACKFILL",
        expectedWriteToken: writeToken,
        suppressAuthorityAlert: true,
        suppressAuthorityRuntimeFamily: true,
        suppressAuthorityRuntimeFamilyReason: "STAGE_3B2_CYCLE_ID_BACKFILL",
      });
      stats.stamped += 1;
      appendAudit({ ...audit, event: "backfill_stamp_ok" });
      console.log(`[APPLY] ${exchange} ${symbol} pos=${audit.pos_id} cycle=${generatedCycleId}`);
    } catch (err) {
      stats.failed += 1;
      const errAudit = {
        ...audit,
        event: "backfill_stamp_fail",
        error_code: err && err.code ? err.code : null,
        error_message: err && err.message ? err.message : String(err),
      };
      appendAudit(errAudit);
      console.error(`[FAIL] ${exchange} ${symbol} pos=${audit.pos_id} err=${errAudit.error_code || errAudit.error_message}`);
    }
    if (THROTTLE_MS > 0) await sleep(THROTTLE_MS);
    if (stats.candidates >= LIMIT) break;
  }

  appendAudit({ event: "backfill_finish", ...stats });
  console.log("[POSITION_CYCLE_ID_BACKFILL] done", stats);
  console.log(`audit: ${path.relative(process.cwd(), AUDIT_FILE)}`);
}

if (require.main === module) {
  main().then(
    () => process.exit(0),
    (err) => {
      console.error("[POSITION_CYCLE_ID_BACKFILL_FATAL]", err && err.stack ? err.stack : err);
      process.exit(1);
    }
  );
}

module.exports = { main, isActivePosition };
