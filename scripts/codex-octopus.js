#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { callClaude } = require("../src/services/claudeClient");
const { callGemini } = require("../src/services/geminiClient");
const {
  ensureDir,
  loadLocalEnv,
  nowKstMeta,
  writeJson,
  writeText,
  sendKoreanTelegramSummary,
} = require("./lib/automation-utils");

const REPO_ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(REPO_ROOT, "config", "codex_octopus.json");
const RUN_ROOT = path.join(REPO_ROOT, "ops", "daily", "octopus");

loadLocalEnv();

function parseArgs(argv) {
  const out = {
    prompt: "",
    promptFile: "",
    workflow: "",
    title: "",
    notify: false,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--prompt" && argv[i + 1]) out.prompt = String(argv[++i]);
    else if (arg === "--prompt-file" && argv[i + 1]) out.promptFile = String(argv[++i]);
    else if (arg === "--workflow" && argv[i + 1]) out.workflow = String(argv[++i]);
    else if (arg === "--title" && argv[i + 1]) out.title = String(argv[++i]);
    else if (arg === "--notify") out.notify = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (!out.prompt) out.prompt = String(arg);
  }
  return out;
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_err) {
    return fallback;
  }
}

function slugify(value) {
  return String(value || "task")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "task";
}

function readPrompt(args) {
  if (args.promptFile) return fs.readFileSync(path.resolve(REPO_ROOT, args.promptFile), "utf8");
  if (args.prompt) return String(args.prompt);
  return "";
}

function parseLastJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(String(fenced[1]).trim());
    } catch (_err) {
      // continue to generic parsing
    }
  }
  if ((raw.startsWith("{") && raw.endsWith("}")) || (raw.startsWith("[") && raw.endsWith("]"))) {
    try {
      return JSON.parse(raw);
    } catch (_err) {
      // continue
    }
  }
  for (let i = raw.length - 1; i >= 0; i -= 1) {
    if (raw[i] !== "{") continue;
    for (let end = raw.length; end > i; end -= 1) {
      const candidate = raw.slice(i, end).trim();
      if (!candidate.endsWith("}")) continue;
      try {
        return JSON.parse(candidate);
      } catch (_err) {
        // continue
      }
    }
  }
  return null;
}

function interpolate(value, vars) {
  return String(value).replace(/\{(\w+)\}/g, (_m, key) => (vars[key] != null ? String(vars[key]) : ""));
}

function commandExists(cmd) {
  if (!cmd) return false;
  if (cmd.startsWith("/")) return fs.existsSync(cmd);
  const res = spawnSync("/bin/zsh", ["-lc", `command -v ${JSON.stringify(cmd)} >/dev/null 2>&1`], { cwd: REPO_ROOT });
  return res.status === 0;
}

function buildSubPrompt({ providerName, workflow, taskPrompt }) {
  const roleMap = {
    claude: "Architecture and risk reviewer. Find blind spots, contradictions, missing safeguards, and operational risks.",
    gemini: "Ecosystem and edge-case reviewer. Focus on breadth, alternative approaches, dependency or integration risks, and missing context.",
  };
  return [
    `You are the ${providerName} sub-agent in a Codex-led orchestration for DONBEOLJA.`,
    roleMap[providerName] || "Review the task from your assigned perspective.",
    `Workflow: ${workflow}`,
    "Return valid JSON only.",
    "Schema:",
    JSON.stringify({
      provider: providerName,
      workflow,
      verdict: "APPROVE|HOLD|REJECT",
      recommended_patch_id: "patch_id_or_hold",
      confidence: 0.0,
      summary: "short summary",
      findings: ["finding 1"],
      recommendations: ["recommendation 1"],
      assumptions: ["assumption 1"],
    }, null, 2),
    "Task:",
    taskPrompt,
  ].join("\n\n");
}

