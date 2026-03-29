const dns = require("node:dns").promises;
const { getFirestore } = require("../src/storage/firestore");

const FIRESTORE_HOST = String(process.env.FIRESTORE_DNS_HOST || "firestore.googleapis.com").trim();
const DNS_TIMEOUT_MS = toInt(process.env.FIRESTORE_DNS_TIMEOUT_MS, 2500, 300, 20000);
const QUERY_TIMEOUT_MS = toInt(process.env.FIRESTORE_QUERY_TIMEOUT_MS, 25000, 1000, 180000);
const DNS_PRECHECK_ENABLED = String(process.env.FIRESTORE_DNS_PRECHECK || "1").trim() !== "0";

function toInt(raw, fallback, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function errorText(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (err.stack) return String(err.stack);
  if (err.message) return String(err.message);
  return String(err);
}

function isDnsError(err) {
  const t = errorText(err).toLowerCase();
  return (
    t.includes("name resolution failed") ||
    t.includes("dns:") ||
    t.includes("enotfound") ||
    t.includes("getaddrinfo") ||
    t.includes("unknown host") ||
    t.includes("dns_lookup_fail")
  );
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`TIMEOUT:${label}:${timeoutMs}ms`);
      err.code = "TIMEOUT";
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function kstDayRange(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const startKst = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const startUtcMs = startKst.getTime() - 9 * 60 * 60 * 1000;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000 - 1;
  return { startUtcMs, endUtcMs };
}

function todayKstStr() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function precheckDns(host, timeoutMs) {
  const rows = await withTimeout(dns.lookup(host, { all: true }), timeoutMs, `dns:${host}`);
  const addresses = Array.isArray(rows) ? rows.map((x) => x && x.address).filter(Boolean) : [];
  if (!addresses.length) {
    const err = new Error(`DNS_LOOKUP_FAIL:${host}`);
    err.code = "DNS_LOOKUP_FAIL";
    throw err;
  }
  return addresses;
}

async function fetchRange(col, startMs, endMs) {
  const db = getFirestore();
  const out = [];
  const query = db
    .collection(col)
    .where("bar_close_time_utc_ms", ">=", startMs)
    .where("bar_close_time_utc_ms", "<=", endMs);
  const snap = await withTimeout(query.get(), QUERY_TIMEOUT_MS, `${col}.get`);
  snap.forEach((doc) => out.push(doc.data()));
  return out;
}

function countBy(items, key) {
  const map = new Map();
  for (const it of items) {
    const v = (it && it[key]) || "UNKNOWN";
    map.set(v, (map.get(v) || 0) + 1);
  }
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
}

function printDnsBlocked(err, extra = {}) {
  const payload = {
    ok: false,
    reason: "FIRESTORE_DNS_BLOCKED",
    host: FIRESTORE_HOST,
    detail: errorText(err),
    ...extra,
    action: [
      "실행 환경 DNS/외부 네트워크 허용 여부를 먼저 확인하세요.",
      "역할봇 사용 시 ROLE_CODEX_SANDBOX=danger-full-access 설정 후 재실행하세요.",
      "재확인 명령: node scripts/inspect-binance-webhook-day.js 2026-02-25",
    ],
  };
  console.error(JSON.stringify(payload, null, 2));
}

(async () => {
  const dateStr = process.argv[2] || todayKstStr();
  const { startUtcMs, endUtcMs } = kstDayRange(dateStr);
  const exchange = "BINANCEFUT";
  const base = {
    date_kst: dateStr,
    exchange,
    range_utc_ms: { startUtcMs, endUtcMs },
    query_timeout_ms: QUERY_TIMEOUT_MS,
    dns_precheck: null,
  };

  if (DNS_PRECHECK_ENABLED) {
    try {
      const addresses = await precheckDns(FIRESTORE_HOST, DNS_TIMEOUT_MS);
      base.dns_precheck = {
        ok: true,
        host: FIRESTORE_HOST,
        timeout_ms: DNS_TIMEOUT_MS,
        resolved_count: addresses.length,
        resolved_sample: addresses.slice(0, 3),
      };
    } catch (err) {
      printDnsBlocked(err, {
        dns_precheck: {
          ok: false,
          timeout_ms: DNS_TIMEOUT_MS,
        },
      });
      process.exit(2);
      return;
    }
  }

  const [signalsAll, dropsAll] = await Promise.all([
    fetchRange("signals", startUtcMs, endUtcMs),
    fetchRange("signals_dropped", startUtcMs, endUtcMs),
  ]);
  const signals = signalsAll.filter((x) => String(x.exchange || "").toUpperCase() === exchange);
  const drops = dropsAll.filter((x) => String(x.exchange || "").toUpperCase() === exchange);

  console.log(
    JSON.stringify(
      {
        ...base,
        signals: signals.length,
        drops: drops.length,
        drop_reasons: countBy(drops, "reason"),
        drop_codes: countBy(drops, "drop_reason_code"),
        events: countBy(signals, "event"),
      },
      null,
      2
    )
  );
})().catch((e) => {
  if (isDnsError(e)) {
    printDnsBlocked(e);
    process.exit(2);
    return;
  }
  console.error(e);
  process.exit(1);
});
