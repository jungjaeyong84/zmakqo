/**
 * Generate weekly PATCH_PROPOSAL markdown from patch candidates
 * Inputs:
 *  - /tmp/donbeolja_patch_candidates.json
 * Output:
 *  - ./PATCH_PROPOSAL_YYYYWW.md
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

const CANDIDATES = "/tmp/donbeolja_patch_candidates.json";
if (!fs.existsSync(CANDIDATES)) {
  console.error("patch_candidates.json not found");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(CANDIDATES, "utf8"));
const week = isoWeek(new Date());
const out = path.join(process.cwd(), `PATCH_PROPOSAL_${week}.md`);

let md = `# Patch Proposal ${week}\n\n`;
md += `Generated at: ${data.generated_at}\n\n`;
md += `## Summary\n`;
md += `- Candidates: ${data.candidates.length}\n`;
md += `- Range: ${data.range.from} ~ ${data.range.to}\n\n`;

for (const c of data.candidates) {
  md += `---\n`;
  md += `## ${c.trigger_id}\n\n`;
  md += `**Hypothesis**\n\n${c.hypothesis}\n\n`;
  md += `**Evidence**\n\`\`\`json\n${JSON.stringify(c.evidence, null, 2)}\n\`\`\`\n\n`;
  md += `**Proposed Patch**\n\n- ${c.proposed_patch}\n\n`;
  md += `**Rollback Condition**\n\n- ${c.rollback_condition}\n\n`;
}

fs.writeFileSync(out, md, "utf8");
console.log(`[OK] generated ${out}`);
