// src/storage/positionsPaper.js
const crypto = require("crypto");
const { getFirestore } = require("./firestore");
const { __test: positionEventTest } = require("./positionEvents");
const { __test: latestReadModelTest } = require("./positionReadModelLatest");
const { recordPositionWriterAuthorityEvent } = require("./positionWriterAuthorityEvents");
const { validatePositionSnapshotTransition } = require("../services/positionStateMachine");
const {
  validatePositionMetaPrices,
  describeViolations: describeMetaPriceViolations,
} = require("../services/positionMetaSchema");
const {
  validateActivePositionInvariants,
  validateMetaPatchInvariants,
  validatePositionCycleIdPresence,
  describeViolations: describeActiveInvariantViolations,
} = require("../services/positionActivePositionInvariants");
const { normalizeTraceContext } = require("../utils/traceContext");
const { sendAlert } = require("../utils/alerts");

function nowIso() {
  return new Date().toISOString();
}

// 2026-04-19 PR #10: position meta price schema warn-only observation.
//
// 이 validator 는 아직 write 를 막지 않는다 — Cloud Logging 의
// `position_meta_price_schema_violation` warn 카운트가 0 에 수렴하는
// 것을 확인한 뒤에야 dev/CI 에서 throw 로 격상한다. 경로는:
//
//   1. warn-only (현재)   — 여기서 잡는 모든 위반을 관찰
//   2. dev/CI throw       — 카운트 0 수렴 후 POSITION_META_PRICE_SCHEMA_STRICT
//                           로 dev 경로에서 실패로 바꿈
//   3. prod optional      — prod 런타임에도 optional throw 로 확장
//
// 지금 이 지점에서 warn 을 발화해두면 PR #8 (trail_low=0) / PR #9
// (native_protection_stop_price=null → downstream 에서 0 으로 전락)
// 같은 class 의 버그가 어느 write path 에서 유입되는지를
// `mutation_kind + source + reason` 로 근본 위치까지 추적 가능.
function structuredLog(event, payload = {}, level = "log") {
  const rec = {
    event,
    ts: new Date().toISOString(),
    ...payload,
  };
  const fn = level === "warn" ? "warn" : "log";
  try {
    console[fn](JSON.stringify(rec));
  } catch (_) {
    console[fn](`[${event}] ${event}`);
  }
}

function observeMetaPriceSchema({
  meta,
  mutationKind,
  writerScope,
  exchange,
  symbol,
  source,
  reason,
  requestId,
  traceId,
  runId,
} = {}) {
  // meta 가 object 가 아니면 validator 가 즉시 ok=true 를 돌려주므로
  // 호출측에서 따로 guard 할 필요 없음. validator 자체가 비싸지 않고
  // (필드 8개 × hasOwnProperty) write 는 이미 Firestore RTT 를 동반하는
  // 훨씬 무거운 연산이므로 여기서 분기 타이밍을 아낄 이유도 없다.
  const res = validatePositionMetaPrices(meta);
  if (res.ok) return;
  structuredLog("position_meta_price_schema_violation", {
    exchange: exchange || null,
    symbol: symbol || null,
    mutation_kind: mutationKind || null,
    writer_scope: writerScope || null,
    source: source || null,
    reason: reason || null,
    request_id: requestId || null,
    trace_id: traceId || null,
    run_id: runId || null,
    violation_n: res.violations.length,
    violations: res.violations.slice(0, 8), // 8개 필드가 최대이므로 cap
    summary: describeMetaPriceViolations(res.violations),
  }, "warn");
}

// 2026-04-27 P0-A: lineage / lifecycle invariant 의 warn-only 관찰. price
// schema 와 동일 패턴이지만, 이 layer 는 *meta-internal 일관성* 과
// *active-coupled 강제 필드* 두 부류를 함께 본다.  CORE 경로
// (upsertPosition) 는 state/sizePct/positionSide 를 알기에 full-snapshot
// validator 를, META 경로 (upsertPositionMetaOnly) 는 meta 패치 단독으로
// 검증 가능한 lineage 계약만 본다.
//
// price schema 와 마찬가지로 트랜잭션 retry 루프 밖에서 한 번만 발화 —
// 같은 논리적 intent 가 retry 카운트로 부풀어 alert 가 왜곡되는 것을 막음.
function observeActivePositionInvariants({
  scope,
  meta,
  state,
  positionState,
  positionSide,
  sizePct,
  qtyBase,
  mutationKind,
  writerScope,
  exchange,
  symbol,
  source,
  reason,
  requestId,
  traceId,
  runId,
} = {}) {
  let res;
  if (scope === "META_PATCH") {
    res = validateMetaPatchInvariants(meta);
  } else {
    res = validateActivePositionInvariants({
      state,
      positionState,
      positionSide,
      sizePct,
      qtyBase,
      meta,
    });
  }
  if (res.ok) return;
  structuredLog("position_active_invariant_violation", {
    exchange: exchange || null,
    symbol: symbol || null,
    mutation_kind: mutationKind || null,
    writer_scope: writerScope || null,
    invariant_scope: scope || null,
    source: source || null,
    reason: reason || null,
    request_id: requestId || null,
    trace_id: traceId || null,
    run_id: runId || null,
    state: state || null,
    position_state: positionState || null,
    position_side: positionSide || null,
    size_pct: Number.isFinite(Number(sizePct)) ? Number(sizePct) : null,
    qty_base: Number.isFinite(Number(qtyBase)) ? Number(qtyBase) : null,
    violation_n: res.violations.length,
    // 위반 객체는 reason 분류용이라 cap=12. 실 운영에서 한 번에
    // 12 개 이상 위반이 동시에 터질 만큼 코드가 망가지는 시나리오는
    // 이미 invariant 차원의 문제가 아닌 catastrophic data corruption.
    violations: res.violations.slice(0, 12),
    summary: describeActiveInvariantViolations(res.violations),
  }, "warn");
  // P0-C: fire-and-forget Slack push. await 하지 않음 — observer 는 sync,
  // write 경로의 latency 에 영향 주면 안 됨. 알림 자체 실패 시 helper
  // 안에서 console.warn 으로 흡수.
  notifyActivePositionInvariantViolation({
    exchange,
    symbol,
    mutationKind,
    invariantScope: scope,
    source,
    reason,
    requestId,
    traceId,
    runId,
    state,
    positionState,
    positionSide,
    sizePct,
    qtyBase,
    violations: res.violations,
  }).catch((err) => {
    const msg = err && err.message ? err.message : String(err);
    console.warn("[POSITION_INVARIANT_ALERT_DISPATCH_FAIL]", msg);
  });
  // 2026-04-27 P0-A throw graduation. fire-and-forget Slack push 는
  // 위에서 이미 detached 됐으므로 throw 가 알림 dispatch 를 끊지 않는다.
  // 호출자에게 typed error 를 던져 Firestore write 자체를 차단한다 —
  // observe 는 transaction 시작 *이전* 에 호출되므로 corruption 발생 전
  // 차단 (pre-commit gate).
  if (POSITION_INVARIANT_THROW_ENABLED === true) {
    const summary = describeActiveInvariantViolations(res.violations);
    const err = new Error(
      `[POSITION_INVARIANT_VIOLATION] ${exchange || "?"} ${symbol || "?"} `
      + `${scope || "?"} ${summary || "INVARIANT_BREACH"}`
    );
    err.code = "POSITION_INVARIANT_VIOLATION";
    err.invariantScope = scope || null;
    err.invariantViolations = res.violations.slice(0, 12);
    err.invariantExchange = exchange || null;
    err.invariantSymbol = symbol || null;
    err.invariantMutationKind = mutationKind || null;
    err.invariantReason = reason || null;
    throw err;
  }
}

