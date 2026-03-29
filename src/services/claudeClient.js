function safeJsonParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function extractClaudeError(raw) {
  if (!raw) return null;
  const parsed = safeJsonParse(raw);
  if (parsed && parsed.error && parsed.error.message) {
    return String(parsed.error.message).trim();
  }
  return String(raw).trim();
}

/**
 * callClaude — Anthropic Messages API 호출 (Prompt Cache 지원)
 *
 * @param {object} opts
 * @param {string} opts.apiKey         - Anthropic API key
 * @param {string} opts.model          - 모델 ID (e.g. "claude-sonnet-4-6-20260514")
 * @param {string} [opts.system]       - System prompt (별도 분리 → 캐싱 대상)
 * @param {string} opts.prompt         - User message
 * @param {number} [opts.temperature]  - 0~1
 * @param {number} [opts.maxTokens]    - max output tokens
 * @param {boolean} [opts.jsonMode]    - (unused, prompt 기반 JSON 강제)
 * @param {boolean} [opts.cacheSystem] - true이면 system prompt에 cache_control 적용
 */
async function callClaude({ apiKey, model, system, prompt, temperature, maxTokens, jsonMode, cacheSystem } = {}) {
  if (!apiKey) return { ok: false, reason: "NO_API_KEY" };
  const endpoint = "https://api.anthropic.com/v1/messages";

  // Build system block (캐싱 가능)
  let systemBlock = undefined;
  if (system) {
    if (cacheSystem) {
      // Prompt Cache: system을 array 형태 + cache_control
      systemBlock = [
        {
          type: "text",
          text: String(system),
          cache_control: { type: "ephemeral" },
        },
      ];
    } else {
      systemBlock = String(system);
    }
  }

  const payload = {
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
  if (systemBlock) {
    payload.system = systemBlock;
  }

  const send = async (body) => {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });
      const raw = await res.text();
      return { res, raw };
    } catch (err) {
      return { res: null, raw: null, error: err && err.message ? err.message : String(err) };
    }
  };

  let attempt = await send(payload);
  if (!attempt.res) {
    return { ok: false, reason: "FETCH_FAILED", error: attempt.error || "FETCH_FAILED" };
  }

  let res = attempt.res;
  let raw = attempt.raw;
  // 400 fallback: content를 plain string으로 재시도
  if (!res.ok && res.status === 400) {
    const fallbackPayload = {
      ...payload,
      messages: [{ role: "user", content: String(prompt || "") }],
    };
    const retry = await send(fallbackPayload);
    if (retry.res) {
      res = retry.res;
      raw = retry.raw;
    }
  }

  if (!res.ok) {
    const msg = extractClaudeError(raw);
    const suffix = msg ? `:${msg.slice(0, 160)}` : "";
    return { ok: false, reason: `HTTP_${res.status}${suffix}`, status: res.status, body: raw };
  }

  const parsed = safeJsonParse(raw);
  if (!parsed || !Array.isArray(parsed.content)) {
    return { ok: false, reason: "BAD_RESPONSE", body: raw };
  }
  const text = parsed.content.map((c) => c && c.text ? String(c.text) : "").join("\n").trim();

  // Usage with cache metrics
  const usage = parsed.usage || null;
  const cacheMetrics = usage ? {
    input_tokens: usage.input_tokens || 0,
    output_tokens: usage.output_tokens || 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
    cache_read_input_tokens: usage.cache_read_input_tokens || 0,
  } : null;

  return {
    ok: true,
    text,
    usage,
    cacheMetrics,
    raw: parsed,
  };
}

module.exports = { callClaude };
