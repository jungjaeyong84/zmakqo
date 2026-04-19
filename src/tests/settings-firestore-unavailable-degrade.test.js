// ─────────────────────────────────────────────────────────────────────────────
// settings-firestore-unavailable-degrade.test.js
//
// 배경 (2026-04-19 ETHUSDT 사고):
//   Cloud Run → Firestore gRPC 커넥션이 `14 UNAVAILABLE: No connection
//   established. Client network socket disconnected before secure TLS ...`
//   로 순단하는 구간이 있었는데, 이 예외가 `getSettingsDocCached` 에서 그대로
//   throw → `resolveLiveFuturesConfig` → `refreshBinanceTickExitNativeProtection`
//   의 바깥 try/catch 로 버블업 → `tick_exit_native_protection_refresh_error`
//   로 오진 라벨링되어 1 시간 가까이 ETHUSDT native stop 이 MISSING 상태로
//   방치됐다.  로그만 보면 Binance 문제처럼 보이지만 실제 원인은 Firestore
//   transport 단절이었음.
//
// 이 테스트가 잠그는 계약:
//   (1) Firestore 실패 시, 과거에 성공적으로 읽었던 stale cache 가 있으면 그걸
//       반환해서 상위 콜러가 계속 작동하도록 degrade 한다.
//   (2) stale cache 가 없으면 호출자가 넘긴 fallback 을 쓴다.
//   (3) 둘 다 없을 때만 throw — 프로세스 최초 기동 시점 1 회 한정.
//   (4) 실패 후 BACKOFF 동안은 Firestore 를 재호출하지 않는다 (circuit breaker).
//       이 동안 각 호출이 Firestore 를 두드리면 blip 이 증폭된다.
//   (5) Firestore 가 복구되면 failedAtMs 마커를 지워서 다음 호출이 정상 경로로
//       돌아간다.
//   (6) `settings_doc_firestore_unavailable` 이벤트 로그가 나와서 Cloud Logging
//       에서 진짜 원인 (Firestore 쪽) 이 바로 식별된다.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require("assert");
const Module = require("module");
const path = require("path");

// `./firestore` 를 stub 으로 바꿔치우기 — settings.js 가 require 할 때 우리
// stub 이 잡히도록 require.cache 를 먼저 채운다.
const firestoreStubPath = require.resolve("../storage/firestore");
let stubBehavior = {
  // "ok" | "throw"
  mode: "ok",
  // mode === "ok" 일 때 반환할 doc data
  docData: { hello: "world" },
  // mode === "ok" 일 때 snap.exists
  exists: true,
  // mode === "throw" 일 때 던질 에러
  errorMessage: "14 UNAVAILABLE: No connection established. Client network socket disconnected before secure TLS connection was established.",
  // 호출 카운터
  getCallCount: 0,
};

function makeStubFirestore() {
  return {
    collection: (_col) => ({
      doc: (_key) => ({
        get: async () => {
          stubBehavior.getCallCount += 1;
          if (stubBehavior.mode === "throw") {
            const err = new Error(stubBehavior.errorMessage);
            err.code = 14;
            throw err;
          }
          return {
            exists: stubBehavior.exists,
            data: () => stubBehavior.docData,
          };
        },
      }),
    }),
  };
}

require.cache[firestoreStubPath] = {
  id: firestoreStubPath,
  filename: firestoreStubPath,
  loaded: true,
  exports: { getFirestore: makeStubFirestore },
};

// console.warn 을 가로채서 `settings_doc_firestore_unavailable` 이벤트 관측.
const capturedWarns = [];
const originalWarn = console.warn;
console.warn = (...args) => { capturedWarns.push(args); };

// 주의:  require 순서 — 반드시 stub 을 캐시에 꽂은 뒤에 settings.js 를 require.
const settings = require("../storage/settings");
const { __test } = settings;

function lastWarnEvent() {
  for (let i = capturedWarns.length - 1; i >= 0; i -= 1) {
    const raw = capturedWarns[i][0];
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.event === "settings_doc_firestore_unavailable") return parsed;
    } catch (_) { /* not json */ }
  }
  return null;
}

function resetEverything() {
  __test._resetCacheForTest();
  stubBehavior.getCallCount = 0;
  capturedWarns.length = 0;
  stubBehavior.mode = "ok";
}