// 2026-04-27 Stage 3b-1 — position_cycle_id presence warn-only observer.
//
// Stage 3a 가 모든 신규 ACTIVE write 에서 cycle_id 를 stamp 하지만, 라이브
// 에서 이미 ACTIVE 인 *기존* 포지션은 cycle_id 가 비어 있을 수 있다.  이
// observer 는 transaction 안에서 stamp 가 끝난 *후* 의 meta 를 받아서,
// `position_cycle_id` 가 여전히 비어 있으면 (예: META-only 경로 + 라이브
// 백필이 아직 안 됐을 때) warn 을 한 번 발화한다.
//
// 일반 invariant 와 분리된 이유:
//   - Stage 1 의 throw graduation 이 전체 invariant 를 prod 외에서 throw
//     시킨다. cycle_id 부재를 거기 묶으면 backfill 전에 라이브 META 트래픽
//     까지 차단됨.
//   - 운영 데이터에서 발생률이 0 으로 수렴(또는 backfill 완료) 한 후
//     Stage 3b-3 에서 `validateActivePositionInvariants` 본체에 통합 →
//     자동으로 throw 격상.
//
// rate-limit / Slack push 는 일부러 안 붙임. cycle_id 부재 빈도가 어느
// 정도일지 운영 데이터 보기 전이라, 우선 구조화 로그만으로 cardinality
// 부터 측정. 이후 P0-C 패턴처럼 channel 추가 가능.
function observePositionCycleIdPresence({
  scope,
  meta,
  state,
  positionState,
  positionSide,
  sizePct,
  qtyBase,
  mutationKind,
  writerScope,
  exchange,
  symbol,
  source,
  reason,
  requestId,
  traceId,
  runId,
} = {}) {
  const res = validatePositionCycleIdPresence({
    state,
    positionState,
    sizePct,
    qtyBase,
    meta,
  });
  if (res.ok) return;
  structuredLog("position_cycle_id_missing", {
    exchange: exchange || null,
    symbol: symbol || null,
    mutation_kind: mutationKind || null,
    writer_scope: writerScope || null,
    invariant_scope: scope || null,
    source: source || null,
    reason: reason || null,
    request_id: requestId || null,
    trace_id: traceId || null,
    run_id: runId || null,
    state: state || null,
    position_state: positionState || null,
    position_side: positionSide || null,
    size_pct: Number.isFinite(Number(sizePct)) ? Number(sizePct) : null,
    qty_base: Number.isFinite(Number(qtyBase)) ? Number(qtyBase) : null,
    violation_n: res.violations.length,
    violations: res.violations.slice(0, 4),
  }, "warn");
  // 2026-04-27 Stage 3b-3 — pre-commit gate for cycle_id 부재.
  // Stage 3b-1 의 warn-only 관찰을 backfill 종료 후 throw 로 격상.
  // observe 는 transaction 진입 *이전* 에 호출되므로 throw 시 Firestore
  // write 자체가 일어나지 않음 (Stage 1 throw 와 동일 패턴).
  if (POSITION_CYCLE_ID_THROW_ENABLED === true) {
    const err = new Error(
      `[POSITION_CYCLE_ID_VIOLATION] ${exchange || "?"} ${symbol || "?"} `
      + `${scope || "?"} ACTIVE_REQUIRES_POSITION_CYCLE_ID`
    );
    err.code = "POSITION_CYCLE_ID_VIOLATION";
    err.invariantScope = scope || null;
    err.invariantViolations = res.violations.slice(0, 4);
    err.invariantExchange = exchange || null;
    err.invariantSymbol = symbol || null;
    err.invariantMutationKind = mutationKind || null;
    err.invariantReason = reason || null;
    throw err;
  }
}

