const fs = require("fs");
const path = require("path");

const CACHE_PATH = process.env.NEWS_CACHE_PATH || "/tmp/donbeolja_news_cache.json";
const CACHE_TTL_MS = Number(process.env.NEWS_CACHE_TTL_MS || 6 * 60 * 60 * 1000);

function cacheKey({ provider, keywords, language }) {
  const kw = (keywords || []).map((k) => String(k || "").trim().toLowerCase()).filter(Boolean).slice(0, 20);
  return [String(provider || "").toLowerCase(), String(language || "").toLowerCase(), kw.join("|")].join("::");
}

function readCache(key) {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = fs.readFileSync(CACHE_PATH, "utf8");
    const data = JSON.parse(raw);
    const item = data && data[key];
    if (!item || !Array.isArray(item.articles)) return null;
    const ts = Number(item.ts || 0);
    if (!Number.isFinite(ts)) return null;
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return { articles: item.articles };
  } catch (_) {
    return null;
  }
}

function writeCache(key, articles) {
  try {
    const dir = path.dirname(CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let data = {};
    if (fs.existsSync(CACHE_PATH)) {
      try {
        data = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) || {};
      } catch (_) {
        data = {};
      }
    }
    data[key] = { ts: Date.now(), articles };
    fs.writeFileSync(CACHE_PATH, JSON.stringify(data));
  } catch (_) {}
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchFromNewsApi({ apiKey, keywords, fromIso, toIso, pageSize, language }) {
  const out = { ok: false, provider: "newsapi", reason: null, articles: [] };
  if (!apiKey) {
    out.reason = "NO_API_KEY";
    return out;
  }

  const qs = new URLSearchParams();
  qs.set("q", (keywords || []).join(" OR ") || "crypto");
  if (fromIso) qs.set("from", fromIso);
  if (toIso) qs.set("to", toIso);
  qs.set("language", language || "en");
  qs.set("sortBy", "publishedAt");
  qs.set("pageSize", String(pageSize || 50));
  const url = `https://newsapi.org/v2/everything?${qs.toString()}`;

  const key = cacheKey({ provider: "newsapi", keywords, language });

  try {
    let res = await fetch(url, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
      },
    });
    if (!res.ok) {
      if (res.status === 429) {
        await sleepMs(1200);
        res = await fetch(url, {
          method: "GET",
          headers: { "x-api-key": apiKey },
        });
      }
      if (!res.ok) {
        out.reason = `HTTP_${res.status}`;
        const cached = readCache(key);
        if (cached) {
          return { ok: true, provider: "newsapi", reason: `CACHE_FALLBACK:${out.reason}`, articles: cached.articles, cached: true };
        }
        return out;
      }
    }
    const json = await res.json();
    const items = Array.isArray(json.articles) ? json.articles : [];
    const articles = items.map((a) => ({
      title: String(a.title || "").trim(),
      description: String(a.description || "").trim(),
      url: String(a.url || "").trim(),
      published_at: String(a.publishedAt || "").trim(),
      source: a && a.source ? String(a.source.name || "").trim() : null,
    })).filter((a) => a.title);
    out.ok = true;
    out.articles = articles;
    writeCache(key, articles);
    return out;
  } catch (e) {
    out.reason = e && e.message ? e.message : String(e);
    const cached = readCache(key);
    if (cached) {
      return { ok: true, provider: "newsapi", reason: `CACHE_FALLBACK:${out.reason}`, articles: cached.articles, cached: true };
    }
    return out;
  }
}

