const assert = require("assert");
const newsFetch = require("../services/newsFetch");

const { isLowSignalArticle, filterLowSignalArticles } = newsFetch.__test || {};

(() => {
  assert.ok(typeof isLowSignalArticle === "function");
  assert.ok(typeof filterLowSignalArticles === "function");

  const lowSignal = {
    title: "CoinDesk index methodology docs and old research PDFs (halving, ETH 2.0)",
    description: "Index methodology PDF and archived research PDF",
    url: "https://www.coindesk.com/indices/methodology.pdf",
    source: "CoinDesk",
  };
  const actionable = {
    title: "Fed comments and USD weakness lift Bitcoin and ETH",
    description: "Markets react to rates, dollar and ETF flows",
    url: "https://www.reuters.com/markets/crypto/bitcoin-eth-fed-usd-2026-03-23/",
    source: "Reuters",
  };

  assert.strictEqual(isLowSignalArticle(lowSignal), true);
  assert.strictEqual(isLowSignalArticle(actionable), false);

  const filtered = filterLowSignalArticles([lowSignal, actionable]);
  assert.strictEqual(filtered.kept.length, 1);
  assert.strictEqual(filtered.dropped.length, 1);
  assert.strictEqual(filtered.kept[0].title, actionable.title);

  console.log("NEWS_FETCH_FILTER_TEST_OK");
})();