function boolEnv(name, fallback = false) {
  const raw = String(process.env[name] == null ? "" : process.env[name]).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

const POSITION_STATE_MACHINE_STRICT = boolEnv("POSITION_STATE_MACHINE_STRICT", true);
const POSITION_EVENT_LOG_ENABLED = boolEnv("POSITION_EVENT_LOG_ENABLED", true);
const POSITION_EVENT_LOG_STRICT = boolEnv("POSITION_EVENT_LOG_STRICT", false);
const POSITION_WRITE_TOKEN_REQUIRED = boolEnv("POSITION_WRITE_TOKEN_REQUIRED", true);
const POSITION_WRITER_LEASE_ENABLED = boolEnv("POSITION_WRITER_LEASE_ENABLED", true);
const POSITION_WRITER_ALERT_ENABLED = boolEnv("POSITION_WRITER_ALERT_ENABLED", true);
const POSITION_WRITER_LEASE_TTL_MS = Math.max(3000, Math.floor(Number(process.env.POSITION_WRITER_LEASE_TTL_MS) || 15000));
const POSITION_WRITER_LEASE_WAIT_MS = Math.max(0, Math.floor(Number(process.env.POSITION_WRITER_LEASE_WAIT_MS) || 2000));
const POSITION_WRITER_ALERT_COOLDOWN_MS = Math.max(0, Math.floor(Number(process.env.POSITION_WRITER_ALERT_COOLDOWN_MS) || (5 * 60 * 1000)));
const POSITION_WRITER_ALERT_CHANNEL = String(
  process.env.POSITION_WRITER_ALERT_CHANNEL
  || process.env.EXIT_INTEGRITY_ALERT_CHANNEL
  || ""
).trim() || null;

// 2026-04-27 P0-C: invariant violation Slack alert.
// warn-only structuredLog 만으로는 사람이 cloud logging 을 매번
// 들여다봐야 함 — invariant 가 실제로 위반되는 순간 즉시 운영자가 알 수
// 있어야 함. authority-failure 알림과 별도 cooldown 을 둔 이유:
//   - authority-failure 는 "Firestore 락 경합 등 인프라 이슈" — 5분 쿨다운.
//   - invariant 위반은 "데이터 모양이 깨졌다" — 더 긴 쿨다운(30분)으로
//     같은 (symbol, reason) 의 반복 알림으로 인한 fatigue 방지.
// CHANNEL 이 비어 있으면 자동 no-op (배포 환경에서 채널 미설정 시 알림
// 안 감 — 알림 인프라 깔리기 전에 enable 켜져 있어도 안전).
const POSITION_INVARIANT_ALERT_ENABLED = boolEnv("POSITION_INVARIANT_ALERT_ENABLED", true);
// 2026-04-27 P0-A throw graduation step 1.
//
// observeActivePositionInvariants 는 serializePositionMutation/transaction
// 시작 *이전* 에 호출된다 (line 1038/1216). 따라서 여기서 throw 하면
// Firestore 에 단 1 byte 도 쓰이지 않은 채 호출자에게 에러가 전달되며,
// 데이터 corruption 자체가 발생하지 않는 *pre-commit gate* 로 동작한다.
// warn-only 와 차이: warn 은 "쓰이고 나서 알림", throw 는 "쓰지 않고 차단".
//
// 단계적 cutover:
//   step 1 (this commit): env-gated. 기본값은 NODE_ENV !== 'production'.
//                          full test suite 를 THROW=1 로 돌려 pre-existing
//                          위반이 없음을 확인한 뒤 dev/CI 에서 켰음.
//                          prod 는 명시적 opt-in 전까지 warn-only 유지.
//   step 2 (별도 deploy):  운영 soak 1–2주 후 prod 도 THROW=1 enable.
//
// 안전장치: throw 가 활성화돼도 alert/log 는 그대로 발화 — 운영자가
// "왜 거부됐는지" 까지 즉시 인지할 수 있도록 함.
const POSITION_INVARIANT_THROW_DEFAULT_NON_PROD = String(process.env.NODE_ENV || "").toLowerCase() !== "production";
const POSITION_INVARIANT_THROW_ENABLED = boolEnv(
  "POSITION_INVARIANT_THROW_ENABLED",
  POSITION_INVARIANT_THROW_DEFAULT_NON_PROD,
);
// 2026-04-27 Stage 3b-3 — position_cycle_id throw graduation.
//
// Stage 3b-1 added a warn-only observer for cycle_id 부재.  Stage 3b-2 의
// backfill 스크립트가 라이브 ACTIVE 잔재를 정리한 뒤, 부재를 throw 로
// 격상해 다음과 같은 현상을 영구히 차단한다:
//   - META-only 경로가 (Stage 3a 의 derive 가 cycle_id 를 만들지 않으므로)
//     cycle_id 없는 prev 위에 다시 cycle_id 없는 ACTIVE 를 쓰는 케이스.
//   - 외부 동기화/repair 경로가 cycle_id 키를 빼먹고 ACTIVE 를 쓰는 케이스.
// throw 는 별도 env (`POSITION_CYCLE_ID_THROW_ENABLED`) 로 격리한다 — 일반
// invariant throw 와 운영 cutover 타이밍이 다르기 때문 (backfill 종료 후
// 별도 soak).  default 는 일반 invariant 와 동일하게 NODE_ENV !== 'production'
// 일 때 true.  prod 격상은 별도 deploy.
const POSITION_CYCLE_ID_THROW_ENABLED = boolEnv(
  "POSITION_CYCLE_ID_THROW_ENABLED",
  POSITION_INVARIANT_THROW_DEFAULT_NON_PROD,
);
const POSITION_INVARIANT_ALERT_COOLDOWN_MS = Math.max(0, Math.floor(Number(process.env.POSITION_INVARIANT_ALERT_COOLDOWN_MS) || (30 * 60 * 1000)));
const POSITION_INVARIANT_ALERT_CHANNEL = String(
  process.env.POSITION_INVARIANT_ALERT_CHANNEL
  || process.env.POSITION_WRITER_ALERT_CHANNEL
  || process.env.EXIT_INTEGRITY_ALERT_CHANNEL
  || ""
).trim() || null;
const positionMutationQueue = new Map();
const positionWriterAlertState = new Map();
const positionInvariantAlertState = new Map();
const positionWriterLeaseHolderId = `positions_paper_writer__${process.env.K_REVISION || process.env.HOSTNAME || "local"}__${process.pid}`;
const positionWriterLeaseDepth = new Map();

function posId({ exchange, symbol }) {
  return `POS__${String(exchange || "").toUpperCase().trim()}__${String(symbol || "").toUpperCase().trim()}`;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function cloneValue(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positionWriterLeaseKey(exchange, symbol) {
  return `${upper(exchange) || "UNKNOWN"}::${upper(symbol) || "UNKNOWN"}`;
}

async function serializePositionMutation({ exchange, symbol, runner } = {}) {
  if (typeof runner !== "function") throw new Error("serializePositionMutation: runner required");
  const key = `${upper(exchange) || "UNKNOWN"}::${upper(symbol) || "UNKNOWN"}`;
  const previous = positionMutationQueue.get(key) || Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(() => runner());
  positionMutationQueue.set(key, current);
  try {
    return await current;
  } finally {
    if (positionMutationQueue.get(key) === current) positionMutationQueue.delete(key);
  }
}

function derivePositionState(sizePct, meta = {}) {
  const size = Number(sizePct);
  if (!Number.isFinite(size) || size <= 0) return "FLAT";
  if (meta && meta.tp_p1_done === true) return "SCALE_OUT";
  if (size < 0.5) return "PROBE";
  return "COMMIT";
}

// 2026-04-27 Stage 3a — explicit position_cycle_id stamp (vulnerability B
// structural fix, foundation phase).
//
// 배경: V2 entry kernel / runtime chain audit / alert worker 는 이미
// `position_cycle_id` 라는 1급 식별자로 사이클을 추적한다 (src/v2/storage.js
// POSITION_CYCLES 참조).  그러나 정작 positions_paper 의 meta 에는 이
// id 가 강제 stamp 되지 않아, 어떤 사이클인지 식별하려면 entry_event_id
// 에 의존해야 한다.  entry_event_id 는 cycle 마다 바뀌는 implicit signal
// 이라, tp_p1_done 같은 lifecycle flag 가 cross-cycle 로 leak 되었을 때
// 비교 기준이 모호해진다 (Stage 1 invariant validator 가 LINEAGE_MISMATCH
// 로 잡지만, 그건 *증상* 검출이지 *근본* 식별자는 아니다).
//
// Stage 3a 의 목표 (이 변경): 모든 CORE upsertPosition write 가
// `meta.position_cycle_id` 를 명시적으로 stamp 하도록 만든다.
// 다음 규칙으로 도출:
//
//   1. FLAT 으로 가는 write (sizePct <= 0)            → null. cycle 종료.
//   2. caller 가 meta.position_cycle_id 를 명시       → 그대로 사용
//                                                       (V2 entry kernel
//                                                        같은 source-of-
//                                                        truth 가 owns).
//   3. 직전이 ACTIVE + cycle_id 보유                  → preserve
//                                                       (사이클 내 churn).
//   4. FLAT→ACTIVE 진입 (또는 cycle_id 비어 있는 ACTIVE → backfill)
//                                                     → 새로 generate.
//      seed 는 entry_event_id (가능하면 의미 추적성 ↑).
//
// **이 단계에서 invariant 추가는 안 함** — 단순 additive observation.
// Stage 3b 에서 모든 ACTIVE write 가 cycle_id 를 갖는지 강제하는
// validator 를 warn-only → throw 로 격상 예정.
function generatePositionCycleId(seed) {
  const ts = Date.now();
  const tsStr = String(ts).padStart(14, "0");
  const tag = String(seed || "").trim().replace(/[^a-zA-Z0-9]/g, "").slice(0, 32)
    || Math.random().toString(36).slice(2, 8);
  return `pcid_${tsStr}_${tag}`;
}

function derivePositionCycleId({ prev = null, incomingMeta = null, sizePct = null } = {}) {
  const incomingSize = Number(sizePct);
  const isFlatTarget = !Number.isFinite(incomingSize) || incomingSize <= 0;
  if (isFlatTarget) return null;
  const explicit = String((incomingMeta && incomingMeta.position_cycle_id) || "").trim();
  if (explicit) return explicit;
  const prevMeta = (prev && prev.meta) || {};
  const prevSize = Number(prev && prev.size_pct);
  const prevWasActive = Number.isFinite(prevSize) && prevSize > 0;
  const prevCycle = String(prevMeta.position_cycle_id || "").trim();
  if (prevWasActive && prevCycle) return prevCycle;
  const seed = String((incomingMeta && incomingMeta.entry_event_id) || "").trim();
  return generatePositionCycleId(seed);
}

// META-only writes never *create* a cycle — they only carry forward whatever
// the previous snapshot had, or accept an explicit override from the caller.
// Cycle creation is owned by upsertPosition (CORE).
function deriveMetaOnlyPositionCycleId({ prev = null, incomingMeta = null } = {}) {
  const explicit = String((incomingMeta && incomingMeta.position_cycle_id) || "").trim();
  if (explicit) return explicit;
  const prevMeta = (prev && prev.meta) || {};
  const prevCycle = String(prevMeta.position_cycle_id || "").trim();
  return prevCycle || null;
}

function buildFlatPositionSnapshot({ exchange, symbol, id = null } = {}) {
  return {
    pos_id: id || posId({ exchange, symbol }),
    exchange,
    symbol_or_pair_id: symbol,
    state: "FLAT",
    position_state: "FLAT",
    position_side: null,
    size_pct: 0,
    avg_price: null,
    qty_base: null,
    position_write_token: null,
    meta: {},
    updated_at: null,
  };
}

function formatTransitionIssues(issues = []) {
  return (Array.isArray(issues) ? issues : []).map((issue) => ({
    code: upper(issue && issue.code),
    severity: upper(issue && issue.severity),
    message: issue && issue.message ? String(issue.message) : null,
  }));
}

function buildTransitionError({ exchange, symbol, mutationKind, validation } = {}) {
  const issues = formatTransitionIssues(validation && validation.issues);
  const text = issues.map((issue) => `${issue.code}:${issue.severity}`).join(",");
  const err = new Error(`[POSITION_STATE_MACHINE] ${upper(exchange) || "UNKNOWN"} ${upper(symbol) || "UNKNOWN"} ${upper(mutationKind) || "POSITION_UPSERT"} ${text || "INVALID"}`);
  err.code = "POSITION_STATE_MACHINE_REJECTED";
  err.validation = validation || null;
  return err;
}

function resolveNextWriterVersion(previous = {}, scope = "CORE") {
  const writerVersion = Number(previous.writer_version);
  const coreVersion = Number(previous.core_writer_version);
  const metaVersion = Number(previous.meta_writer_version);
  return {
    writer_version: (Number.isFinite(writerVersion) ? writerVersion : 0) + 1,
    core_writer_version: scope === "CORE"
      ? ((Number.isFinite(coreVersion) ? coreVersion : 0) + 1)
      : (Number.isFinite(coreVersion) ? coreVersion : 0),
    meta_writer_version: scope === "META"
      ? ((Number.isFinite(metaVersion) ? metaVersion : 0) + 1)
      : (Number.isFinite(metaVersion) ? metaVersion : 0),
  };
}

function buildNextPositionWriteToken() {
  return crypto.randomBytes(12).toString("hex");
}

function buildPositionWriterLeaseDocPath(exchange, symbol) {
  return `runtime_locks/positions_paper_writer__${upper(exchange) || "UNKNOWN"}__${upper(symbol) || "UNKNOWN"}`;
}

async function acquirePositionWriterLease({
  exchange,
  symbol,
  ttlMs = POSITION_WRITER_LEASE_TTL_MS,
  holderId = positionWriterLeaseHolderId,
} = {}) {
  const db = getFirestore();
  const now = Date.now();
  const leaseUntil = now + Math.max(3000, Math.floor(Number(ttlMs) || POSITION_WRITER_LEASE_TTL_MS));
  const ref = db.doc(buildPositionWriterLeaseDocPath(exchange, symbol));
  let acquired = false;
  let holder = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() || {}) : {};
    const owner = String(data.owner || "");
    const leaseUntilMs = Number(data.lease_until_ms);
    const expired = !Number.isFinite(leaseUntilMs) || leaseUntilMs <= now;
    if (!owner || owner === holderId || expired) {
      acquired = true;
      tx.set(ref, {
        owner: holderId,
        lease_until_ms: leaseUntil,
        heartbeat_ms: now,
        heartbeat_at: new Date(now).toISOString(),
      }, { merge: true });
      return;
    }
    holder = owner || null;
  });
  return { acquired, holder, leaseUntil, holderId };
}

