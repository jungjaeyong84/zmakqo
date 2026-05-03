const assert = require("assert");
const { callGemini } = require("../services/geminiClient");

function withGeminiApiAllowed() {
  const prev = {
    disabled: process.env.DONBEOLJA_PAID_AI_API_DISABLED,
    gemini: process.env.DONBEOLJA_ALLOW_GEMINI_API,
  };
  process.env.DONBEOLJA_PAID_AI_API_DISABLED = "0";
  process.env.DONBEOLJA_ALLOW_GEMINI_API = "1";
  return () => {
    if (prev.disabled === undefined) delete process.env.DONBEOLJA_PAID_AI_API_DISABLED;
    else process.env.DONBEOLJA_PAID_AI_API_DISABLED = prev.disabled;
    if (prev.gemini === undefined) delete process.env.DONBEOLJA_ALLOW_GEMINI_API;
    else process.env.DONBEOLJA_ALLOW_GEMINI_API = prev.gemini;
  };
}

async function testRetries429ThenSuccess() {
  const restoreEnv = withGeminiApiAllowed();
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls < 3) {
      return {
        ok: false,
        status: 429,
        headers: { get: () => null },
        text: async () => JSON.stringify({ error: { message: "rate limit" } }),
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                { text: "{\"provider\":\"gemini\",\"verdict\":\"HOLD\",\"summary\":\"ok\"}" },
              ],
            },
          },
        ],
      }),
    };
  };
  try {
    const res = await callGemini({
      apiKey: "test",
      prompt: "hi",
      retryMax: 2,
      retryBaseMs: 1,
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.attempts, 3);
    assert.strictEqual(calls, 3);
  } finally {
    global.fetch = originalFetch;
    restoreEnv();
  }
}

async function testStopsWithoutRetryBudget() {
  const restoreEnv = withGeminiApiAllowed();
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return {
      ok: false,
      status: 429,
      headers: { get: () => null },
      text: async () => "rate limit",
    };
  };
  try {
    const res = await callGemini({
      apiKey: "test",
      prompt: "hi",
      retryMax: 0,
      retryBaseMs: 1,
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, "HTTP_429");
    assert.strictEqual(res.attempts, 1);
    assert.strictEqual(calls, 1);
  } finally {
    global.fetch = originalFetch;
    restoreEnv();
  }
}

(async () => {
  await testRetries429ThenSuccess();
  await testStopsWithoutRetryBudget();
  console.log("GEMINI_CLIENT_RETRY_TEST_OK");
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
