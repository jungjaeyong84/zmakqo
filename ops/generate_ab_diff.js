/**
 * Generate AB diff markdown from /tmp/report_A_*.json and /tmp/report_B_*.json
 * Output: AB_DIFF_YYYYWW.md (repo root)
 */
const fs = require("fs");
const path = require("path");

function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}W${String(weekNo).padStart(2,"0")}`;
}

function load(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function summarize(r) {
  const expected = new Set(r.markets_expected || []);
  const pos = r.position_snapshot || [];
  const posMkts = new Set(pos.map(x => x.market).filter(Boolean));
  const missing = Array.from(expected).filter(m => !posMkts.has(m)).sort();

  const ms = pos.map(x => Number(x.bar_close_time_utc_ms)).filter(Number.isFinite);
  const diff = ms.length >= 2 ? (Math.max(...ms) - Math.min(...ms)) : 0;

  const kpi = r.kpi_summary || {};
  const fills = r.fills || [];
  const sides = Array.from(new Set(fills.map(f => String(f.side||"").toUpperCase()).filter(Boolean))).sort();
  const srcs  = Array.from(new Set(fills.map(f => String(f.exec_price_source||"")).filter(Boolean))).sort();

  return {
    mode: r.meta?.mode ?? null,
    range: r.meta?.range ?? {},
    kpi_summary: { fills_new: kpi.fills_new ?? null, sells_new: kpi.sells_new ?? null, trades_approx: kpi.trades_approx ?? null },
    fills_len: fills.length,
    missing_markets: missing,
    bar_close_ms_diff: diff,
    fills_sides: sides,
    exec_price_sources: srcs,
  };
}

const A_PATH = "/tmp/report_A_phase0b_locked.json";
const B_PATH = "/tmp/report_B_head.json";
if (!fs.existsSync(A_PATH) || !fs.existsSync(B_PATH)) {
  console.error("AB reports not found:", { A_PATH, B_PATH });
  process.exit(1);
}

const A = summarize(load(A_PATH));
const B = summarize(load(B_PATH));

const week = isoWeek(new Date());
const out = path.join(process.cwd(), `AB_DIFF_${week}.md`);

let md = `# AB Diff ${week}\n\n`;
md += `- A: phase0b-locked\n- B: HEAD\n\n`;
md += `## Range\n`;
md += `- A: ${A.range.from} ~ ${A.range.to}\n`;
md += `- B: ${B.range.from} ~ ${B.range.to}\n\n`;

md += `## KPI Summary\n`;
md += `| metric | A | B |\n|---|---:|---:|\n`;
for (const k of ["fills_new","sells_new","trades_approx"]) {
  md += `| ${k} | ${A.kpi_summary[k]} | ${B.kpi_summary[k]} |\n`;
}
md += `\n`;

md += `## Coverage\n`;
md += `| item | A | B |\n|---|---:|---:|\n`;
md += `| missing_markets_count | ${A.missing_markets.length} | ${B.missing_markets.length} |\n`;
md += `| fills_len | ${A.fills_len} | ${B.fills_len} |\n`;
md += `| bar_close_ms_diff | ${A.bar_close_ms_diff} | ${B.bar_close_ms_diff} |\n\n`;

md += `## Details\n`;
md += `### A missing markets\n\`\`\`json\n${JSON.stringify(A.missing_markets, null, 2)}\n\`\`\`\n\n`;
md += `### B missing markets\n\`\`\`json\n${JSON.stringify(B.missing_markets, null, 2)}\n\`\`\`\n\n`;

md += `### A exec_price_sources / sides\n\`\`\`json\n${JSON.stringify({ exec_price_sources: A.exec_price_sources, fills_sides: A.fills_sides }, null, 2)}\n\`\`\`\n\n`;
md += `### B exec_price_sources / sides\n\`\`\`json\n${JSON.stringify({ exec_price_sources: B.exec_price_sources, fills_sides: B.fills_sides }, null, 2)}\n\`\`\`\n\n`;

fs.writeFileSync(out, md, "utf8");
console.log(`[OK] generated ${out}`);