function buildCodexLeadPrompt({ workflow, taskPrompt, subagentResults }) {
  return [
    "You are Codex, the lead orchestrator for DONBEOLJA.",
    "Your role is to synthesize Claude and Gemini outputs, decide whether there is enough consensus, and produce a final verdict.",
    `Workflow: ${workflow}`,
    "Rules:",
    "- Prefer safety over speed.",
    "- Do not ignore material disagreements.",
    "- If evidence is weak or conflicting, choose HOLD.",
    "Return valid JSON only.",
    "Schema:",
    JSON.stringify({
      workflow,
      overall_verdict: "APPROVE|HOLD|REJECT",
      recommended_patch_id: "patch_id_or_hold",
      consensus_ratio: 0.0,
      summary: "short summary",
      key_findings: ["finding 1"],
      recommended_actions: ["action 1"],
      provider_status: {
        claude: "APPROVE|HOLD|REJECT|UNAVAILABLE",
        gemini: "APPROVE|HOLD|REJECT|UNAVAILABLE",
      },
    }, null, 2),
    "Original task:",
    taskPrompt,
    "Sub-agent results:",
    JSON.stringify(subagentResults, null, 2),
  ].join("\n\n");
}

function resolveEnvValue(keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  for (const key of list) {
    const value = String(process.env[String(key || "")] || "").trim();
    if (value) return value;
  }
  return "";
}

function runProvider({ providerName, providerCfg, prompt, cwd, outputPath, dryRun = false }) {
  const type = String(providerCfg.type || "command").trim() || "command";
  if (type === "claude_api" || type === "gemini_api") {
    throw new Error(`API provider ${providerName} must use runProviderAsync()`);
  }
  const command = String(providerCfg.command || "").trim();
  const available = commandExists(command);
  if (!providerCfg.enabled) {
    return { provider: providerName, ok: false, skipped: true, reason: "DISABLED" };
  }
  if (!available) {
    return { provider: providerName, ok: false, skipped: true, reason: "COMMAND_NOT_FOUND", command };
  }
  if (dryRun) {
    return { provider: providerName, ok: true, dry_run: true, command, parsed: { provider: providerName, verdict: "HOLD", summary: "dry-run" } };
  }

  const vars = { cwd, prompt };
  const args = Array.isArray(providerCfg.args) ? providerCfg.args.map((v) => interpolate(v, vars)) : [];
  const env = { ...process.env };
  if (providerCfg.model) env.CODEX_MODEL = providerCfg.model;
  const res = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 8,
  });
  const stdout = String(res.stdout || "");
  const stderr = String(res.stderr || "");
  ensureDir(path.dirname(outputPath));
  writeText(outputPath, [stdout, stderr ? `\n--- STDERR ---\n${stderr}` : ""].join(""));
  return {
    provider: providerName,
    ok: res.status === 0,
    exit_code: res.status,
    command: `${command} ${args.join(" ")}`,
    parsed: parseLastJsonObject(stdout),
    stdout_tail: stdout.trim().split(/\r?\n/).slice(-20),
    stderr_tail: stderr.trim().split(/\r?\n/).slice(-20),
  };
}

