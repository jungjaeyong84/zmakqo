const { auditFillsSignals } = require("../src/services/fillSignalAudit");

const DAY_MS = 24 * 60 * 60 * 1000;

function isDateOnly(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
}

function addDaysKst(dateOnly, days) {
  const ms = new Date(`${dateOnly}T00:00:00+09:00`).getTime() + days * DAY_MS;
  return new Date(ms).toISOString();
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const cur = argv[i];
    if (!cur || !cur.startsWith("--")) continue;
    const key = cur.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

function clampIssueLimit(raw, min = 10, max = 2000) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < min) return min;
  if (n > max) return max;
  return Math.trunc(n);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const from = args.from || args.start || undefined;
  let to = args.to || args.end || undefined;
  if (to && isDateOnly(to)) {
    to = addDaysKst(to, 1);
  }
  const exchange = args.exchange || args.ex || undefined;
  const issueLimit = clampIssueLimit(args.limit || args.issueLimit) ?? undefined;

  const result = await auditFillsSignals({
    from,
    to,
    exchange,
    issueLimit,
  });

  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main().catch((err) => {
  console.error("[audit:fills-signals] failed:", err && err.message ? err.message : err);
  process.exit(1);
});
