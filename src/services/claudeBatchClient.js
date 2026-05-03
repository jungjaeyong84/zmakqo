/**
 * claudeBatchClient.js — Anthropic Message Batches API (50% 할인)
 *
 * 대량 분석 작업(성과 분석, 백테스트, 주간 리포트 등)을 비동기 배치로 처리.
 * - 최대 100,000 요청 / 256 MB per batch
 * - 50% 비용 절감 (모든 토큰)
 * - Prompt Cache와 함께 사용 가능 (시스템 프롬프트 캐싱)
 * - 대부분 1시간 내 완료, 최대 24시간
 * - 결과 29일간 보관
 *
 * 담당: 수연 팀장 (분석/학습팀 · API최적화)
 */

const BASE_URL = "https://api.anthropic.com/v1/messages/batches";
const API_VERSION = "2023-06-01";
const { anthropicApiAllowed, retiredReason } = require("../utils/paidAiProviderGuard");

function safeJsonParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function getHeaders(apiKey) {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": API_VERSION,
  };
}

/**
 * 단일 배치 요청 항목 생성 (Prompt Cache 지원)
 *
 * @param {string} customId   - 고유 식별자 (결과 매칭용)
 * @param {object} opts
 * @param {string} opts.model        - 모델 ID
 * @param {string} [opts.system]     - System prompt (캐싱 대상)
 * @param {string} opts.prompt       - User message
 * @param {number} [opts.maxTokens]  - max output tokens
 * @param {number} [opts.temperature] - 0~1
 * @param {boolean} [opts.cacheSystem] - system prompt에 cache_control 적용
 */
function buildBatchRequest(customId, { model, system, prompt, maxTokens, temperature, cacheSystem } = {}) {
  const params = {
    model: model || "claude-sonnet-4-6-20260514",
    max_tokens: Number.isFinite(Number(maxTokens)) ? Number(maxTokens) : 600,
    temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.2,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: String(prompt || "") }],
      },
    ],
  };

  if (system) {
    if (cacheSystem) {
      params.system = [
        {
          type: "text",
          text: String(system),
          cache_control: { type: "ephemeral" },
        },
      ];
    } else {
      params.system = String(system);
    }
  }

  return {
    custom_id: String(customId),
    params,
  };
}

/**
 * 배치 생성 (POST /v1/messages/batches)
 *
 * @param {string} apiKey
 * @param {Array} requests - buildBatchRequest()로 생성한 항목 배열
 * @returns {{ ok: boolean, batch_id?: string, status?: string, error?: string, raw?: object }}
 */
