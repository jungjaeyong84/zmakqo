const { execSync } = require("child_process");
const { getFirestore } = require("../src/storage/firestore");
const {
  appendDevChangeLog,
  collectSnapshot,
  diffSnapshots,
  calcTreeHash,
} = require("../src/services/devChangeLog");

const STATE_COLLECTION = "settings";
const STATE_DOC = "dev_change_log_state";

function run(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

function isGitRepo() {
  try {
    const out = run("git rev-parse --is-inside-work-tree");
    return out === "true";
  } catch (_) {
    return false;
  }
}

function parseNameStatus(output) {
  if (!output) return [];
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      const code = parts[0];
      if (code.startsWith("R")) {
        return { type: "rename", from: parts[1], to: parts[2], score: code };
      }
      return { type: code, path: parts[1] };
    });
}

function classifyChanges(items) {
  const out = { added: [], modified: [], deleted: [], renamed: [] };
  for (const it of items) {
    if (!it) continue;
    if (it.type === "A") out.added.push(it.path);
    else if (it.type === "M") out.modified.push(it.path);
    else if (it.type === "D") out.deleted.push(it.path);
    else if (it.type === "rename") out.renamed.push({ from: it.from, to: it.to, score: it.score });
  }
  return out;
}

async function logSnapshotDiff({ db, stateRef, state }) {
  const snapshot = await collectSnapshot();
  const treeHash = calcTreeHash(snapshot);
  const prevSnapshot = Array.isArray(state.snapshot) ? state.snapshot : [];
  const diff = diffSnapshots(prevSnapshot, snapshot);
  if (!diff || (!diff.added_count && !diff.modified_count && !diff.deleted_count)) {
    await stateRef.set(
      {
        last_tree_hash: treeHash,
        snapshot,
        snapshot_truncated: snapshot.length > 2000,
        last_snapshot_at: new Date().toISOString(),
      },
      { merge: true }
    );
    console.log("[DEV_CHANGE_LOG] no changes detected");
    return;
  }

  const createdBy = (process.env.USER || process.env.USERNAME || "auto").slice(0, 120);
  await appendDevChangeLog({
    title: "dev change (snapshot)",
    summary: `added=${diff.added_count} modified=${diff.modified_count} deleted=${diff.deleted_count}`,
    source: "snapshot",
    tags: ["snapshot"],
    changes: [
      { type: "added", count: diff.added_count, items: diff.added },
      { type: "modified", count: diff.modified_count, items: diff.modified },
      { type: "deleted", count: diff.deleted_count, items: diff.deleted },
    ],
    meta: {
      tree_hash: treeHash,
      total_before: diff.total_before,
      total_after: diff.total_after,
      truncated: diff.truncated,
    },
    actor: createdBy,
  });

  await stateRef.set(
    {
      last_tree_hash: treeHash,
      snapshot,
      snapshot_truncated: snapshot.length > 2000,
      last_snapshot_at: new Date().toISOString(),
    },
    { merge: true }
  );
  console.log("[DEV_CHANGE_LOG] recorded snapshot diff");
}

async function main() {
  const db = getFirestore();
  const stateRef = db.collection(STATE_COLLECTION).doc(STATE_DOC);
  const stateSnap = await stateRef.get();
  const state = stateSnap.exists ? (stateSnap.data() || {}) : {};

  if (!isGitRepo()) {
    await logSnapshotDiff({ db, stateRef, state });
    return;
  }

  const head = run("git rev-parse HEAD");
  const base = state.last_commit && state.last_commit !== head
    ? state.last_commit
    : run("git rev-parse HEAD~1");

  const diffRaw = run(`git diff --name-status ${base}..${head}`);
  const changesRaw = parseNameStatus(diffRaw);
  if (!changesRaw.length) {
    console.log("[DEV_CHANGE_LOG] no changes detected");
    return;
  }

  const counts = classifyChanges(changesRaw);
  const title = `dev change ${head.slice(0, 7)}`;
  const summary = run("git log -1 --pretty=%s");
  const createdAt = new Date().toISOString();
  const createdBy = (process.env.USER || process.env.USERNAME || "auto").slice(0, 120);

  await appendDevChangeLog({
    title,
    summary,
    source: "git",
    tags: ["git"],
    changes: counts,
    meta: {
      base_commit: base,
      head_commit: head,
      changed_files: changesRaw.length,
    },
    actor: createdBy,
  });

  await stateRef.set(
    {
      last_commit: head,
      last_commit_at: createdAt,
    },
    { merge: true }
  );

  console.log("[DEV_CHANGE_LOG] recorded git diff", {
    base,
    head,
    files: changesRaw.length,
  });
}

main().catch((e) => {
  console.error("[DEV_CHANGE_LOG] failed", e && e.message ? e.message : String(e));
  process.exitCode = 1;
});