async function runProviderAsync({ providerName, providerCfg, prompt, cwd, outputPath, dryRun = false }) {
  const type = String(providerCfg.type || "command").trim() || "command";
  if (type === "command") {
    return runProvider({ providerName, providerCfg, prompt, cwd, outputPath, dryRun });
  }
  if (!providerCfg.enabled) {
    return { provider: providerName, ok: false, skipped: true, reason: "DISABLED" };
  }
  if (dryRun) {
    const dry = { provider: providerName, ok: true, dry_run: true, parsed: { provider: providerName, verdict: "HOLD", recommended_patch_id: "hold", summary: "dry-run" } };
    writeJson(outputPath.replace(/\.log$/, ".json"), dry);
    writeText(outputPath, JSON.stringify(dry, null, 2));
    return dry;
  }

  if (type === "claude_api") {
    const apiKey = resolveEnvValue(providerCfg.api_key_env || ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"]);
    if (!apiKey) {
      const res = { provider: providerName, ok: false, skipped: true, reason: "NO_API_KEY" };
      writeText(outputPath, JSON.stringify(res, null, 2));
      return res;
    }
    const system = [
      "You are Claude, a sub-agent in a Codex-led orchestration for DONBEOLJA.",
      "Return valid JSON only.",
    ].join("\n");
    const result = await callClaude({
      apiKey,
      model: providerCfg.model,
      system,
      prompt,
      temperature: providerCfg.temperature,
      maxTokens: providerCfg.max_tokens,
      cacheSystem: providerCfg.cache_system === true,
    });
    writeText(outputPath, JSON.stringify(result.raw || result, null, 2));
    return {
      provider: providerName,
      ok: !!result.ok,
      reason: result.ok ? null : result.reason,
      model: providerCfg.model,
      parsed: parseLastJsonObject(result.text || ""),
      raw_text_tail: String(result.text || "").trim().split(/\r?\n/).slice(-20),
    };
  }

  if (type === "gemini_api") {
    const apiKey = resolveEnvValue(providerCfg.api_key_env || ["GEMINI_API_KEY", "GOOGLE_API_KEY"]);
    if (!apiKey) {
      const res = { provider: providerName, ok: false, skipped: true, reason: "NO_API_KEY" };
      writeText(outputPath, JSON.stringify(res, null, 2));
      return res;
    }
    const result = await callGemini({
      apiKey,
      model: providerCfg.model,
      system: "You are Gemini, a sub-agent in a Codex-led orchestration for DONBEOLJA. Return valid JSON only.",
      prompt,
      temperature: providerCfg.temperature,
      maxTokens: providerCfg.max_tokens,
      retryMax: providerCfg.retry_max,
      retryBaseMs: providerCfg.retry_base_ms,
    });
    writeText(outputPath, JSON.stringify(result.raw || result, null, 2));
    return {
      provider: providerName,
      ok: !!result.ok,
      reason: result.ok ? null : result.reason,
      model: providerCfg.model,
      parsed: parseLastJsonObject(result.text || ""),
      raw_text_tail: String(result.text || "").trim().split(/\r?\n/).slice(-20),
    };
  }

  const res = { provider: providerName, ok: false, skipped: true, reason: `UNSUPPORTED_TYPE:${type}` };
  writeText(outputPath, JSON.stringify(res, null, 2));
  return res;
}

function countApprovals(results) {
  const available = results.filter((r) => r && r.parsed && typeof r.parsed === "object");
  const approvals = available.filter((r) => String(r.parsed.verdict || "").toUpperCase() === "APPROVE");
  return {
    available: available.length,
    approvals: approvals.length,
    ratio: available.length ? approvals.length / available.length : 0,
  };
}

function renderMarkdown(summary) {
  const lines = [];
  lines.push(`# Codex Octopus Run`);
  lines.push("");
  lines.push(`- Generated: ${summary.generated_at_kst}`);
  lines.push(`- Workflow: ${summary.workflow}`);
  lines.push(`- Overall verdict: ${summary.overall_verdict}`);
  lines.push(`- Consensus ratio: ${summary.consensus_ratio}`);
  lines.push("");
  lines.push(`## Summary`);
  lines.push(summary.summary || "N/A");
  lines.push("");
  lines.push(`## Provider Status`);
  for (const row of summary.providers || []) {
    lines.push(`- ${row.provider}: ${row.status}${row.reason ? ` (${row.reason})` : ""}`);
  }
  lines.push("");
  lines.push(`## Recommended Actions`);
  for (const action of summary.recommended_actions || []) lines.push(`- ${action}`);
  return `${lines.join("\n")}\n`;
}

async function maybeNotify(summary, runDir, enabled) {
  if (!enabled) return { ok: false, skipped: true, reason: "NOTIFY_OFF" };
  return sendKoreanTelegramSummary({
    title: `Codex 종합 검토/${summary.workflow}`,
    severity: summary.overall_verdict === "APPROVE" ? "INFO" : "WARN",
    sections: [
      {
        header: "최종 결론",
        lines: [
          `최종 판단 ${summary.overall_verdict}`,
          `합의율 ${summary.consensus_ratio}`,
          summary.summary,
        ],
      },
      {
        header: "서브 상태",
        lines: (summary.providers || []).map((row) => `${row.provider}: ${row.status}${row.reason ? ` (${row.reason})` : ""}`),
      },
      {
        header: "산출물",
        lines: [
          path.join(runDir, "summary.json"),
          path.join(runDir, "summary.md"),
        ],
      },
    ],
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const taskPrompt = readPrompt(args).trim();
  if (!taskPrompt) {
    console.error("Prompt is required. Use --prompt or --prompt-file.");
    process.exit(1);
  }

  const cfg = readJson(CONFIG_PATH, {});
  const meta = nowKstMeta();
  const workflow = String(args.workflow || cfg.default_workflow || "general").trim() || "general";
  const title = String(args.title || taskPrompt.split(/\r?\n/)[0] || workflow).trim();
  const runDir = path.join(RUN_ROOT, `${meta.dateKey}_${meta.hhmm}_${slugify(title)}`);
  ensureDir(runDir);
  writeText(path.join(runDir, "task.md"), `${taskPrompt}\n`);

  const subProviders = ["claude", "gemini"];
  const subResults = [];
  for (const providerName of subProviders) {
    const providerCfg = (((cfg || {}).providers || {})[providerName]) || {};
    const providerPrompt = buildSubPrompt({ providerName, workflow, taskPrompt });
    const res = await runProviderAsync({
      providerName,
      providerCfg,
      prompt: providerPrompt,
      cwd: REPO_ROOT,
      outputPath: path.join(runDir, `${providerName}.log`),
      dryRun: args.dryRun,
    });
    writeJson(path.join(runDir, `${providerName}.json`), res);
    subResults.push(res);
  }

  const consensus = countApprovals(subResults);
  const minAvailable = Number((((cfg || {}).consensus || {}).min_available_subagents) || 1);
  const approveRatio = Number((((cfg || {}).consensus || {}).approve_ratio) || 0.75);
  const providerStatus = Object.fromEntries(subResults.map((row) => {
    const status = row.parsed && row.parsed.verdict
      ? String(row.parsed.verdict).toUpperCase()
      : (row.skipped ? "UNAVAILABLE" : "FAILED");
    return [row.provider, status];
  }));

  const leadPrompt = buildCodexLeadPrompt({ workflow, taskPrompt, subagentResults: subResults.map((r) => ({ provider: r.provider, parsed: r.parsed || null, reason: r.reason || null, ok: !!r.ok })) });
  const codexProviderCfg = (((cfg || {}).providers || {}).codex) || {};
  const leadResult = runProvider({
    providerName: "codex",
    providerCfg: {
      ...codexProviderCfg,
      args: [
        ...(Array.isArray(codexProviderCfg.args) ? codexProviderCfg.args : []),
        leadPrompt,
      ],
    },
    prompt: leadPrompt,
    cwd: REPO_ROOT,
    outputPath: path.join(runDir, "codex.log"),
    dryRun: args.dryRun,
  });
  writeJson(path.join(runDir, "codex.json"), leadResult);

  const codexParsed = (leadResult.parsed && typeof leadResult.parsed === "object") ? leadResult.parsed : {};
  const fallbackVerdict = (consensus.available >= minAvailable && consensus.ratio >= approveRatio) ? "APPROVE" : "HOLD";
  const summary = {
    generated_at_iso: new Date().toISOString(),
    generated_at_kst: meta.kst,
    workflow,
    title,
    overall_verdict: String(codexParsed.overall_verdict || fallbackVerdict).toUpperCase(),
    recommended_patch_id: String(codexParsed.recommended_patch_id || "hold").trim() || "hold",
    consensus_ratio: Number.isFinite(Number(codexParsed.consensus_ratio)) ? Number(codexParsed.consensus_ratio) : Number(consensus.ratio.toFixed(2)),
    summary: String(codexParsed.summary || "Codex synthesis unavailable; fallback applied.").trim(),
    key_findings: Array.isArray(codexParsed.key_findings) ? codexParsed.key_findings : [],
    recommended_actions: Array.isArray(codexParsed.recommended_actions) ? codexParsed.recommended_actions : [],
    providers: subResults.map((row) => ({
      provider: row.provider,
      status: providerStatus[row.provider],
      reason: row.reason || null,
      confidence: row.parsed && row.parsed.confidence != null ? row.parsed.confidence : null,
      summary: row.parsed && row.parsed.summary ? row.parsed.summary : null,
    })),
    codex: {
      ok: !!leadResult.ok,
      parsed: codexParsed,
    },
    paths: {
      run_dir: runDir,
      task: path.join(runDir, "task.md"),
      summary_json: path.join(runDir, "summary.json"),
      summary_md: path.join(runDir, "summary.md"),
    },
  };

  writeJson(path.join(runDir, "summary.json"), summary);
  writeText(path.join(runDir, "summary.md"), renderMarkdown(summary));
  const alertResult = await maybeNotify(summary, runDir, args.notify);
  summary.alert = alertResult;
  writeJson(path.join(runDir, "summary.json"), summary);

  console.log(JSON.stringify({
    ok: true,
    overall_verdict: summary.overall_verdict,
    consensus_ratio: summary.consensus_ratio,
    run_dir: runDir,
    summary_json: path.join(runDir, "summary.json"),
    summary_md: path.join(runDir, "summary.md"),
    alert_ok: !!(alertResult && alertResult.ok),
  }, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
