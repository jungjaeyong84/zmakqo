#!/usr/bin/env node
"use strict";

// scripts/audit-tdz-traps.js
//
// Static audit for "use-before-let/const-in-the-same-function" — the class
// of bug behind the 2026-04-20 ETHUSDT incident (`posMeta: nextMeta` ran
// ~300 lines BEFORE its `let nextMeta = …` declaration in the same
// for-iteration block, throwing "Cannot access 'nextMeta' before
// initialization" and dropping every live entry webhook).
//
// What it does
// ------------
// For each top-level `function NAME(…)` or `async function NAME(…)` in a
// source file, it scans the function body and reports every `let X = …` or
// `const X = …` whose identifier X is also referenced on a line ABOVE the
// declaration line, within the same function body. JavaScript hoists a TDZ
// binding for `let`/`const` to the start of the enclosing block, so those
// references throw at runtime the moment the code path executes.
//
// Why a hand-rolled scanner (no AST)
// ----------------------------------
// The repo has no eslint / acorn / babel today. Adding one is a bigger PR
// than this audit warrants — it would force config + CI + reckoning with
// pre-existing patterns across hundreds of files. This scanner is a deli-
// berate "good-enough" pass tuned for the specific bug class: identifier
// references that show up textually above the declaration. It is brace-
// aware enough to skip inner-function decls (they don't shadow outer scope
// in the dangerous way), and comment/string-aware so it doesn't flag
// patterns embedded in literals or doc-comments. False positives are
// expected and meant to be reviewed by hand. False negatives are accepted
// for inside-callback declarations that would not hit this audit window.
//
// What it does NOT do
// -------------------
//   - Does not parse JS. Operates on text with brace + comment + string
//     tracking only.
//   - Does not understand IIFEs, arrow functions, class methods, or object
//     shorthand method bodies as top-level "functions". Those are scoped
//     differently and the heuristic skips them.
//   - Does not check `var` (those hoist and don't TDZ).
//
// Usage
// -----
//   node scripts/audit-tdz-traps.js [path ...]
//
// With no args, audits every .js under src/. Exit code is the count of
// findings (0 = clean).

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");

// -------------------------------------------------------------------------
// stripCommentsAndStrings(source)
//
// Replace the *contents* of string/template/regex literals and comments
// with same-length blank stand-ins so brace-counting + identifier-matching
// don't get fooled by literals containing braces or keywords. Line numbers
// and column offsets are preserved exactly — this matters for accurate
// reporting.
// -------------------------------------------------------------------------
function stripCommentsAndStrings(src) {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  const blank = (start, end) => {
    for (let k = start; k < end && k < n; k += 1) {
      if (out[k] !== "\n") out[k] = " ";
    }
  };
  while (i < n) {
    const c = src[i];
    const c1 = src[i + 1];
    // Line comment
    if (c === "/" && c1 === "/") {
      let j = i + 2;
      while (j < n && src[j] !== "\n") j += 1;
      blank(i, j);
      i = j;
      continue;
    }
    // Block comment
    if (c === "/" && c1 === "*") {
      let j = i + 2;
      while (j < n - 1 && !(src[j] === "*" && src[j + 1] === "/")) j += 1;
      const endIdx = Math.min(n, j + 2);
      blank(i, endIdx);
      i = endIdx;
      continue;
    }
    // String literals: ", ', `
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === quote) { j += 1; break; }
        if (quote === "`" && src[j] === "$" && src[j + 1] === "{") {
          // Template substitution — leave the inside intact so braces still
          // balance, but blank the leading `${`.
          out[j] = " "; out[j + 1] = " ";
          j += 2;
          // Walk through, tracking nested braces inside ${ }.
          let depth = 1;
          while (j < n && depth > 0) {
            if (src[j] === "{") depth += 1;
            else if (src[j] === "}") depth -= 1;
            j += 1;
          }
          continue;
        }
        if (src[j] === "\n" && quote !== "`") {
          // Unterminated string on a line — bail to avoid infinite loop.
          break;
        }
        j += 1;
      }
      // Blank the literal *contents* (between the quotes), keep quotes intact
      // so brace counters are unaffected.
      for (let k = i + 1; k < j - 1 && k < n; k += 1) {
        if (out[k] !== "\n") out[k] = " ";
      }
      i = j;
      continue;
    }
    i += 1;
  }
  return out.join("");
}