// 2026-04-19 ROOT-CAUSE FIX: heartbeat used `db.runTransaction` on the
// same lease doc that `runWithPositionWriterLease` was also transacting
// against — the enclosing function ran a `setInterval` heartbeat loop
// concurrent with the initial synchronous heartbeat AND the eventual
// release. Two concurrent transactions on one doc exhaust the SDK's
// internal 5-attempt ABORTED retry budget under any network pressure,
// causing `10 ABORTED: cross-transaction contention` to leak to callers
// (including the BTCUSDT BE-raise path, which is how this was found).
//
// The transaction was unnecessary: heartbeat only needs to extend TTL
// if we still own the lease. Switching to read+conditional update
// removes the self-contention entirely. See companion note in
// `heartbeatBinanceNativeRefreshLease` in paperBinanceRunner.js.
async function heartbeatPositionWriterLease({
  exchange,
  symbol,
  ttlMs = POSITION_WRITER_LEASE_TTL_MS,
  holderId = positionWriterLeaseHolderId,
} = {}) {
  const db = getFirestore();
  const now = Date.now();
  const leaseUntil = now + Math.max(3000, Math.floor(Number(ttlMs) || POSITION_WRITER_LEASE_TTL_MS));
  const ref = db.doc(buildPositionWriterLeaseDocPath(exchange, symbol));
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, holder: null, leaseUntil, holderId };
  }
  const data = snap.data() || {};
  const owner = String(data.owner || "");
  if (owner !== String(holderId || "")) {
    return { ok: false, holder: owner || null, leaseUntil, holderId };
  }
  await ref.update({
    lease_until_ms: leaseUntil,
    heartbeat_ms: now,
    heartbeat_at: new Date(now).toISOString(),
  });
  return { ok: true, holder: null, leaseUntil, holderId };
}

async function releasePositionWriterLease({
  exchange,
  symbol,
  holderId = positionWriterLeaseHolderId,
} = {}) {
  const db = getFirestore();
  const ref = db.doc(buildPositionWriterLeaseDocPath(exchange, symbol));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() || {};
    if (String(data.owner || "") !== String(holderId || "")) return;
    tx.set(ref, {
      lease_until_ms: Date.now() - 1,
      released_at: new Date().toISOString(),
    }, { merge: true });
  });
}

// 2026-04-18 P0-3: operator-facing inspect + force-release.
//
// `runWithPositionWriterLease` is robust when holders exit cleanly — the
// finally block always calls `releasePositionWriterLease`. But if a Cloud
// Run instance dies mid-mutation (OOM kill, SIGTERM with pending I/O,
// crash loop), the Firestore doc keeps `owner` set until `lease_until_ms`
// (TTL default 15s) elapses. That is the *design* — so new holders pick
// up once the lease expires. The operational gap is that we had no
// explicit admin surface to (a) see who holds the lease and (b) force a
// release in the emergency case where the TTL is misbehaving or an
// operator needs to intervene before 15s. Below fills that gap.

function summarizeLeaseDoc(data = {}, nowMs = Date.now()) {
  const owner = String(data.owner || "") || null;
  const leaseUntilMs = Number(data.lease_until_ms);
  const heartbeatMs = Number(data.heartbeat_ms);
  const releasedAt = String(data.released_at || "") || null;
  const leaseUntilValid = Number.isFinite(leaseUntilMs);
  const heartbeatValid = Number.isFinite(heartbeatMs);
  const expired = leaseUntilValid ? leaseUntilMs <= nowMs : true;
  const ageMs = leaseUntilValid ? (nowMs - leaseUntilMs) : null;
  const heartbeatAgeMs = heartbeatValid ? (nowMs - heartbeatMs) : null;
  return {
    owner,
    lease_until_ms: leaseUntilValid ? leaseUntilMs : null,
    heartbeat_ms: heartbeatValid ? heartbeatMs : null,
    released_at: releasedAt,
    expired,
    // Positive when lease has ALREADY expired. Negative means still
    // holding. Use this to decide "is this stale enough to reclaim?"
    expired_age_ms: ageMs,
    heartbeat_age_ms: heartbeatAgeMs,
  };
}

async function inspectPositionWriterLease({ exchange, symbol, db: dbOverride = null } = {}) {
  const db = dbOverride || getFirestore();
  const ref = db.doc(buildPositionWriterLeaseDocPath(exchange, symbol));
  const snap = await ref.get();
  const nowMs = Date.now();
  if (!snap.exists) {
    return {
      exchange: upper(exchange),
      symbol: upper(symbol),
      exists: false,
      owner: null,
      expired: true,
      expired_age_ms: null,
      heartbeat_age_ms: null,
      lease_until_ms: null,
      heartbeat_ms: null,
      released_at: null,
      now_ms: nowMs,
    };
  }
  const summary = summarizeLeaseDoc(snap.data() || {}, nowMs);
  return {
    exchange: upper(exchange),
    symbol: upper(symbol),
    exists: true,
    now_ms: nowMs,
    ...summary,
  };
}

// Force-releases a position-writer lease iff it is stale, OR if
// `force: true` is passed by an explicit operator call.
//
// Return contract:
//   { ok: true, released: true,  reason: "STALE_RELEASED"        , lease: ... }
//   { ok: true, released: true,  reason: "FORCE_RELEASED"        , lease: ... }
//   { ok: true, released: false, reason: "NO_LEASE_DOC"          , lease: ... }
//   { ok: true, released: false, reason: "LEASE_NOT_STALE"       , lease: ... }
//
// `minStaleMs` is an extra guard rail — by default we require the lease
// to be stale for at least 1×TTL beyond its expiry before reclaiming,
// because the heartbeat loop could be momentarily slow. Setting
// `force: true` bypasses this.
async function forceReleaseStalePositionWriterLease({
  exchange,
  symbol,
  minStaleMs = POSITION_WRITER_LEASE_TTL_MS,
  force = false,
  actor = null,
  db: dbOverride = null,
} = {}) {
  const db = dbOverride || getFirestore();
  const ref = db.doc(buildPositionWriterLeaseDocPath(exchange, symbol));
  const releasedAtIso = new Date().toISOString();
  let outcome = { ok: true, released: false, reason: "NO_LEASE_DOC", lease: null };
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      outcome = {
        ok: true,
        released: false,
        reason: "NO_LEASE_DOC",
        lease: {
          exchange: upper(exchange),
          symbol: upper(symbol),
          exists: false,
          owner: null,
          expired: true,
          expired_age_ms: null,
          heartbeat_age_ms: null,
          lease_until_ms: null,
          heartbeat_ms: null,
          released_at: null,
        },
      };
      return;
    }
    const nowMs = Date.now();
    const summary = summarizeLeaseDoc(snap.data() || {}, nowMs);
    const staleEnough = summary.expired === true
      && Number.isFinite(summary.expired_age_ms)
      && summary.expired_age_ms >= Math.max(0, Math.floor(Number(minStaleMs) || 0));
    if (!staleEnough && force !== true) {
      outcome = {
        ok: true,
        released: false,
        reason: "LEASE_NOT_STALE",
        lease: { exchange: upper(exchange), symbol: upper(symbol), exists: true, ...summary },
      };
      return;
    }
    tx.set(ref, {
      lease_until_ms: nowMs - 1,
      released_at: releasedAtIso,
      // Audit fields — deliberately NOT merged into the snap view above
      // so operators querying inspectPositionWriterLease next tick see
      // the trail.
      force_released_by: actor ? String(actor).slice(0, 120) : null,
      force_released_reason: force === true ? "FORCE_RELEASED" : "STALE_RELEASED",
    }, { merge: true });
    outcome = {
      ok: true,
      released: true,
      reason: force === true ? "FORCE_RELEASED" : "STALE_RELEASED",
      lease: { exchange: upper(exchange), symbol: upper(symbol), exists: true, ...summary },
    };
  });
  return outcome;
}