(async () => {
  // 계약 (0): __test 훅들이 실제로 노출되어 있는지 확인 — 테스트 하네스가
  // 소리 없이 망가지는 걸 방지.
  assert.strictEqual(typeof __test.getSettingsDocCached, "function",
    "__test.getSettingsDocCached 노출 필수");
  assert.strictEqual(typeof __test._resetCacheForTest, "function",
    "__test._resetCacheForTest 노출 필수");
  assert.ok(Number.isFinite(__test.SETTINGS_FIRESTORE_FAILURE_BACKOFF_MS),
    "SETTINGS_FIRESTORE_FAILURE_BACKOFF_MS 상수 노출 필수");
  assert.ok(__test.SETTINGS_FIRESTORE_FAILURE_BACKOFF_MS >= 1000,
    "backoff 은 최소 1s — 너무 짧으면 circuit breaker 의미 없음");

  // ── 계약 (A):  happy-path 는 예전 동작 그대로.  Firestore 에서 읽고 캐시.
  resetEverything();
  {
    const r1 = await __test.getSettingsDocCached("system", 5000, { fallbackFlag: true });
    assert.strictEqual(r1.ok, true);
    assert.strictEqual(r1.source, "firestore", "첫 번째 호출은 firestore 에서 와야 함");
    assert.deepStrictEqual(r1.data, { hello: "world" });

    const r2 = await __test.getSettingsDocCached("system", 5000, { fallbackFlag: true });
    assert.strictEqual(r2.source, "cache", "TTL 안쪽이면 cache 에서 와야 함");
    assert.strictEqual(stubBehavior.getCallCount, 1, "TTL 안쪽에서 Firestore 재호출 금지");
  }

  // ── 계약 (B):  Firestore throw + stale cache 존재 → stale cache 로 degrade,
  //             상위로 throw 하지 않음.
  resetEverything();
  {
    // 1차:  성공해서 캐시 세팅
    await __test.getSettingsDocCached("system", 1, { fallbackFlag: true });
    assert.strictEqual(stubBehavior.getCallCount, 1);

    // 2차:  TTL 지난 뒤 Firestore 가 throw
    await new Promise((resolve) => setTimeout(resolve, 5));
    stubBehavior.mode = "throw";
    const r = await __test.getSettingsDocCached("system", 1, { fallbackFlag: true });
    assert.strictEqual(r.source, "stale_cache_firestore_unavailable",
      "Firestore 실패 + stale cache 있으면 stale cache 로 degrade 해야 함 " +
      "(상위 콜러가 tick_exit_native_protection_refresh_error 로 오진하지 않게)");
    assert.deepStrictEqual(r.data, { hello: "world" },
      "stale 값이어도 마지막으로 성공한 데이터를 줘야 함");

    const warn = lastWarnEvent();
    assert.ok(warn, "Firestore 실패는 settings_doc_firestore_unavailable 이벤트로 관측되어야 함");
    assert.strictEqual(warn.key, "system");
    assert.strictEqual(warn.have_stale_cache, true);
    assert.strictEqual(warn.have_fallback, true);
    assert.ok(warn.error.includes("14 UNAVAILABLE"),
      "원본 에러 메시지가 보존되어야 진단 가능");
  }

  // ── 계약 (C):  Firestore throw + cache 없음 + fallback 있음 → fallback degrade.
  resetEverything();
  {
    stubBehavior.mode = "throw";
    const fallbackObj = { fromFallback: true, n: 42 };
    const r = await __test.getSettingsDocCached("system", 1000, fallbackObj);
    assert.strictEqual(r.source, "fallback_firestore_unavailable",
      "cache 없이 Firestore 실패하면 fallback 을 돌려줘야 함");
    assert.deepStrictEqual(r.data, fallbackObj);
  }

  // ── 계약 (D):  Firestore throw + cache 없음 + fallback 없음 → 상위로 throw.
  //             이건 프로세스가 막 올라온 경우.
  resetEverything();
  {
    stubBehavior.mode = "throw";
    let thrown = null;
    try {
      await __test.getSettingsDocCached("system", 1000, null);
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown, "cache/fallback 둘 다 없을 때는 원본 에러가 상위로 전파되어야 함");
    assert.ok(String(thrown.message).includes("14 UNAVAILABLE"),
      "원본 에러 메시지 보존");
  }

  // ── 계약 (E):  Circuit breaker — 실패 직후 BACKOFF 안의 재호출은 Firestore
  //             를 다시 두드리지 않는다.
  resetEverything();
  {
    // 1차:  성공으로 캐시 세팅
    await __test.getSettingsDocCached("system", 1, { fallbackFlag: true });
    assert.strictEqual(stubBehavior.getCallCount, 1);

    // 2차:  TTL 지나고 throw
    await new Promise((resolve) => setTimeout(resolve, 5));
    stubBehavior.mode = "throw";
    const r2 = await __test.getSettingsDocCached("system", 1, { fallbackFlag: true });
    assert.strictEqual(r2.source, "stale_cache_firestore_unavailable");
    assert.strictEqual(stubBehavior.getCallCount, 2, "2차에서는 Firestore 한 번 호출");

    // 3차:  같은 실패 backoff 안 — Firestore 를 다시 건드리면 안 됨
    const r3 = await __test.getSettingsDocCached("system", 1, { fallbackFlag: true });
    assert.strictEqual(r3.source, "stale_cache_firestore_backoff",
      "BACKOFF 안의 재호출은 Firestore 를 두드리지 않고 stale cache 로 즉답");
    assert.strictEqual(stubBehavior.getCallCount, 2,
      "BACKOFF 동안 Firestore 호출 횟수가 증가하면 안 됨");
  }

  // ── 계약 (F):  Firestore 복구 → 다음 성공 호출이 failure 마커를 지워서
  //             다시 정상 경로로 복귀한다.
  resetEverything();
  {
    await __test.getSettingsDocCached("system", 1, { fb: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    stubBehavior.mode = "throw";
    await __test.getSettingsDocCached("system", 1, { fb: true });
    // 이 시점에 failedAtMs.system 이 세팅되어 있음
    const cacheRef = __test._cacheRef();
    assert.ok(cacheRef.failedAtMs.system > 0, "실패 후 failedAtMs 마커 세팅");

    // BACKOFF 지나서 Firestore 복구
    await new Promise((resolve) => setTimeout(resolve, __test.SETTINGS_FIRESTORE_FAILURE_BACKOFF_MS + 50));
    stubBehavior.mode = "ok";
    stubBehavior.docData = { recovered: true };
    const r = await __test.getSettingsDocCached("system", 1, { fb: true });
    assert.strictEqual(r.source, "firestore", "복구 후 정상 경로 복귀");
    assert.deepStrictEqual(r.data, { recovered: true });
    assert.strictEqual(cacheRef.failedAtMs.system, 0,
      "성공 시 failedAtMs 마커가 0 으로 리셋되어 circuit breaker 풀려야 함");
  }

  // ── 계약 (G):  이 fix 의 존재 이유를 잠그는 계약 — 상위 콜러의 오진 시나리오.
  //             과거에는 `getSystemSettingsForProvider(prov, 5000)` 이 Firestore
  //             실패 시 그대로 throw 해서 `refreshBinanceTickExitNativeProtection`
  //             의 try 블록으로 버블업했다.  이제는 stale cache 가 있는 한 상위
  //             콜러는 에러를 보지 않는다.
  resetEverything();
  {
    // 1차 성공으로 system settings 캐시 채움
    const ok1 = await settings.getSystemSettingsForProvider("BINANCEFUT", 5000);
    assert.strictEqual(ok1.ok, true);

    // TTL 지나고 Firestore throw 상태
    await new Promise((resolve) => setTimeout(resolve, 10));
    stubBehavior.mode = "throw";

    let thrown = null;
    let result = null;
    try {
      result = await settings.getSystemSettingsForProvider("BINANCEFUT", 5);
    } catch (e) {
      thrown = e;
    }
    assert.strictEqual(thrown, null,
      "상위 콜러 (tick-exit refresh 경로) 는 Firestore 실패를 봐서는 안 됨 — " +
      "이게 없으면 모든 Firestore blip 이 tick_exit_native_protection_refresh_error 로 오진됨");
    assert.ok(result && result.ok === true);
    assert.strictEqual(result.provider, "BINANCEFUT");
  }

  console.warn = originalWarn;
  console.log("SETTINGS_FIRESTORE_UNAVAILABLE_DEGRADE_TEST_OK");
})().catch((err) => {
  console.warn = originalWarn;
  console.error("SETTINGS_FIRESTORE_UNAVAILABLE_DEGRADE_TEST_FAIL:", err && err.stack || err);
  process.exit(1);
});
