/**
 * openaiBatchClient.js — OpenAI Batch API helper (Responses endpoint)
 *
 * - requests(JSONL) 업로드 → batch 생성 → 폴링 → output file 수집
 * - 실패/타임아웃 시 caller가 동기 API 폴백하도록 상태/에러를 반환
 */

const BASE_URL = "https://api.openai.com/v1";

function safeJsonParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function authHeaders(apiKey) {
  return {
    authorization: `Bearer ${apiKey}`,
  };
}

function extractResponseText(json) {
  if (!json) return "";
  if (typeof json.output_text === "string") return json.output_text.trim();
  const output = Array.isArray(json.output) ? json.output : [];
  const chunks = [];
  for (const item of output) {
    if (!item) continue;
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (!c) continue;
        if (c.type === "output_text" && typeof c.text === "string") chunks.push(c.text);
        if (!c.type && typeof c.text === "string") chunks.push(c.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

function buildResponsesBatchRequest(customId, { model, prompt, temperature, maxTokens, jsonMode = true } = {}) {
  const body = {
    model: model || "gpt-5.2",
    temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.2,
    max_output_tokens: Number.isFinite(Number(maxTokens)) ? Number(maxTokens) : 300,
    input: [
      { role: "system", content: "You are a risk-aware quant assistant. Return JSON only." },
      { role: "user", content: String(prompt || "") },
    ],
  };
  if (jsonMode) body.text = { format: { type: "json_object" } };
  return {
    custom_id: String(customId),
    method: "POST",
    url: "/v1/responses",
    body,
  };
}

async function uploadBatchInputFile(apiKey, requests) {
  if (!apiKey) return { ok: false, error: "NO_API_KEY" };
  if (!Array.isArray(requests) || !requests.length) return { ok: false, error: "NO_REQUESTS" };

  const jsonl = requests.map((r) => JSON.stringify(r)).join("\n");
  const form = new FormData();
  form.append("purpose", "batch");
  form.append("file", new Blob([jsonl], { type: "application/jsonl" }), "openai_batch_input.jsonl");

  try {
    const res = await fetch(`${BASE_URL}/files`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: form,
    });
    const raw = await res.text();
    const parsed = safeJsonParse(raw);
    if (!res.ok) {
      const msg = parsed && parsed.error && parsed.error.message ? parsed.error.message : raw.slice(0, 200);
      return { ok: false, error: `HTTP_${res.status}:${msg}`, raw: parsed };
    }
    return { ok: true, file_id: parsed.id, raw: parsed };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

async function createBatch(apiKey, inputFileId, { endpoint = "/v1/responses", completionWindow = "24h" } = {}) {
  if (!apiKey) return { ok: false, error: "NO_API_KEY" };
  if (!inputFileId) return { ok: false, error: "NO_INPUT_FILE_ID" };
  try {
    const res = await fetch(`${BASE_URL}/batches`, {
      method: "POST",
      headers: {
        ...authHeaders(apiKey),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        input_file_id: inputFileId,
        endpoint,
        completion_window: completionWindow,
      }),
    });
    const raw = await res.text();
    const parsed = safeJsonParse(raw);
    if (!res.ok) {
      const msg = parsed && parsed.error && parsed.error.message ? parsed.error.message : raw.slice(0, 200);
      return { ok: false, error: `HTTP_${res.status}:${msg}`, raw: parsed };
    }
    return { ok: true, batch_id: parsed.id, status: parsed.status, raw: parsed };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

async function getBatchStatus(apiKey, batchId) {
  if (!apiKey) return { ok: false, error: "NO_API_KEY" };
  if (!batchId) return { ok: false, error: "NO_BATCH_ID" };
  try {
    const res = await fetch(`${BASE_URL}/batches/${batchId}`, {
      method: "GET",
      headers: authHeaders(apiKey),
    });
    const raw = await res.text();
    const parsed = safeJsonParse(raw);
    if (!res.ok) return { ok: false, error: `HTTP_${res.status}`, raw: parsed };
    const st = String(parsed.status || "").toLowerCase();
    const ended = ["completed", "failed", "expired", "cancelled", "canceled"].includes(st);
    return { ok: true, status: st, ended, raw: parsed };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

async function cancelBatch(apiKey, batchId) {
  if (!apiKey || !batchId) return { ok: false, error: "NO_PARAM" };
  try {
    const res = await fetch(`${BASE_URL}/batches/${batchId}/cancel`, {
      method: "POST",
      headers: authHeaders(apiKey),
    });
    const raw = await res.text();
    const parsed = safeJsonParse(raw);
    if (!res.ok) return { ok: false, error: `HTTP_${res.status}`, raw: parsed };
    return { ok: true, raw: parsed };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

async function pollBatchUntilDone(apiKey, batchId, { pollIntervalMs = 15_000, timeoutMs = 1_500_000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const st = await getBatchStatus(apiKey, batchId);
    if (!st.ok) return st;
    if (st.ended) return st;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  await cancelBatch(apiKey, batchId).catch(() => {});
  return { ok: false, error: "POLL_TIMEOUT", batch_id: batchId };
}

async function readFileContent(apiKey, fileId) {
  if (!apiKey || !fileId) return { ok: false, error: "NO_PARAM" };
  try {
    const res = await fetch(`${BASE_URL}/files/${fileId}/content`, {
      method: "GET",
      headers: authHeaders(apiKey),
    });
    const raw = await res.text();
    if (!res.ok) return { ok: false, error: `HTTP_${res.status}`, body: raw };
    return { ok: true, content: raw };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

async function submitAndCollectResponses(apiKey, requests, opts = {}) {
  const upload = await uploadBatchInputFile(apiKey, requests);
  if (!upload.ok) return upload;

  const create = await createBatch(apiKey, upload.file_id, { endpoint: "/v1/responses", completionWindow: "24h" });
  if (!create.ok) return create;

  const status = await pollBatchUntilDone(apiKey, create.batch_id, opts);
  if (!status.ok) return { ...status, batch_id: create.batch_id };
  const st = String(status.status || "");
  if (st !== "completed") {
    return { ok: false, error: `BATCH_${st.toUpperCase()}`, batch_id: create.batch_id, raw: status.raw };
  }

  const outFileId = status.raw && status.raw.output_file_id ? String(status.raw.output_file_id) : "";
  if (!outFileId) {
    return { ok: false, error: "NO_OUTPUT_FILE_ID", batch_id: create.batch_id, raw: status.raw };
  }
  const file = await readFileContent(apiKey, outFileId);
  if (!file.ok) return { ...file, batch_id: create.batch_id };

  const lines = String(file.content || "").split("\n").filter((x) => x.trim());
  const results = [];
  for (const line of lines) {
    const parsed = safeJsonParse(line);
    if (parsed) results.push(parsed);
  }
  return { ok: true, batch_id: create.batch_id, results, total: results.length };
}

function parseResponsesBatchResults(results) {
  const out = [];
  for (const row of Array.isArray(results) ? results : []) {
    const customId = row && row.custom_id ? String(row.custom_id) : null;
    const error = row && row.error ? row.error : null;
    const response = row && row.response ? row.response : null;
    const statusCode = response && Number(response.status_code);
    const body = response && response.body ? response.body : null;
    const text = body ? extractResponseText(body) : "";
    const parsed = safeJsonParse(text);
    out.push({
      custom_id: customId,
      status_code: Number.isFinite(statusCode) ? statusCode : null,
      error,
      text,
      data: parsed,
      raw: row,
    });
  }
  return out;
}

module.exports = {
  buildResponsesBatchRequest,
  submitAndCollectResponses,
  parseResponsesBatchResults,
};