async function runWithPositionWriterLease({
  exchange,
  symbol,
  runner,
  leaseEnabled = POSITION_WRITER_LEASE_ENABLED,
  ttlMs = POSITION_WRITER_LEASE_TTL_MS,
  waitMs = POSITION_WRITER_LEASE_WAIT_MS,
  acquireLease = acquirePositionWriterLease,
  heartbeatLease = heartbeatPositionWriterLease,
  releaseLease = releasePositionWriterLease,
} = {}) {
  if (typeof runner !== "function") throw new Error("runWithPositionWriterLease: runner required");
  if (leaseEnabled !== true) return runner();
  const leaseKey = positionWriterLeaseKey(exchange, symbol);
  const activeDepth = Number(positionWriterLeaseDepth.get(leaseKey) || 0);
  if (activeDepth > 0) {
    positionWriterLeaseDepth.set(leaseKey, activeDepth + 1);
    try {
      return await runner();
    } finally {
      const nextDepth = Number(positionWriterLeaseDepth.get(leaseKey) || 1) - 1;
      if (nextDepth > 0) positionWriterLeaseDepth.set(leaseKey, nextDepth);
      else positionWriterLeaseDepth.delete(leaseKey);
    }
  }

  const deadline = Date.now() + Math.max(0, Math.floor(Number(waitMs) || 0));
  let lease = null;
  for (;;) {
    lease = await acquireLease({ exchange, symbol, ttlMs });
    if (lease && lease.acquired === true) break;
    if (Date.now() >= deadline) {
      const err = new Error(`POSITION_WRITE_LEASE_HELD ${upper(exchange) || "UNKNOWN"} ${upper(symbol) || "UNKNOWN"} holder=${lease && lease.holder ? lease.holder : "UNKNOWN"}`);
      err.code = "POSITION_WRITE_LEASE_HELD";
      err.exchange = upper(exchange);
      err.symbol = upper(symbol);
      err.holder = lease && lease.holder ? lease.holder : null;
      throw err;
    }
    await sleep(200);
  }

  let heartbeatLost = false;
  const heartbeatEveryMs = Math.max(1000, Math.floor(Math.max(3000, ttlMs) / 3));
  const timer = setInterval(() => {
    heartbeatLease({ exchange, symbol, ttlMs, holderId: lease.holderId })
      .then((res) => {
        if (!res || res.ok !== true) heartbeatLost = true;
      })
      .catch(() => {
        heartbeatLost = true;
      });
  }, heartbeatEveryMs);

  try {
    positionWriterLeaseDepth.set(leaseKey, 1);
    const heartbeat = await heartbeatLease({ exchange, symbol, ttlMs, holderId: lease.holderId });
    if (!heartbeat || heartbeat.ok !== true) {
      const err = new Error(`POSITION_WRITE_LEASE_LOST ${upper(exchange) || "UNKNOWN"} ${upper(symbol) || "UNKNOWN"} holder=${heartbeat && heartbeat.holder ? heartbeat.holder : "UNKNOWN"}`);
      err.code = "POSITION_WRITE_LEASE_LOST";
      err.exchange = upper(exchange);
      err.symbol = upper(symbol);
      err.holder = heartbeat && heartbeat.holder ? heartbeat.holder : null;
      throw err;
    }
    const result = await runner();
    if (heartbeatLost && result && typeof result === "object") {
      return { ...result, position_writer_lease_lost_after_run: true };
    }
    return result;
  } finally {
    positionWriterLeaseDepth.delete(leaseKey);
    clearInterval(timer);
    await releaseLease({ exchange, symbol, holderId: lease && lease.holderId }).catch(() => {});
  }
}

function assertExpectedWriteToken(previous = {}, expectedWriteToken = null) {
  const expected = String(expectedWriteToken || "").trim() || null;
  if (!expected) return;
  const current = String(previous.position_write_token || "").trim() || null;
  if (current !== expected) {
    const err = new Error(`POSITION_WRITE_TOKEN_MISMATCH expected=${expected} actual=${current || "NULL"}`);
    err.code = "POSITION_WRITE_TOKEN_MISMATCH";
    err.expected_write_token = expected;
    err.actual_write_token = current;
    throw err;
  }
}

function assertExpectedWriteTokenProvided(provided = false) {
  if (!POSITION_WRITE_TOKEN_REQUIRED) return;
  if (provided === true) return;
  const err = new Error("POSITION_WRITE_TOKEN_REQUIRED");
  err.code = "POSITION_WRITE_TOKEN_REQUIRED";
  throw err;
}

function shouldSendPositionWriterAlert({
  exchange,
  symbol,
  mutationKind,
  code,
  nowMs = Date.now(),
  cooldownMs = POSITION_WRITER_ALERT_COOLDOWN_MS,
} = {}) {
  const key = [
    upper(exchange) || "UNKNOWN",
    upper(symbol) || "UNKNOWN",
    upper(mutationKind) || "POSITION_UPSERT",
    upper(code) || "UNKNOWN",
  ].join("::");
  const lastAt = Number(positionWriterAlertState.get(key) || 0);
  if (Number.isFinite(lastAt) && lastAt > 0 && (nowMs - lastAt) < Math.max(0, Number(cooldownMs) || 0)) {
    return false;
  }
  positionWriterAlertState.set(key, nowMs);
  return true;
}

// 2026-04-27 P0-C: invariant alert ratelimit. authority-failure 와 분리된
// state map 을 쓰는 이유는 두 알림 클래스의 cooldown 이 다르고, 같은
// (exchange, symbol) 에서 두 클래스가 모두 trigger 됐을 때 한 쪽이 다른
// 쪽을 가리지 않기 위함. key 에 reason 을 포함해 "같은 symbol/같은 위반
// 사유" 만 dedupe — 다른 reason 이면 별도 카운트.
function shouldSendPositionInvariantAlert({
  exchange,
  symbol,
  invariantScope,
  reason,
  nowMs = Date.now(),
  cooldownMs = POSITION_INVARIANT_ALERT_COOLDOWN_MS,
} = {}) {
  const key = [
    upper(exchange) || "UNKNOWN",
    upper(symbol) || "UNKNOWN",
    upper(invariantScope) || "FULL_SNAPSHOT",
    upper(reason) || "UNKNOWN",
  ].join("::");
  const lastAt = Number(positionInvariantAlertState.get(key) || 0);
  if (Number.isFinite(lastAt) && lastAt > 0 && (nowMs - lastAt) < Math.max(0, Number(cooldownMs) || 0)) {
    return false;
  }
  positionInvariantAlertState.set(key, nowMs);
  return true;
}

// fire-and-forget. observer 자체는 sync 라 await 하지 않고 호출. 알림이
// 실패해도 write 흐름에 영향 X — invariant 의 본 layer 는 어디까지나
// structuredLog warn 이고, 이 알림은 그 위의 *push notification*.
async function notifyActivePositionInvariantViolation({
  exchange,
  symbol,
  mutationKind,
  invariantScope,
  source,
  reason,
  requestId,
  traceId,
  runId,
  state,
  positionState,
  positionSide,
  sizePct,
  qtyBase,
  violations,
} = {}) {
  if (POSITION_INVARIANT_ALERT_ENABLED !== true) return false;
  if (!POSITION_INVARIANT_ALERT_CHANNEL) return false;
  const topReason = (Array.isArray(violations) && violations[0] && violations[0].reason) || "UNKNOWN_VIOLATION";
  if (!shouldSendPositionInvariantAlert({
    exchange,
    symbol,
    invariantScope,
    reason: topReason,
  })) return false;
  const violationLine = (Array.isArray(violations) ? violations : [])
    .slice(0, 6) // Slack body 폭 제한 — 한 알림 안에 다 넣지 말고 cap.
    .map((v) => `  • ${v.field}: ${v.reason}`)
    .join("\n");
  const body = [
    `exchange=${upper(exchange) || "UNKNOWN"}`,
    `symbol=${upper(symbol) || "UNKNOWN"}`,
    `invariant_scope=${upper(invariantScope) || "FULL_SNAPSHOT"}`,
    `mutation=${upper(mutationKind) || "POSITION_UPSERT"}`,
    `source=${upper(source) || "UNKNOWN"}`,
    `state=${upper(state) || "?"}`,
    `position_state=${upper(positionState) || "?"}`,
    `position_side=${upper(positionSide) || "?"}`,
    `size_pct=${Number.isFinite(Number(sizePct)) ? Number(sizePct) : "?"}`,
    `qty_base=${Number.isFinite(Number(qtyBase)) ? Number(qtyBase) : "?"}`,
    `request_id=${String(requestId || "").trim() || "NONE"}`,
    `run_id=${String(runId || "").trim() || "NONE"}`,
    `trace_id=${String(traceId || "").trim() || "NONE"}`,
    `reason=${String(reason || "").trim() || "NONE"}`,
    `violations:`,
    violationLine || "  (none)",
  ].join("\n");
  try {
    await sendAlert({
      channel: POSITION_INVARIANT_ALERT_CHANNEL,
      title: "positions_paper invariant violation",
      body,
      severity: "WARN",
    });
    return true;
  } catch (alertErr) {
    const msg = alertErr && alertErr.message ? alertErr.message : String(alertErr);
    console.warn("[POSITION_INVARIANT_ALERT_FAIL]", msg);
    return false;
  }
}

