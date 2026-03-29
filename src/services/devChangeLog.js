const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { getFirestore } = require("../storage/firestore");

const DEV_CHANGE_COLLECTION = "dev_change_log";
const DEV_CHANGE_STATE_DOC = "dev_change_log_state";
const STATE_COLLECTION = "settings";
const SNAPSHOT_LIMIT = 2000;
const CHANGE_LIST_LIMIT = 200;

const DEFAULT_ROOTS = [
  "src",
  "config",
  "ops",
  "scripts",
  "public",
  "code",
  "docs",
];

const ROOT_FILES = [
  "server.js",
  "package.json",
  "package-lock.json",
  "cloudbuild.yaml",
  "README.md",
  "README_APPLY.md",
  "README_APPLY_GATE_V022.md",
  "MASTER_PROMPT.md",
  "MASTER_PROMPT_CHANGELOG.md",
  "ARCHITECTURE_AND_OPS_PHASE0.md",
  "PATCH_PROPOSAL_2025W52.md",
  "AB_DIFF_2025W52.md",
  "param_sets.json",
];

const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  ".cache",
  ".next",
  "dist",
  "build",
  "tmp",
  ".claude",
]);

const EXCLUDE_FILES = new Set([
  ".env",
  ".DS_Store",
  "server.log",
  "server.js.bak",
]);

function safeString(v, max = 500) {
  const s = String(v || "").trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "..." : s;
}

function normalizeArray(v, limit = 200) {
  if (!Array.isArray(v)) return [];
  if (v.length <= limit) return v;
  return v.slice(0, limit);
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function shouldExcludeRel(rel) {
  const posix = toPosix(rel);
  if (!posix) return true;
  const parts = posix.split("/");
  if (parts.some((p) => EXCLUDE_DIRS.has(p))) return true;
  if (EXCLUDE_FILES.has(parts[parts.length - 1])) return true;
  if (posix.endsWith(".log")) return true;
  return false;
}

async function hashFile(fullPath) {
  const buf = await fs.readFile(fullPath);
  const h = crypto.createHash("sha256");
  h.update(buf);
  return h.digest("hex");
}

async function collectDirSnapshot(root, baseDir, out) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    const rel = path.relative(baseDir, fullPath);
    if (shouldExcludeRel(rel)) continue;
    if (entry.isDirectory()) {
      await collectDirSnapshot(fullPath, baseDir, out);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const stat = await fs.stat(fullPath);
      const hash = await hashFile(fullPath);
      out.push({
        path: toPosix(rel),
        hash,
        size: stat.size,
      });
    } catch (_) {}
  }
}