async function createBatch(apiKey, requests) {
  if (!anthropicApiAllowed()) return { ok: false, error: retiredReason("ANTHROPIC_BATCH_API") };
  if (!apiKey) return { ok: false, error: "NO_API_KEY" };
  if (!Array.isArray(requests) || requests.length === 0) {
    return { ok: false, error: "NO_REQUESTS" };
  }

  try {
    const res = await fetch(BASE_URL, {
      method: "POST",
      headers: getHeaders(apiKey),
      body: JSON.stringify({ requests }),
    });

    const raw = await res.text();
    const parsed = safeJsonParse(raw);

    if (!res.ok) {
      const msg = parsed && parsed.error && parsed.error.message
        ? parsed.error.message
        : raw.slice(0, 200);
      return { ok: false, error: `HTTP_${res.status}:${msg}`, raw: parsed };
    }

    return {
      ok: true,
      batch_id: parsed.id,
      status: parsed.processing_status,
      request_counts: parsed.request_counts || null,
      created_at: parsed.created_at || null,
      raw: parsed,
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

/**
 * 배치 상태 조회 (GET /v1/messages/batches/{id})
 *
 * @param {string} apiKey
 * @param {string} batchId
 * @returns {{ ok: boolean, status?: string, ended?: boolean, request_counts?: object, error?: string }}
 */
async function getBatchStatus(apiKey, batchId) {
  if (!anthropicApiAllowed()) return { ok: false, error: retiredReason("ANTHROPIC_BATCH_API") };
  if (!apiKey) return { ok: false, error: "NO_API_KEY" };
  if (!batchId) return { ok: false, error: "NO_BATCH_ID" };

  try {
    const res = await fetch(`${BASE_URL}/${batchId}`, {
      method: "GET",
      headers: getHeaders(apiKey),
    });

    const raw = await res.text();
    const parsed = safeJsonParse(raw);

    if (!res.ok) {
      return { ok: false, error: `HTTP_${res.status}`, raw: parsed };
    }

    return {
      ok: true,
      batch_id: parsed.id,
      status: parsed.processing_status,
      ended: parsed.processing_status === "ended",
      request_counts: parsed.request_counts || null,
      created_at: parsed.created_at || null,
      ended_at: parsed.ended_at || null,
      raw: parsed,
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

/**
 * 배치 결과 조회 (GET /v1/messages/batches/{id}/results)
 *
 * JSONL 스트림으로 반환됨 → 파싱하여 배열로 반환
 *
 * @param {string} apiKey
 * @param {string} batchId
 * @returns {{ ok: boolean, results?: Array, error?: string }}
 *
 * 각 result 구조:
 * {
 *   custom_id: string,
 *   result: {
 *     type: "succeeded" | "errored" | "expired" | "canceled",
 *     message?: { content: [...], usage: {...} },  // succeeded일 때
 *     error?: { type: string, message: string },   // errored일 때
 *   }
 * }
 */
async function getBatchResults(apiKey, batchId) {
  if (!anthropicApiAllowed()) return { ok: false, error: retiredReason("ANTHROPIC_BATCH_API") };
  if (!apiKey) return { ok: false, error: "NO_API_KEY" };
  if (!batchId) return { ok: false, error: "NO_BATCH_ID" };

  try {
    const res = await fetch(`${BASE_URL}/${batchId}/results`, {
      method: "GET",
      headers: getHeaders(apiKey),
    });

    if (!res.ok) {
      const raw = await res.text();
      return { ok: false, error: `HTTP_${res.status}`, body: raw };
    }

    const raw = await res.text();
    const lines = raw.split("\n").filter((l) => l.trim());
    const results = [];
    for (const line of lines) {
      const parsed = safeJsonParse(line);
      if (parsed) results.push(parsed);
    }

    return { ok: true, results, count: results.length };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

/**
 * 배치 취소 (POST /v1/messages/batches/{id}/cancel)
 *
 * @param {string} apiKey
 * @param {string} batchId
 */
async function cancelBatch(apiKey, batchId) {
  if (!anthropicApiAllowed()) return { ok: false, error: retiredReason("ANTHROPIC_BATCH_API") };
  if (!apiKey) return { ok: false, error: "NO_API_KEY" };
  if (!batchId) return { ok: false, error: "NO_BATCH_ID" };

  try {
    const res = await fetch(`${BASE_URL}/${batchId}/cancel`, {
      method: "POST",
      headers: getHeaders(apiKey),
    });

    const raw = await res.text();
    const parsed = safeJsonParse(raw);

    if (!res.ok) {
      return { ok: false, error: `HTTP_${res.status}`, raw: parsed };
    }

    return {
      ok: true,
      batch_id: parsed.id,
      status: parsed.processing_status,
      raw: parsed,
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

/**
 * 배치 폴링 — 완료될 때까지 주기적으로 상태 확인
 *
 * @param {string} apiKey
 * @param {string} batchId
 * @param {object} [opts]
 * @param {number} [opts.intervalMs=30000]   - 폴링 간격 (기본 30초)
 * @param {number} [opts.timeoutMs=3600000]  - 최대 대기 시간 (기본 1시간)
 * @param {function} [opts.onPoll]           - 폴링마다 콜백 (status) => void
 * @returns {{ ok: boolean, batch_id?: string, request_counts?: object, error?: string }}
 */
async function pollBatchUntilDone(apiKey, batchId, { intervalMs = 30_000, timeoutMs = 3_600_000, onPoll } = {}) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const status = await getBatchStatus(apiKey, batchId);

    if (!status.ok) return status;

    if (typeof onPoll === "function") {
      try { onPoll(status); } catch (_) {}
    }

    if (status.ended) {
      return status;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return { ok: false, error: "POLL_TIMEOUT", batch_id: batchId };
}

/**
 * 편의 함수: 배치 제출 → 폴링 → 결과 수집 (올인원)
 *
 * @param {string} apiKey
 * @param {Array} requests - buildBatchRequest()로 생성한 항목 배열
 * @param {object} [opts]  - pollBatchUntilDone 옵션
 * @returns {{ ok: boolean, results?: Array, batch_id?: string, request_counts?: object, error?: string }}
 */
async function submitAndCollect(apiKey, requests, opts = {}) {
  // 1. 배치 생성
  const createRes = await createBatch(apiKey, requests);
  if (!createRes.ok) return createRes;

  const batchId = createRes.batch_id;
  console.log(`[BATCH] Created: ${batchId}, requests: ${requests.length}`);

  // 2. 폴링
  const pollRes = await pollBatchUntilDone(apiKey, batchId, opts);
  if (!pollRes.ok) return { ...pollRes, batch_id: batchId };

  console.log(`[BATCH] Ended: ${batchId}`, pollRes.request_counts);

  // 3. 결과 수집
  const resultsRes = await getBatchResults(apiKey, batchId);
  if (!resultsRes.ok) return { ...resultsRes, batch_id: batchId };

  // 4. 성공/실패 분류
  const succeeded = [];
  const failed = [];
  for (const r of resultsRes.results) {
    if (r.result && r.result.type === "succeeded") {
      const text = r.result.message && Array.isArray(r.result.message.content)
        ? r.result.message.content.map((c) => c && c.text ? String(c.text) : "").join("\n").trim()
        : "";
      succeeded.push({
        custom_id: r.custom_id,
        text,
        usage: r.result.message ? r.result.message.usage : null,
      });
    } else {
      failed.push({
        custom_id: r.custom_id,
        type: r.result ? r.result.type : "unknown",
        error: r.result && r.result.error ? r.result.error : null,
      });
    }
  }

  return {
    ok: true,
    batch_id: batchId,
    request_counts: pollRes.request_counts,
    succeeded,
    failed,
    total: resultsRes.count,
  };
}

/**
 * 결과에서 JSON 텍스트를 파싱하여 반환
 *
 * @param {Array} succeeded - submitAndCollect()의 succeeded 배열
 * @returns {Array<{ custom_id: string, data: object|null, parse_error?: string }>}
 */
function parseResultsAsJson(succeeded) {
  return succeeded.map((s) => {
    const parsed = safeJsonParse(s.text);
    if (parsed) {
      return { custom_id: s.custom_id, data: parsed, usage: s.usage };
    }
    return { custom_id: s.custom_id, data: null, parse_error: "JSON_PARSE_FAIL", raw_text: s.text, usage: s.usage };
  });
}

module.exports = {
  buildBatchRequest,
  createBatch,
  getBatchStatus,
  getBatchResults,
  cancelBatch,
  pollBatchUntilDone,
  submitAndCollect,
  parseResultsAsJson,
};