function shouldSuppressPositionWriterAuthorityAlert(err, {
  source = null,
} = {}) {
  const code = upper(err && err.code) || upper(err && err.message) || null;
  const holder = String(err && err.holder || "").trim().toLowerCase();
  const src = upper(source);
  if (code !== "POSITION_WRITE_LEASE_HELD") return false;
  if (src !== "BINANCE_FUTURES_POSITION_SYNC") return false;
  if (!holder.includes("donbeolja-exit-worker")) return false;
  return true;
}

async function notifyPositionWriterAuthorityFailure(err, {
  exchange,
  symbol,
  mutationKind,
  source = null,
  requestId = null,
  runId = null,
  traceId = null,
  suppressAlert = false,
  suppressRuntimeFamily = false,
  suppressRuntimeFamilyReason = null,
} = {}) {
  const code = upper(err && err.code) || upper(err && err.message) || "UNKNOWN";
  if (!["POSITION_WRITE_TOKEN_REQUIRED", "POSITION_WRITE_TOKEN_MISMATCH", "POSITION_WRITE_LEASE_HELD", "POSITION_WRITE_LEASE_LOST"].includes(code)) {
    return false;
  }
  try {
    await recordPositionWriterAuthorityEvent({
      exchange,
      symbol,
      mutationKind,
      source,
      code,
      requestId,
      runId,
      traceId,
      error: String((err && err.message) || err || "").trim() || "UNKNOWN",
      expectedWriteToken: err && err.expected_write_token ? err.expected_write_token : null,
      actualWriteToken: err && err.actual_write_token ? err.actual_write_token : null,
      holder: err && err.holder ? err.holder : null,
      runtimeFamilySuppressed: suppressRuntimeFamily === true,
      runtimeFamilySuppressedReason: suppressRuntimeFamilyReason || null,
    });
  } catch (recordErr) {
    const msg = recordErr && recordErr.message ? recordErr.message : String(recordErr);
    console.warn("[POSITION_WRITER_AUTHORITY_EVENT_FAIL]", msg);
  }
  if (suppressAlert === true) return false;
  if (shouldSuppressPositionWriterAuthorityAlert(err, { source })) return false;
  if (POSITION_WRITER_ALERT_ENABLED !== true) return false;
  if (!POSITION_WRITER_ALERT_CHANNEL) return false;
  if (!shouldSendPositionWriterAlert({ exchange, symbol, mutationKind, code })) return false;
  const body = [
    `exchange=${upper(exchange) || "UNKNOWN"}`,
    `symbol=${upper(symbol) || "UNKNOWN"}`,
    `mutation=${upper(mutationKind) || "POSITION_UPSERT"}`,
    `source=${upper(source) || "UNKNOWN"}`,
    `code=${code}`,
    `request_id=${String(requestId || "").trim() || "NONE"}`,
    `run_id=${String(runId || "").trim() || "NONE"}`,
    `trace_id=${String(traceId || "").trim() || "NONE"}`,
    `error=${String((err && err.message) || err || "").trim() || "UNKNOWN"}`,
  ].join("\n");
  try {
    await sendAlert({
      channel: POSITION_WRITER_ALERT_CHANNEL,
      title: "positions_paper writer authority failure",
      body,
      severity: "WARN",
    });
    return true;
  } catch (alertErr) {
    const msg = alertErr && alertErr.message ? alertErr.message : String(alertErr);
    console.warn("[POSITION_WRITER_ALERT_FAIL]", msg);
    return false;
  }
}

async function commitPositionMutationTransaction({
  tx,
  ref,
  trace,
  exchange,
  symbol,
  reason = null,
  previous = null,
  payload = null,
  transitionValidation = null,
  extra = null,
} = {}) {
  if (!POSITION_EVENT_LOG_ENABLED) {
    tx.set(ref, payload, { merge: true });
    return { bundle: null, afterSnapshot: { ...(previous || {}), ...(payload || {}), meta: payload && payload.meta ? payload.meta : ((previous && previous.meta) || {}) } };
  }
  const afterSnapshot = {
    ...(previous && typeof previous === "object" ? previous : {}),
    ...(payload && typeof payload === "object" ? payload : {}),
    meta: payload && Object.prototype.hasOwnProperty.call(payload, "meta")
      ? payload.meta
      : ((previous && previous.meta) || {}),
  };
  const bundle = positionEventTest.buildPositionEventBundle({
    exchange,
    symbol,
    mutationKind: trace && trace.mutation_kind,
    requestId: trace && trace.request_id,
    runId: trace && trace.run_id,
    traceId: trace && trace.trace_id,
    source: trace && trace.source,
    reason,
    before: cloneValue(previous),
    after: cloneValue(afterSnapshot),
    transition: transitionValidation,
    extra,
  });
  const latestRef = ref.firestore.collection("position_read_model_latest").doc(bundle.latestReadModelDoc.read_model_id);
  const latestSnap = await tx.get(latestRef);
  const latestPrev = latestSnap.exists ? (latestSnap.data() || null) : null;
  tx.set(ref, payload, { merge: true });
  tx.set(ref.firestore.collection("position_events").doc(bundle.eventId), bundle.eventDoc, { merge: false });
  tx.set(ref.firestore.collection("unified_event_timeline").doc(bundle.unifiedEventDoc.unified_event_id), bundle.unifiedEventDoc, { merge: false });
  if (latestReadModelTest.shouldReplaceLatestPositionReadModel(latestPrev, bundle.latestReadModelDoc)) {
    tx.set(latestRef, bundle.latestReadModelDoc, { merge: false });
  }
  return {
    bundle,
    afterSnapshot,
  };
}

function matchesTpP1PendingSnapshot(meta = {}, {
  pendingAtMs = null,
  pendingUntilMs = null,
  pendingEvent = null,
} = {}) {
  const state = (meta && typeof meta === "object") ? meta : {};
  if (state.tp_p1_pending !== true) return false;
  const currentAtMs = Number(state.tp_p1_pending_at_ms);
  const currentUntilMs = Number(state.tp_p1_pending_until_ms);
  const currentEvent = String(state.tp_p1_pending_event || "").trim().toUpperCase() || null;
  if (Number.isFinite(Number(pendingAtMs)) && currentAtMs !== Number(pendingAtMs)) return false;
  if (Number.isFinite(Number(pendingUntilMs)) && currentUntilMs !== Number(pendingUntilMs)) return false;
  if (pendingEvent != null && currentEvent !== (String(pendingEvent || "").trim().toUpperCase() || null)) return false;
  return true;
}

function buildTpP1PendingClearedMeta(meta = {}, {
  clearedAt,
  clearedReason = "PENDING_EXPIRED_NO_ACTIVE_INTENT",
} = {}) {
  const state = (meta && typeof meta === "object") ? meta : {};
  return {
    ...state,
    tp_p1_pending: false,
    tp_p1_pending_at_ms: null,
    tp_p1_pending_until_ms: null,
    tp_p1_pending_event: null,
    tp_p1_pending_cleared_at: clearedAt || nowIso(),
    tp_p1_pending_cleared_reason: clearedReason,
  };
}