async function fetchFromGdelt({ keywords, fromIso, toIso, pageSize }) {
  const out = { ok: false, provider: "gdelt", reason: null, articles: [] };
  const cleaned = (keywords || [])
    .map((k) => String(k || "").replace(/[^a-zA-Z0-9]/g, "").trim())
    .filter(Boolean);
  const uniq = [];
  if (cleaned.includes("crypto")) uniq.push("crypto");
  for (const k of cleaned) {
    if (!uniq.includes(k)) uniq.push(k);
  }
  const tokens = uniq.slice(0, 10);
  const query = tokens.length > 1 ? `(${tokens.join(" OR ")})` : (tokens[0] || "crypto");
  const qs = new URLSearchParams();
  qs.set("query", query);
  qs.set("mode", "ArtList");
  qs.set("format", "json");
  qs.set("maxrecords", String(pageSize || 50));
  qs.set("sort", "HybridRel");
  const toGdeltDate = (iso) => {
    if (!iso) return null;
    const raw = String(iso);
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 14) return null;
    return digits.slice(0, 14);
  };
  const start = toGdeltDate(fromIso);
  const end = toGdeltDate(toIso);
  if (start) qs.set("startdatetime", start);
  if (end) qs.set("enddatetime", end);
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?${qs.toString()}`;

  const key = cacheKey({ provider: "gdelt", keywords, language: null });

  try {
    let res = await fetch(url, { method: "GET" });
    let text = await res.text();
    if (!res.ok) {
      if (res.status === 429) {
        await sleepMs(1200);
        res = await fetch(url, { method: "GET" });
        text = await res.text();
      }
      if (!res.ok) {
        out.reason = `HTTP_${res.status}`;
        const cached = readCache(key);
        if (cached) {
          return { ok: true, provider: "gdelt", reason: `CACHE_FALLBACK:${out.reason}`, articles: cached.articles, cached: true };
        }
        return out;
      }
    }
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) {
      out.reason = text.slice(0, 120);
      const cached = readCache(key);
      if (cached) {
        return { ok: true, provider: "gdelt", reason: `CACHE_FALLBACK:${out.reason}`, articles: cached.articles, cached: true };
      }
      return out;
    }
    const items = Array.isArray(json.articles) ? json.articles : [];
    const articles = items.map((a) => ({
      title: String(a.title || "").trim(),
      description: String(a.seendate || "").trim(),
      url: String(a.url || "").trim(),
      published_at: String(a.seendate || "").trim(),
      source: a && a.sourceCountry ? String(a.sourceCountry || "").trim() : null,
    })).filter((a) => a.title);
    out.ok = true;
    out.articles = articles;
    writeCache(key, articles);
    return out;
  } catch (e) {
    out.reason = e && e.message ? e.message : String(e);
    const cached = readCache(key);
    if (cached) {
      return { ok: true, provider: "gdelt", reason: `CACHE_FALLBACK:${out.reason}`, articles: cached.articles, cached: true };
    }
    return out;
  }
}

function extractDomain(url) {
  try {
    const u = new URL(String(url || ""));
    return u.hostname || null;
  } catch (_) {
    return null;
  }
}

function collectOutputText(responseJson) {
  const out = [];
  const items = Array.isArray(responseJson && responseJson.output) ? responseJson.output : [];
  for (const item of items) {
    if (!item || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const c of item.content) {
      if (c && c.type === "output_text" && typeof c.text === "string") {
        out.push(c.text);
      }
    }
  }
  return out.join("\n").trim();
}

function isLowSignalArticle(article) {
  const title = String(article && article.title || "").trim();
  const description = String(article && article.description || "").trim();
  const url = String(article && article.url || "").trim();
  const source = String(article && article.source || "").trim();
  const text = `${title}\n${description}\n${url}\n${source}`.toLowerCase();
  if (!text) return false;

  const actionableHints = [
    "cpi", "pce", "inflation", "fed", "fomc", "rate cut", "interest rate", "usd", "dollar",
    "tariff", "etf", "sec", "hack", "exploit", "liquidation", "flows", "funding rate",
    "regulation", "lawsuit", "treasury", "employment", "payroll", "btc reserve", "bitcoin reserve",
    "order", "executive order",
  ];
  if (actionableHints.some((kw) => text.includes(kw))) return false;

  const lowSignalPatterns = [
    /index methodology/i,
    /\bmethodology\b/i,
    /old research pdf/i,
    /\bresearch pdf/i,
    /\.pdf(\b|$)/i,
    /\/pdf\//i,
    /\bwhitepaper\b/i,
    /\bdocs?\b/i,
    /coindesk.*indices?/i,
  ];
  const hasLowSignalMarker = lowSignalPatterns.some((re) => re.test(text));
  const staleTopicOnly = /\b(halving|eth 2\.0)\b/i.test(text) && (/\b(pdf|research|methodology|doc)\b/i.test(text));
  return hasLowSignalMarker || staleTopicOnly;
}

function filterLowSignalArticles(articles) {
  const list = Array.isArray(articles) ? articles : [];
  const kept = [];
  const dropped = [];
  for (const article of list) {
    if (isLowSignalArticle(article)) dropped.push(article);
    else kept.push(article);
  }
  return { kept, dropped };
}

function normalizeDomains(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s || "").trim()).filter(Boolean);
  }
  return String(raw).split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
}

async function fetchFromOpenAIWebSearch({ apiKey, keywords, fromIso, toIso, pageSize, model, language, allowedDomains } = {}) {
  const out = { ok: false, provider: "openai_web", reason: null, articles: [] };
  if (!apiKey) {
    out.reason = "NO_API_KEY";
    return out;
  }
  const key = cacheKey({ provider: "openai_web", keywords, language });

  const queryTerms = (keywords || []).map((k) => String(k || "").trim()).filter(Boolean).slice(0, 12);
  const query = queryTerms.join(", ");
  const prompt = [
    `Find recent market-moving news about: ${query || "crypto and global macro"}.`,
    fromIso ? `Time window: ${fromIso} to ${toIso || ""}.` : "",
    "Prioritize news that can move crypto in the next 24-72 hours.",
    "Explicitly include macro drivers if available: Fed/rates, Treasury yields, USD/DXY, equities (Nasdaq/S&P 500), credit, oil, tariffs, ETF flows, major regulation.",
    "Exclude methodology docs, index rules, research PDFs, explainers, evergreen background pieces, or stale archival material.",
    "Return JSON only with fields:",
    "{",
    '  "articles": [',
    '    {"title": "...", "url": "...", "source": "...", "published_at": "..."}',
    "  ]",
    "}",
  ].filter(Boolean).join("\n");

  const allowedDomainsParam = normalizeDomains(allowedDomains);
  const allowedDomainsEnv = normalizeDomains(process.env.NEWS_WEB_ALLOWED_DOMAINS || "");
  const allowedDomainsFinal = allowedDomainsParam.length
    ? allowedDomainsParam
    : (allowedDomainsEnv.length ? allowedDomainsEnv : [
      "reuters.com",
      "bloomberg.com",
      "ft.com",
      "wsj.com",
      "yahoo.com",
      "investing.com",
      "coindesk.com",
      "cointelegraph.com",
      "news.google.com",
      "naver.com",
      "daum.net",
      "dart.fss.or.kr",
      "fss.or.kr",
      "kind.krx.co.kr",
      "krx.co.kr",
      "yna.co.kr",
      "mk.co.kr",
      "hankyung.com",
    ]);
  const payload = {
    model: model || "gpt-5.2",
    input: prompt,
    temperature: 0.2,
    tools: [
      {
        type: "web_search",
        filters: {
          allowed_domains: allowedDomainsFinal,
        },
      },
    ],
    include: ["web_search_call.action.sources"],
  };

  try {
    let res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errText = await res.text();
      if (res.status === 429) {
        await sleepMs(1200);
        res = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const retryText = await res.text();
          out.reason = `HTTP_${res.status}:${retryText.slice(0, 160)}`;
          const cached = readCache(key);
          if (cached) {
            return { ok: true, provider: "openai_web", reason: `CACHE_FALLBACK:${out.reason}`, articles: cached.articles, cached: true };
          }
          return out;
        }
      }
      if (!res.ok) {
        out.reason = `HTTP_${res.status}:${errText.slice(0, 160)}`;
        const cached = readCache(key);
        if (cached) {
          return { ok: true, provider: "openai_web", reason: `CACHE_FALLBACK:${out.reason}`, articles: cached.articles, cached: true };
        }
        return out;
      }
    }
    const json = await res.json();
    const outputItems = Array.isArray(json && json.output) ? json.output : [];
    const sources = [];
    for (const item of outputItems) {
      const t = String(item && item.type || "");
      if (t.includes("web_search_call")) {
        const src = item && item.action && Array.isArray(item.action.sources) ? item.action.sources : [];
        for (const s of src) sources.push(s);
      }
    }
    const articlesFromSources = sources.map((s) => {
      const url = String(s && (s.url || s.link) || "").trim();
      const title = String(s && (s.title || s.name) || "").trim() || url;
      const published = s && (s.published_at || s.published || s.date || s.seendate);
      const source = s && (s.source || s.source_name || s.domain || extractDomain(url));
      return {
        title,
        description: String(s && (s.snippet || s.description) || "").trim(),
        url,
        published_at: published ? String(published) : null,
        source: source || null,
      };
    }).filter((a) => a.title && a.url);

    let articles = articlesFromSources;
    if (!articles.length) {
      const text = collectOutputText(json);
      if (text) {
        try {
          const parsed = JSON.parse(text);
          if (parsed && Array.isArray(parsed.articles)) {
            articles = parsed.articles.map((a) => ({
              title: String(a.title || "").trim(),
              description: String(a.description || "").trim(),
              url: String(a.url || "").trim(),
              published_at: a.published_at ? String(a.published_at) : null,
              source: a.source ? String(a.source) : null,
            })).filter((a) => a.title && a.url);
          }
        } catch (_) {}
      }
    }

    const filtered = filterLowSignalArticles(articles);
    out.ok = true;
    out.articles = filtered.kept;
    if (!filtered.kept.length) {
      out.reason = filtered.dropped.length ? "LOW_SIGNAL_FILTERED" : "EMPTY_RESULTS";
    }
    writeCache(key, filtered.kept);
    return out;
  } catch (e) {
    out.reason = e && e.message ? e.message : String(e);
    const cached = readCache(key);
    if (cached) {
      return { ok: true, provider: "openai_web", reason: `CACHE_FALLBACK:${out.reason}`, articles: cached.articles, cached: true };
    }
    return out;
  }
}

async function fetchNews({ apiKey, keywords, fromIso, toIso, pageSize = 50, provider, language, model, allowedDomains } = {}) {
  const p = String(provider || "gdelt").toLowerCase();
  let result = null;
  if (p === "newsapi") {
    result = await fetchFromNewsApi({ apiKey, keywords, fromIso, toIso, pageSize, language });
  } else if (p === "openai" || p === "openai_web" || p === "openai-web") {
    result = await fetchFromOpenAIWebSearch({ apiKey, keywords, fromIso, toIso, pageSize, model, language, allowedDomains });
  } else {
    result = await fetchFromGdelt({ keywords, fromIso, toIso, pageSize });
  }
  if (!result || !Array.isArray(result.articles)) return result;
  const filtered = filterLowSignalArticles(result.articles);
  if (filtered.dropped.length > 0) {
    result.articles = filtered.kept;
    if (!filtered.kept.length && result.ok) {
      result.reason = result.reason || "LOW_SIGNAL_FILTERED";
    }
  }
  return result;
}

module.exports = { fetchNews };
module.exports.__test = {
  isLowSignalArticle,
  filterLowSignalArticles,
};