// -------------------------------------------------------------------------
// findTopLevelFunctions(stripped)
//
// Yields { name, startLine, endLine } for each top-level function declar-
// ation at column 0 of the file (= brace depth 0 at the `function` token).
// `endLine` is the line of the closing `}` that brings depth back to 0.
// -------------------------------------------------------------------------
function findTopLevelFunctions(stripped) {
  const out = [];
  const lines = stripped.split("\n");
  let depth = 0;
  let openFn = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (depth === 0 && openFn === null) {
      const m = line.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
      if (m) openFn = { name: m[1], startLine: i };
    }
    for (let k = 0; k < line.length; k += 1) {
      const ch = line[k];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0 && openFn !== null) {
          out.push({ name: openFn.name, startLine: openFn.startLine, endLine: i });
          openFn = null;
        }
      }
    }
  }
  return out;
}

// -------------------------------------------------------------------------
// buildBlockTree(stripped, fn)
//
// Walk the function body and build a nested tree of `{…}` blocks. Each
// block records its own `let`/`const` decls (skipping for-of/for-in/C-for
// init-declarations, which are scoped to the for-statement only) and its
// children. This lets `findUsesAbove` precisely identify sub-blocks that
// re-declare the same identifier ("shadows") and skip their interior, which
// was the dominant false-positive class in the first audit pass.
//
// Returns the root block: { openLine, closeLine, depth, parent, decls,
// children }.
// -------------------------------------------------------------------------
function buildBlockTree(stripped, fn) {
  const lines = stripped.split("\n");
  const root = {
    openLine: fn.startLine,
    closeLine: fn.endLine,
    depth: 0,
    parent: null,
    decls: [],
    children: [],
  };
  let current = root;
  let depth = 0;
  for (let i = fn.startLine; i <= fn.endLine; i += 1) {
    const line = lines[i];
    // Collect decls AT the start-of-line depth, attributing them to the
    // currently-open block. (Assumes one statement per line; an `if (x) {
    // const y = 1; }` written all on one line would mis-attribute the
    // decl to the outer block, but the codebase doesn't use that style.)
    const declRe = /\b(?:let|const)\s+([A-Za-z_$][\w$]*)/g;
    let m;
    while ((m = declRe.exec(line)) !== null) {
      const head = line.slice(0, m.index).trimEnd();
      if (/\bfor\s*\($/.test(head)) continue;
      current.decls.push({ name: m[1], line: i, depth });
    }
    for (let k = 0; k < line.length; k += 1) {
      if (line[k] === "{") {
        depth += 1;
        const child = {
          openLine: i,
          closeLine: -1,
          depth,
          parent: current,
          decls: [],
          children: [],
        };
        current.children.push(child);
        current = child;
      } else if (line[k] === "}") {
        if (current.parent !== null) {
          current.closeLine = i;
          current = current.parent;
        }
        depth -= 1;
      }
    }
  }
  return root;
}

// -------------------------------------------------------------------------
// findInnerShadowRanges(block, name)
//
// For an enclosing `block`, walk its descendants and collect line ranges of
// every sub-block that declares `name` itself. Once a shadow block is found
// we do NOT recurse into it — the entire sub-block is excluded from the
// outer-decl's TDZ scan, since the inner binding correctly takes over from
// its declaration line onward, and references above the inner decl within
// the same inner block are TDZ-issues of the INNER binding (and would be
// flagged when we audit the inner decl independently).
// -------------------------------------------------------------------------
function findInnerShadowRanges(block, name) {
  const ranges = [];
  const walk = (b) => {
    for (const child of b.children) {
      const declared = child.decls.some((d) => d.name === name);
      if (declared) {
        ranges.push({ openLine: child.openLine, closeLine: child.closeLine });
      } else {
        walk(child);
      }
    }
  };
  walk(block);
  return ranges;
}

// -------------------------------------------------------------------------
// flattenDecls(block) — yields every decl in the tree, paired with its
// enclosing block, so the audit can call findUsesAbove on each one.
// -------------------------------------------------------------------------
function* flattenDecls(block) {
  for (const decl of block.decls) yield { decl, block };
  for (const child of block.children) yield* flattenDecls(child);
}

// -------------------------------------------------------------------------
// findUsesAbove(stripped, fn, decl)
//
// Search lines [fn.startLine, decl.line-1] for a `\bdecl.name\b` reference
// that is at the SAME function — i.e. the line is in the function body.
// To reduce false-positives from nested function bodies that have their
// own binding for `name`, we compute the brace depth at each candidate
// line; if the candidate line lies inside a deeper nested function body
// (a `function` declared between fn.startLine and the candidate line that
// is still open at the candidate line), we skip it.
//
// For this audit we conservatively flag the simple case only: candidate
// line's brace depth (from fn.startLine = 0) ≤ decl.depth. This catches
// the original bug while skipping callbacks that introduce their own
// scope. False negatives are accepted.
// -------------------------------------------------------------------------
function findUsesAbove(stripped, decl, declBlock) {
  const lines = stripped.split("\n");
  const wordRe = new RegExp(`(?<![.\\w])${decl.name}\\b`);
  const shadowRanges = findInnerShadowRanges(declBlock, decl.name);
  const inShadow = (i) => shadowRanges.some(
    (r) => i >= r.openLine && (r.closeLine < 0 || i <= r.closeLine)
  );
  const uses = [];
  // Scan the block from the line AFTER the opening brace up to the line
  // BEFORE the decl itself.
  for (let i = declBlock.openLine + 1; i < decl.line; i += 1) {
    if (inShadow(i)) continue;
    const line = lines[i];
    if (!wordRe.test(line)) continue;
    if (isOnlyObjectKey(line, decl.name)) continue;
    if (new RegExp(`\\b(?:let|const|var)\\s+${decl.name}\\b`).test(line)) continue;
    uses.push(i);
  }
  return uses;
}

// `name:` immediately followed by a colon, NOT preceded by `?` (ternary) or
// a label-friendly opening — heuristic for "this `name` is just a key in an
// object literal". Returns true only if EVERY \bname\b occurrence on the
// line is of that key form. Conservative on purpose: a single non-key
// occurrence keeps the line flagged.
function isOnlyObjectKey(line, name) {
  const re = new RegExp(`(?<![.\\w])${name}\\b([^A-Za-z0-9_]?)`, "g");
  let m;
  let seen = 0;
  let keyish = 0;
  while ((m = re.exec(line)) !== null) {
    seen += 1;
    // What follows the identifier?
    const tail = line.slice(m.index + name.length);
    const trimmed = tail.replace(/^\s+/, "");
    if (trimmed.startsWith(":") && !trimmed.startsWith("::")) {
      // Look back for `?` (ternary) — if present this isn't a key.
      const head = line.slice(0, m.index).replace(/\s+$/, "");
      if (!head.endsWith("?")) keyish += 1;
    }
  }
  return seen > 0 && seen === keyish;
}

// -------------------------------------------------------------------------
// auditFile(filePath)
// -------------------------------------------------------------------------
function auditFile(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const stripped = stripCommentsAndStrings(source);
  const fns = findTopLevelFunctions(stripped);
  const findings = [];
  for (const fn of fns) {
    const root = buildBlockTree(stripped, fn);
    for (const { decl, block } of flattenDecls(root)) {
      const uses = findUsesAbove(stripped, decl, block);
      if (uses.length > 0) {
        findings.push({
          file: filePath,
          fn: fn.name,
          fnStartLine: fn.startLine + 1,
          var: decl.name,
          declLine: decl.line + 1,
          useLines: uses.map((u) => u + 1),
        });
      }
    }
  }
  return findings;
}

// -------------------------------------------------------------------------
// walk(dir) — yield every .js file under dir, skipping node_modules etc.
// -------------------------------------------------------------------------
function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && entry.name.endsWith(".js")) yield full;
  }
}

// -------------------------------------------------------------------------
// main()
// -------------------------------------------------------------------------
function main() {
  const argv = process.argv.slice(2);
  const targets = argv.length > 0
    ? argv.map((p) => path.resolve(p))
    : [path.join(REPO_ROOT, "src")];

  const all = [];
  for (const target of targets) {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      for (const file of walk(target)) all.push(...auditFile(file));
    } else {
      all.push(...auditFile(target));
    }
  }

  if (all.length === 0) {
    process.stdout.write("TDZ_AUDIT_OK no use-before-let/const findings\n");
    process.exit(0);
  }

  // Group by file for readable output.
  const byFile = new Map();
  for (const f of all) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }

  process.stdout.write(`TDZ_AUDIT_FINDINGS ${all.length} total across ${byFile.size} file(s)\n`);
  for (const [file, findings] of byFile) {
    const rel = path.relative(REPO_ROOT, file);
    process.stdout.write(`\n${rel}:\n`);
    for (const f of findings) {
      process.stdout.write(
        `  fn=${f.fn} (L${f.fnStartLine}) ` +
        `var=${f.var} decl=L${f.declLine} uses=[${f.useLines.join(",")}]\n`
      );
    }
  }
  process.exit(all.length);
}

main();