async function clearTpP1PendingIfUnchanged({
  exchange,
  symbol,
  pendingAtMs = null,
  pendingUntilMs = null,
  pendingEvent = null,
  clearedReason = "PENDING_EXPIRED_NO_ACTIVE_INTENT",
  clearedAt = null,
} = {}) {
  const current = await getPosition({ exchange, symbol });
  if (!current || !current.pos_id) {
    return { ok: true, cleared: false, reason: "POSITION_NOT_FOUND", pos_id: posId({ exchange, symbol }) };
  }
  const meta = (current && typeof current.meta === "object") ? current.meta : {};
  if (!matchesTpP1PendingSnapshot(meta, { pendingAtMs, pendingUntilMs, pendingEvent })) {
    return { ok: true, cleared: false, reason: "PENDING_STATE_MISMATCH", pos_id: current.pos_id || posId({ exchange, symbol }) };
  }
  const nextMeta = buildTpP1PendingClearedMeta(meta, {
    clearedAt: clearedAt || nowIso(),
    clearedReason,
  });
  try {
    await upsertPositionMetaOnly({
      exchange,
      symbol,
      runId: current.run_id || null,
      executionMode: current.execution_mode || null,
      meta: nextMeta,
      source: "TP_P1_PENDING_CLEAR",
      mutationKind: "POSITION_META_CLEAR_TP_P1_PENDING",
      reason: clearedReason,
      expectedWriteToken: Object.prototype.hasOwnProperty.call(current || {}, "position_write_token")
        ? (current.position_write_token ?? null)
        : null,
    });
    return { ok: true, cleared: true, reason: "CLEARED", pos_id: current.pos_id || posId({ exchange, symbol }) };
  } catch (err) {
    const code = upper(err && err.code) || null;
    if (["POSITION_WRITE_TOKEN_MISMATCH", "POSITION_WRITE_LEASE_HELD", "POSITION_WRITE_LEASE_LOST"].includes(code)) {
      return { ok: true, cleared: false, reason: code, pos_id: current.pos_id || posId({ exchange, symbol }) };
    }
    throw err;
  }
}

async function getPosition({ exchange, symbol } = {}) {
  const db = getFirestore();
  const id = posId({ exchange, symbol });
  const ref = db.collection("positions_paper").doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    return buildFlatPositionSnapshot({ exchange, symbol, id });
  }
  return snap.data();
}

async function upsertPosition({
  exchange,
  symbol,
  state,
  sizePct,
  avgPrice,
  runId,
  budgetMaxKrw,
  budgetUsedKrw,
    budgetSource,
  positionSide,
  meta = {},
  qtyBase = null,
  executionMode = null,
  requestId = null,
  traceId = null,
  source = null,
  mutationKind = "POSITION_UPSERT",
  reason = null,
  expectedWriteToken = null,
  suppressAuthorityAlert = false,
  suppressAuthorityRuntimeFamily = false,
  suppressAuthorityRuntimeFamilyReason = null,
} = {}) {
  const expectedWriteTokenProvided = Object.prototype.hasOwnProperty.call(arguments[0] || {}, "expectedWriteToken");
  // PR #10: meta 가격 필드 schema 관찰 (warn-only, throw X).  트랜잭션
  // 밖에서 한 번만 발화 — 커밋 성공 여부와 무관하게 "writer 가 시도한
  // intent" 를 관찰하기 위함. 트랜잭션 retry 루프 안에 넣으면 같은
  // 논리적 intent 가 중복 warn 으로 튀어나와 카운트가 왜곡된다.
  observeMetaPriceSchema({
    meta,
    mutationKind,
    writerScope: "CORE",
    exchange,
    symbol,
    source,
    reason,
    requestId,
    traceId,
    runId,
  });
  observeActivePositionInvariants({
    scope: "FULL_SNAPSHOT",
    meta,
    state,
    positionState: derivePositionState(sizePct, meta),
    positionSide,
    sizePct,
    qtyBase,
    mutationKind,
    writerScope: "CORE",
    exchange,
    symbol,
    source,
    reason,
    requestId,
    traceId,
    runId,
  });
  return serializePositionMutation({
    exchange,
    symbol,
    runner: async () => {
      const db = getFirestore();
      const id = posId({ exchange, symbol });
        const ref = db.collection("positions_paper").doc(id);
      const trace = normalizeTraceContext({
        traceId,
        requestId,
        runId,
        exchange,
        symbol,
        mutationKind,
        source,
      });
      try {
        assertExpectedWriteTokenProvided(expectedWriteTokenProvided);
        const committed = await runWithPositionWriterLease({
          exchange,
          symbol,
          runner: () => db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const previous = snap.exists ? (snap.data() || {}) : buildFlatPositionSnapshot({ exchange, symbol, id });
            assertExpectedWriteToken(previous, expectedWriteToken);
            const positionState = derivePositionState(sizePct, meta);
            // 2026-04-27 Stage 3a — stamp position_cycle_id at the write
            // boundary. Derivation runs on (previous, incoming meta, sizePct)
            // so cycle continuity / RE_OPEN / FLAT-clear are decided in one
            // place. See `derivePositionCycleId` for rule precedence.
            const stampedCycleId = derivePositionCycleId({
              prev: previous,
              incomingMeta: meta,
              sizePct,
            });
            const stampedMeta = {
              ...(meta || {}),
              position_cycle_id: stampedCycleId,
            };
            // Stage 3b-1: post-stamp cycle_id presence observer (warn-only).
            // CORE 경로는 derivePositionCycleId 가 ACTIVE 인 한 항상 값을
            // 채우므로 위반이 나면 전혀 다른 회귀 신호 (e.g. derive 함수
            // 가 false-negative 를 낸 케이스).
            observePositionCycleIdPresence({
              scope: "FULL_SNAPSHOT_POST_STAMP",
              meta: stampedMeta,
              state,
              positionState,
              positionSide,
              sizePct,
              qtyBase,
              mutationKind,
              writerScope: "CORE",
              exchange,
              symbol,
              source,
              reason,
              requestId,
              traceId,
              runId,
            });
            const transitionValidation = validatePositionSnapshotTransition({
              prev: previous,
              next: {
                ...previous,
                state: state || "FLAT",
                position_state: positionState,
                position_side: positionSide || null,
                size_pct: Number(sizePct),
                avg_price: avgPrice === null || avgPrice === undefined ? null : Number(avgPrice),
                qty_base: (qtyBase === null || qtyBase === undefined) ? null : Number(qtyBase),
                meta: stampedMeta,
              },
            });
            const transitionIssues = formatTransitionIssues(transitionValidation.issues);
            if (POSITION_STATE_MACHINE_STRICT && transitionValidation.ok !== true) {
              throw buildTransitionError({
                exchange,
                symbol,
                mutationKind,
                validation: transitionValidation,
              });
            }
            const versions = resolveNextWriterVersion(previous, "CORE");
            const nextWriteToken = buildNextPositionWriteToken();
            const payload = {
              pos_id: id,
              exchange,
              symbol_or_pair_id: symbol,
              state: state || "FLAT",
              position_state: positionState,
              position_side: positionSide || null,
              size_pct: Number(sizePct),
              avg_price: avgPrice === null || avgPrice === undefined ? null : Number(avgPrice),
              qty_base: (qtyBase === null || qtyBase === undefined) ? null : Number(qtyBase),
              run_id: runId || null,
              execution_mode: executionMode || null,
              budget_max_krw: (budgetMaxKrw === null || budgetMaxKrw === undefined) ? null : Number(budgetMaxKrw),
              budget_used_krw: (budgetUsedKrw === null || budgetUsedKrw === undefined) ? null : Number(budgetUsedKrw),
              budget_source: budgetSource || null,
              meta: stampedMeta,
              trace_id: trace.trace_id,
              request_id: trace.request_id,
              last_mutation_kind: trace.mutation_kind,
              last_mutation_source: trace.source,
              last_mutation_reason: upper(reason),
              position_transition_ok: transitionValidation.ok === true,
              position_transition_issues: transitionIssues,
              previous_position_write_token: String(previous.position_write_token || "").trim() || null,
              position_write_token: nextWriteToken,
              writer_scope: "CORE",
              writer_authority_mode: POSITION_WRITER_LEASE_ENABLED ? "LEASED_TRANSACTIONAL" : "TRANSACTIONAL",
              writer_committed_at: nowIso(),
              ...versions,
              updated_at: nowIso(),
            };
            const committed = await commitPositionMutationTransaction({
              tx,
              ref,
              trace,
              exchange,
              symbol,
              reason,
              previous,
              payload,
              transitionValidation,
              extra: {
                execution_mode: executionMode || null,
                budget_source: budgetSource || null,
                writer_version: payload.writer_version,
                core_writer_version: payload.core_writer_version,
                previous_position_write_token: payload.previous_position_write_token || null,
                position_write_token: payload.position_write_token || null,
              },
            });
            return {
              previous,
              payload,
              transitionValidation,
              bundle: committed.bundle,
            };
          }),
        });
        return committed.payload;
      } catch (err) {
        await notifyPositionWriterAuthorityFailure(err, {
          exchange,
          symbol,
          mutationKind: trace.mutation_kind,
          source: trace.source,
          requestId: trace.request_id,
          runId: trace.run_id,
          traceId: trace.trace_id,
          suppressAlert: suppressAuthorityAlert === true,
          suppressRuntimeFamily: suppressAuthorityRuntimeFamily === true,
          suppressRuntimeFamilyReason: suppressAuthorityRuntimeFamilyReason || null,
        });
        throw err;
      }
    },
  });
}

