const assert = require("assert");
const aiAllocation = require("../services/aiAllocation");

const { buildNewsKeywords, buildEffectiveModeReason } = (aiAllocation.__test || {});

(() => {
  assert.ok(typeof buildNewsKeywords === "function");
  assert.ok(typeof buildEffectiveModeReason === "function");
  const keywords = buildNewsKeywords(["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"]);
  assert.ok(Array.isArray(keywords));
  const firstTwelve = keywords.slice(0, 12);
  assert.ok(firstTwelve.includes("fed"));
  assert.ok(firstTwelve.includes("interest rates"));
  assert.ok(firstTwelve.includes("usd"));
  assert.ok(firstTwelve.includes("treasury yields"));
  assert.ok(firstTwelve.includes("nasdaq"));
  assert.strictEqual(
    buildEffectiveModeReason({
      gptParsed: { reason: "Recent headlines suggest mixed sentiment." },
      claudeParsed: { reason: "Macro uncertainty remains elevated." },
      gptReason: "GPT_BATCH_OK",
      claudeReason: "CLAUDE_BATCH_OK",
      ensembleUsed: true,
    }),
    "Recent headlines suggest mixed sentiment. | Macro uncertainty remains elevated."
  );
  assert.strictEqual(
    buildEffectiveModeReason({
      gptParsed: null,
      claudeParsed: null,
      gptReason: "GPT_BATCH_OK",
      claudeReason: "CLAUDE_BATCH_OK",
      ensembleUsed: true,
    }),
    null
  );
  console.log("AI_ALLOCATION_NEWS_KEYWORDS_TEST_OK");
})();