async function collectSnapshot({ roots = DEFAULT_ROOTS, rootFiles = ROOT_FILES } = {}) {
  const baseDir = process.cwd();
  const out = [];

  for (const file of rootFiles) {
    const fullPath = path.join(baseDir, file);
    try {
      const stat = await fs.stat(fullPath);
      if (!stat.isFile()) continue;
      const hash = await hashFile(fullPath);
      out.push({ path: toPosix(file), hash, size: stat.size });
    } catch (_) {}
  }

  for (const root of roots) {
    const fullRoot = path.join(baseDir, root);
    try {
      const stat = await fs.stat(fullRoot);
      if (!stat.isDirectory()) continue;
      await collectDirSnapshot(fullRoot, baseDir, out);
    } catch (_) {}
  }

  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

function calcTreeHash(snapshot) {
  const h = crypto.createHash("sha256");
  for (const item of snapshot) {
    h.update(item.path || "");
    h.update(":");
    h.update(item.hash || "");
    h.update("\n");
  }
  return h.digest("hex");
}

function diffSnapshots(before, after) {
  const beforeMap = new Map();
  for (const item of before || []) {
    if (!item || !item.path) continue;
    beforeMap.set(item.path, item.hash || "");
  }
  const afterMap = new Map();
  for (const item of after || []) {
    if (!item || !item.path) continue;
    afterMap.set(item.path, item.hash || "");
  }

  const added = [];
  const modified = [];
  const deleted = [];

  for (const [p, h] of afterMap.entries()) {
    if (!beforeMap.has(p)) {
      if (added.length < CHANGE_LIST_LIMIT) added.push(p);
      continue;
    }
    if (beforeMap.get(p) !== h) {
      if (modified.length < CHANGE_LIST_LIMIT) modified.push(p);
    }
  }

  for (const [p] of beforeMap.entries()) {
    if (!afterMap.has(p)) {
      if (deleted.length < CHANGE_LIST_LIMIT) deleted.push(p);
    }
  }

  return {
    added,
    modified,
    deleted,
    added_count: added.length,
    modified_count: modified.length,
    deleted_count: deleted.length,
    total_before: beforeMap.size,
    total_after: afterMap.size,
    truncated: {
      added: afterMap.size - beforeMap.size > added.length,
      modified: modified.length === CHANGE_LIST_LIMIT,
      deleted: deleted.length === CHANGE_LIST_LIMIT,
    },
  };
}

async function appendDevChangeLog({ title, summary, source, tags, changes, meta, actor } = {}) {
  const db = getFirestore();
  const createdAt = new Date().toISOString();
  const payload = {
    created_at: createdAt,
    created_by: safeString(actor || "system", 120),
    source: safeString(source || "auto", 80),
    title: safeString(title || "dev change", 200),
    summary: safeString(summary || "", 2000),
    tags: normalizeArray(tags, 100).map((x) => safeString(x, 80)).filter(Boolean),
    changes: normalizeArray(changes, 500),
    meta: (meta && typeof meta === "object") ? meta : {},
  };
  await db.collection(DEV_CHANGE_COLLECTION).add(payload);
  return payload;
}

async function logDeployOnce() {
  const revision = String(process.env.K_REVISION || "").trim();
  if (!revision) return false;

  const db = getFirestore();
  const stateRef = db.collection(STATE_COLLECTION).doc(DEV_CHANGE_STATE_DOC);
  const snap = await stateRef.get();
  const state = snap.exists ? (snap.data() || {}) : {};
  if (state.last_revision === revision) return false;

  const service = String(process.env.K_SERVICE || "").trim();
  const region = String(process.env.K_REGION || "").trim();
  const config = String(process.env.K_CONFIGURATION || "").trim();

  let snapshot = [];
  let treeHash = "";
  let diff = null;
  try {
    snapshot = await collectSnapshot();
    treeHash = calcTreeHash(snapshot);
    if (Array.isArray(state.snapshot)) {
      diff = diffSnapshots(state.snapshot, snapshot);
    }
  } catch (_) {}

  const changeItems = diff ? [
    { type: "added", count: diff.added_count, items: diff.added },
    { type: "modified", count: diff.modified_count, items: diff.modified },
    { type: "deleted", count: diff.deleted_count, items: diff.deleted },
  ] : [];

  const summary = diff
    ? `revision=${revision} added=${diff.added_count} modified=${diff.modified_count} deleted=${diff.deleted_count}`
    : `revision=${revision}`;

  await appendDevChangeLog({
    title: "Cloud Run deploy",
    summary,
    source: "deploy",
    tags: ["deploy"],
    changes: changeItems,
    meta: {
      revision,
      service,
      region,
      configuration: config,
      tree_hash: treeHash || null,
      snapshot_size: snapshot.length || 0,
    },
    actor: "system",
  });

  const statePayload = {
    last_revision: revision,
    last_deploy_at: new Date().toISOString(),
    last_tree_hash: treeHash || null,
  };
  if (snapshot.length && snapshot.length <= SNAPSHOT_LIMIT) {
    statePayload.snapshot = snapshot;
    statePayload.snapshot_truncated = false;
  } else {
    statePayload.snapshot = [];
    statePayload.snapshot_truncated = true;
  }
  await stateRef.set(statePayload, { merge: true });
  return true;
}

module.exports = {
  appendDevChangeLog,
  logDeployOnce,
  collectSnapshot,
  diffSnapshots,
  calcTreeHash,
};
