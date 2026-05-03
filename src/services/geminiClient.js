const { geminiApiAllowed, retiredReason } = require("../utils/paidAiProviderGuard");

function safeJsonParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function shouldRetryGemini(status) {
  const n = Number(status);
  return n === 429 || (n >= 500 && n < 600);
}

function resolveRetryDelayMs({ attempt, retryBaseMs, retryAfterHeader }) {
  const retryAfterSeconds = Number(retryAfterHeader);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }
  const base = Math.max(250, Number(retryBaseMs) || 1000);
  return base * (2 ** Math.max(0, attempt));
}

async function callGemini({ apiKey, model, system, prompt, temperature, maxTokens, retryMax, retryBaseMs } = {}) {
  if (!geminiApiAllowed()) return { ok: false, reason: retiredReason("GEMINI_API") };
  if (!apiKey) return { ok: false, reason: "NO_API_KEY" };
  const targetModel = String(model || "gemini-2.5-pro").trim();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const payload = {
    system_instruction: system ? { parts: [{ text: String(system) }] } : undefined,
    contents: [
      {
        role: "user",
        parts: [{ text: String(prompt || "") }],
      },
    ],
    generationConfig: {
      temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.2,
      maxOutputTokens: Number.isFinite(Number(maxTokens)) ? Number(maxTokens) : 1200,
      responseMimeType: "text/plain",
    },
  };
  const maxAttempts = Math.max(1, (Number(retryMax) || 0) + 1);
  let lastFailure = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const raw = await res.text();
      if (!res.ok) {
        lastFailure = { ok: false, reason: `HTTP_${res.status}`, body: raw, status: res.status, attempts: attempt + 1 };
        if (attempt + 1 < maxAttempts && shouldRetryGemini(res.status)) {
          const waitMs = resolveRetryDelayMs({
            attempt,
            retryBaseMs,
            retryAfterHeader: res.headers && typeof res.headers.get === "function" ? res.headers.get("retry-after") : null,
          });
          await sleep(waitMs);
          continue;
        }
        return lastFailure;
      }
      const parsed = safeJsonParse(raw);
      const text = Array.isArray(parsed && parsed.candidates)
        ? parsed.candidates
          .flatMap((candidate) => (((candidate || {}).content || {}).parts || []))
          .map((part) => String(part && part.text || ""))
          .join("\n")
          .trim()
        : "";
      if (!text) {
        return { ok: false, reason: "EMPTY_RESPONSE", raw: parsed || raw, attempts: attempt + 1 };
      }
      return {
        ok: true,
        text,
        raw: parsed,
        attempts: attempt + 1,
      };
    } catch (err) {
      lastFailure = {
        ok: false,
        reason: "FETCH_FAILED",
        error: err && err.message ? err.message : String(err),
        attempts: attempt + 1,
      };
      if (attempt + 1 < maxAttempts) {
        const waitMs = resolveRetryDelayMs({ attempt, retryBaseMs });
        await sleep(waitMs);
        continue;
      }
      return lastFailure;
    }
  }
  return lastFailure || { ok: false, reason: "UNKNOWN_FAILURE" };
}

module.exports = { callGemini };