async function upsertPositionMetaOnly({
  exchange,
  symbol,
  runId,
  executionMode,
  meta = {},
  requestId = null,
  traceId = null,
  source = null,
  mutationKind = "POSITION_META_UPSERT",
  reason = null,
  expectedWriteToken = null,
  suppressAuthorityAlert = false,
  suppressAuthorityRuntimeFamily = false,
  suppressAuthorityRuntimeFamilyReason = null,
} = {}) {
  const expectedWriteTokenProvided = Object.prototype.hasOwnProperty.call(arguments[0] || {}, "expectedWriteToken");
  // PR #10: meta-only 경로는 trail_low / native_protection_stop_price
  // 등 가격 필드 업데이트가 가장 자주 들어오는 path.  bug class 검출
  // 밀도가 여기서 가장 높을 것으로 기대됨.  scope = "META".
  observeMetaPriceSchema({
    meta,
    mutationKind,
    writerScope: "META",
    exchange,
    symbol,
    source,
    reason,
    requestId,
    traceId,
    runId,
  });
  observeActivePositionInvariants({
    scope: "META_PATCH",
    meta,
    mutationKind,
    writerScope: "META",
    exchange,
    symbol,
    source,
    reason,
    requestId,
    traceId,
    runId,
  });
  return serializePositionMutation({
    exchange,
    symbol,
    runner: async () => {
      const db = getFirestore();
      const id = posId({ exchange, symbol });
      const ref = db.collection("positions_paper").doc(id);
      const trace = normalizeTraceContext({
        traceId,
        requestId,
        runId,
        exchange,
        symbol,
        mutationKind,
        source,
      });
      try {
        assertExpectedWriteTokenProvided(expectedWriteTokenProvided);
        const committed = await runWithPositionWriterLease({
          exchange,
          symbol,
          runner: () => db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const previous = snap.exists ? (snap.data() || {}) : buildFlatPositionSnapshot({ exchange, symbol, id });
            assertExpectedWriteToken(previous, expectedWriteToken);
            // 2026-04-27 Stage 3a — META-only writes preserve the previous
            // cycle_id (or accept an explicit override). They never *create*
            // a cycle — that's CORE's responsibility. Without this, a
            // meta-patch would silently strip cycle_id because the meta map
            // is replaced wholesale (see commitPositionMutationTransaction).
            const carriedCycleId = deriveMetaOnlyPositionCycleId({
              prev: previous,
              incomingMeta: meta,
            });
            const stampedMeta = { ...(meta || {}) };
            if (carriedCycleId) stampedMeta.position_cycle_id = carriedCycleId;
            const nextSnapshot = {
              ...previous,
              pos_id: id,
              exchange,
              symbol_or_pair_id: symbol,
              run_id: runId || null,
              execution_mode: executionMode || null,
              meta: stampedMeta,
            };
            // Stage 3b-1: META-only 경로의 post-carry cycle_id presence
            // observer.  prev 가 라이브에서 cycle_id 없는 ACTIVE 인 채로
            // 떠 있으면 deriveMetaOnlyPositionCycleId 가 null 을 반환하므로
            // 여기서 warn 이 발화된다.  Stage 3b-2 backfill 의 진행 정도를
            // Cloud Logging 에서 직접 추적 가능 (event=position_cycle_id_missing).
            observePositionCycleIdPresence({
              scope: "META_PATCH_POST_CARRY",
              meta: stampedMeta,
              state: previous && previous.state,
              positionState: previous && previous.position_state,
              positionSide: previous && previous.position_side,
              sizePct: previous && previous.size_pct,
              qtyBase: previous && previous.qty_base,
              mutationKind,
              writerScope: "META",
              exchange,
              symbol,
              source,
              reason,
              requestId,
              traceId,
              runId,
            });
            const transitionValidation = validatePositionSnapshotTransition({
              prev: previous,
              next: nextSnapshot,
            });
            const transitionIssues = formatTransitionIssues(transitionValidation.issues);
            if (POSITION_STATE_MACHINE_STRICT && transitionValidation.ok !== true) {
              throw buildTransitionError({
                exchange,
                symbol,
                mutationKind,
                validation: transitionValidation,
              });
            }
            const versions = resolveNextWriterVersion(previous, "META");
            const nextWriteToken = buildNextPositionWriteToken();
            const payload = {
              pos_id: id,
              exchange,
              symbol_or_pair_id: symbol,
              run_id: runId || null,
              execution_mode: executionMode || null,
              meta: stampedMeta,
              trace_id: trace.trace_id,
              request_id: trace.request_id,
              last_mutation_kind: trace.mutation_kind,
              last_mutation_source: trace.source,
              last_mutation_reason: upper(reason),
              position_transition_ok: transitionValidation.ok === true,
              position_transition_issues: transitionIssues,
              previous_position_write_token: String(previous.position_write_token || "").trim() || null,
              position_write_token: nextWriteToken,
              writer_scope: "META",
              writer_authority_mode: POSITION_WRITER_LEASE_ENABLED ? "LEASED_TRANSACTIONAL" : "TRANSACTIONAL",
              writer_committed_at: nowIso(),
              ...versions,
              updated_at: nowIso(),
            };
            const committed = await commitPositionMutationTransaction({
              tx,
              ref,
              trace,
              exchange,
              symbol,
              reason,
              previous,
              payload,
              transitionValidation,
              extra: {
                execution_mode: executionMode || null,
                writer_version: payload.writer_version,
                meta_writer_version: payload.meta_writer_version,
                previous_position_write_token: payload.previous_position_write_token || null,
                position_write_token: payload.position_write_token || null,
              },
            });
            return {
              previous,
              payload,
              transitionValidation,
              bundle: committed.bundle,
            };
          }),
        });
        return committed.payload;
      } catch (err) {
        await notifyPositionWriterAuthorityFailure(err, {
          exchange,
          symbol,
          mutationKind: trace.mutation_kind,
          source: trace.source,
          requestId: trace.request_id,
          runId: trace.run_id,
          traceId: trace.trace_id,
          suppressAlert: suppressAuthorityAlert === true,
          suppressRuntimeFamily: suppressAuthorityRuntimeFamily === true,
          suppressRuntimeFamilyReason: suppressAuthorityRuntimeFamilyReason || null,
        });
        throw err;
      }
    },
  });
}

module.exports = {
  getPosition,
  upsertPosition,
  upsertPositionMetaOnly,
  clearTpP1PendingIfUnchanged,
  runWithPositionWriterLease,
  inspectPositionWriterLease,
  forceReleaseStalePositionWriterLease,
  __test: {
    posId,
    derivePositionState,
    matchesTpP1PendingSnapshot,
    buildTpP1PendingClearedMeta,
    buildFlatPositionSnapshot,
    formatTransitionIssues,
    resolveNextWriterVersion,
    buildNextPositionWriteToken,
    buildPositionWriterLeaseDocPath,
    assertExpectedWriteToken,
    assertExpectedWriteTokenProvided,
    shouldSendPositionWriterAlert,
    shouldSuppressPositionWriterAuthorityAlert,
    notifyPositionWriterAuthorityFailure,
    serializePositionMutation,
    runWithPositionWriterLease,
    summarizeLeaseDoc,
    inspectPositionWriterLease,
    forceReleaseStalePositionWriterLease,
    heartbeatPositionWriterLease,
    observeMetaPriceSchema,
    observeActivePositionInvariants,
    observePositionCycleIdPresence,
    shouldSendPositionInvariantAlert,
    notifyActivePositionInvariantViolation,
    positionInvariantAlertState,
    structuredLog,
    generatePositionCycleId,
    derivePositionCycleId,
    deriveMetaOnlyPositionCycleId,
  },
};
