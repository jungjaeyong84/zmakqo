const crypto = require("crypto");
const { shouldUseEgressProxy, callEgressProxy } = require("../utils/egressProxy");

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function buildQuery(params) {
  if (!params) return "";
  if (typeof params === "string") return params;
  if (typeof params !== "object") return "";
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  const parts = [];
  for (const [kRaw, v] of entries) {
    const k = String(kRaw);
    if (Array.isArray(v)) {
      for (const it of v) {
        if (it === undefined || it === null || it === "") continue;
        parts.push(`${k}=${String(it)}`);
      }
      continue;
    }
    parts.push(`${k}=${String(v)}`);
  }
  return parts.join("&");
}

function signJwt({ accessKey, secretKey, queryString }) {
  const header = { alg: "HS512", typ: "JWT" };
  const nonce = (crypto.randomUUID && typeof crypto.randomUUID === "function")
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");
  const payload = { access_key: accessKey, nonce };
  if (queryString) {
    const queryHash = crypto.createHash("sha512").update(queryString, "utf8").digest("hex");
    payload.query_hash = queryHash;
    payload.query_hash_alg = "SHA512";
  }

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const token = `${headerB64}.${payloadB64}`;
  const signature = crypto.createHmac("sha512", secretKey).update(token).digest();
  return `${token}.${base64url(signature)}`;
}

async function upbitRequest({ accessKey, secretKey, method, path, query, body }) {
  if (!accessKey || !secretKey) throw new Error("UPBIT_KEYS_MISSING");
  const urlQuery = buildQuery(query);
  const hashQuery = buildQuery(
    (body && typeof body === "object" ? body : null) ||
    (query && Object.keys(query).length ? query : null)
  );
  const token = signJwt({ accessKey, secretKey, queryString: hashQuery });
  const url = `https://api.upbit.com${path}${urlQuery ? "?" + urlQuery : ""}`;
  const options = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  };
  if (body && (method === "POST" || method === "DELETE")) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`UPBIT_HTTP_${res.status}: ${text.slice(0, 400)}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  if (!text) return null;
  return JSON.parse(text);
}

async function fetchAccounts({ accessKey, secretKey }) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "upbit",
      action: "fetchAccounts",
      payload: { accessKey, secretKey },
    });
  }
  return upbitRequest({ accessKey, secretKey, method: "GET", path: "/v1/accounts" });
}

async function placeMarketBuy({ accessKey, secretKey, market, priceKrw }) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "upbit",
      action: "placeMarketBuy",
      payload: { accessKey, secretKey, market, priceKrw },
    });
  }
  const body = {
    market,
    side: "bid",
    price: String(priceKrw),
    ord_type: "price",
  };
  return upbitRequest({
    accessKey,
    secretKey,
    method: "POST",
    path: "/v1/orders",
    query: null,
    body,
  });
}

async function placeMarketSell({ accessKey, secretKey, market, volume }) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "upbit",
      action: "placeMarketSell",
      payload: { accessKey, secretKey, market, volume },
    });
  }
  const body = {
    market,
    side: "ask",
    volume: String(volume),
    ord_type: "market",
  };
  return upbitRequest({
    accessKey,
    secretKey,
    method: "POST",
    path: "/v1/orders",
    query: null,
    body,
  });
}

async function fetchOrder({ accessKey, secretKey, uuid }) {
  if (shouldUseEgressProxy()) {
    return callEgressProxy({
      provider: "upbit",
      action: "fetchOrder",
      payload: { accessKey, secretKey, uuid },
    });
  }
  const query = { uuid };
  return upbitRequest({
    accessKey,
    secretKey,
    method: "GET",
    path: "/v1/order",
    query,
  });
}

function calcAveragePrice(order) {
  if (!order) return null;
  const trades = Array.isArray(order.trades) ? order.trades : [];
  let totalValue = 0;
  let totalVol = 0;
  for (const t of trades) {
    const p = Number(t.price);
    const v = Number(t.volume);
    if (!Number.isFinite(p) || !Number.isFinite(v)) continue;
    totalValue += p * v;
    totalVol += v;
  }
  if (totalVol > 0) return totalValue / totalVol;
  const avg = Number(order.avg_price);
  if (Number.isFinite(avg) && avg > 0) return avg;
  const price = Number(order.price);
  return Number.isFinite(price) && price > 0 ? price : null;
}

module.exports = {
  fetchAccounts,
  placeMarketBuy,
  placeMarketSell,
  fetchOrder,
  calcAveragePrice,
};
