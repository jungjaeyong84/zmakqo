"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  registerHypothesis,
  recordOutcome,
  listHypotheses,
  validateRegistry,
  readRegistry,
  entryHash,
} = require("../research/hypothesisRegistry");

function tmpRegistry() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hypreg-"));
  return path.join(dir, "hypotheses.json");
}

const NOW = new Date("2026-09-13T00:00:00.000Z");

// The core invariant: a confirmation window cannot open before the moment the
// hypothesis was written down. Without this, any past window can be claimed
// after the fact and "out-of-sample" means nothing.
{
  const registryPath = tmpRegistry();
  assert.throws(
    () => registerHypothesis({
      registryPath,
      id: "backdated",
      title: "window opened last quarter",
      confirmationStartsAt: "2026-06-01T00:00:00.000Z",
      now: NOW,
    }),
    /BACKDATED_WINDOW/,
    "(A1) a window starting before registration must be refused"
  );
  assert.strictEqual(readRegistry(registryPath).hypotheses.length, 0, "(A2) nothing is written on refusal");
}

// A window opening now or later is fine.
{
  const registryPath = tmpRegistry();
  const res = registerHypothesis({
    registryPath,
    id: "xs-reversal",
    title: "횡단면 역추세",
    rationale: "8/19 지표가 유의한 음의 횡단면 IC",
    discoveredOn: "2026-09-13T00:00:00.000Z",
    confirmationStartsAt: "2026-09-13T00:00:00.000Z",
    now: NOW,
  });
  assert.strictEqual(res.registered, true, "(B1) a window opening now is accepted");
  assert.ok(res.entry.hash, "(B2) entry carries a hash over its immutable fields");
  assert.strictEqual(res.entry.gate.requires_static_benchmark, true, "(B3) the benchmark gate is on by default");
}

// Re-running the same registration is idempotent; changing an immutable field is not.
{
  const registryPath = tmpRegistry();
  const args = {
    registryPath,
    id: "dup",
    title: "t",
    confirmationStartsAt: "2026-10-01T00:00:00.000Z",
    now: NOW,
  };
  registerHypothesis(args);
  const again = registerHypothesis(args);
  assert.strictEqual(again.registered, false, "(C1) identical re-registration is a no-op");
  assert.strictEqual(again.unchanged, true, "(C2) and is reported as unchanged");

  assert.throws(
    () => registerHypothesis({ ...args, confirmationStartsAt: "2026-12-01T00:00:00.000Z" }),
    /IMMUTABLE_FIELD_CHANGED/,
    "(C3) moving the window after the fact must throw"
  );
  assert.strictEqual(readRegistry(registryPath).hypotheses.length, 1, "(C4) no duplicate row is appended");
}

// An outcome cannot be recorded while the window is still in the future —
// this is what stops a result being declared on the data that produced it.
{
  const registryPath = tmpRegistry();
  registerHypothesis({
    registryPath,
    id: "future",
    title: "not yet",
    confirmationStartsAt: "2026-12-01T00:00:00.000Z",
    now: NOW,
  });
  assert.throws(
    () => recordOutcome({ registryPath, id: "future", outcome: "CONFIRMED", now: NOW }),
    /WINDOW_NOT_OPEN/,
    "(D1) declaring success before the window opens must throw"
  );
  assert.throws(
    () => recordOutcome({ registryPath, id: "future", outcome: "INCONCLUSIVE", now: NOW }),
    /WINDOW_NOT_OPEN/,
    "(D1b) so must an early INCONCLUSIVE — it is a claim about a window that has not run"
  );

  // Rejection is the asymmetric case: a hypothesis that already fails on its
  // own discovery data will not start working out of sample. The README stated
  // this asymmetry from the start; the first version of the module did not
  // implement it and blocked rejection too.
  {
    const early = recordOutcome({
      registryPath,
      id: "future",
      outcome: "REJECTED",
      evidence: "quintile profile non-monotonic; tail spread sign opposes the IC",
      now: NOW,
    });
    assert.strictEqual(early.outcome.verdict, "REJECTED", "(D1c) early rejection is allowed");
    assert.strictEqual(early.outcome.in_sample, true, "(D1d) and is stamped as an in-sample rejection");
  }
  assert.throws(
    () => recordOutcome({ registryPath, id: "future", outcome: "REJECTED", evidence: "  ", now: NOW }),
    /EARLY_REJECTION_NEEDS_EVIDENCE/,
    "(D1e) an early rejection without evidence is refused"
  );

  const later = new Date("2026-12-02T00:00:00.000Z");
  const entry = recordOutcome({ registryPath, id: "future", outcome: "REJECTED", evidence: "gate FAIL_BENCHMARK", now: later });
  assert.strictEqual(entry.outcome.verdict, "REJECTED", "(D2) once open, an outcome records");
  assert.ok(entry.outcome.recorded_at, "(D3) with the time it was recorded");

  assert.throws(
    () => recordOutcome({ registryPath, id: "future", outcome: "MAYBE", now: later }),
    /BAD_OUTCOME/,
    "(D4) only the defined verdicts are accepted"
  );
  assert.throws(
    () => recordOutcome({ registryPath, id: "nope", outcome: "REJECTED", now: later }),
    /UNKNOWN_ID/,
    "(D5) an unknown id throws rather than creating a row"
  );
}

// Hand-editing the JSON must be detectable.
{
  const registryPath = tmpRegistry();
  registerHypothesis({
    registryPath,
    id: "tamper",
    title: "original",
    confirmationStartsAt: "2026-11-01T00:00:00.000Z",
    now: NOW,
  });
  assert.strictEqual(validateRegistry({ registryPath }).ok, true, "(E1) a freshly written registry validates");

  const doc = readRegistry(registryPath);
  doc.hypotheses[0].confirmation_starts_at = "2026-01-01T00:00:00.000Z";
  fs.writeFileSync(registryPath, JSON.stringify(doc, null, 2));

  const v = validateRegistry({ registryPath });
  assert.strictEqual(v.ok, false, "(E2) an edited window fails validation");
  assert.deepStrictEqual(v.tampered, ["tamper"], "(E3) and the tampered id is named");
}

// Listing surfaces whether each window has actually opened yet.
{
  const registryPath = tmpRegistry();
  registerHypothesis({ registryPath, id: "open", title: "o", confirmationStartsAt: "2026-09-13T00:00:00.000Z", now: NOW });
  registerHypothesis({ registryPath, id: "shut", title: "s", confirmationStartsAt: "2026-10-13T00:00:00.000Z", now: NOW });

  const rows = listHypotheses({ registryPath, now: NOW });
  const open = rows.find((r) => r.id === "open");
  const shut = rows.find((r) => r.id === "shut");
  assert.strictEqual(open.window_open, true, "(F1) a window starting now reads as open");
  assert.strictEqual(shut.window_open, false, "(F2) a future window reads as closed");
  assert.strictEqual(shut.days_until_open, 30, "(F3) with the wait reported in days");
}

// The hash exists to make an edited id or date detectable, so its field
// boundaries must be unambiguous. Concatenating values without a delimiter
// makes {id:"ab", title:"c"} and {id:"a", title:"bc"} identical — an id could
// then be rewritten and still validate. This test is here because a separator
// was once removed from entryHash and nothing caught it.
{
  const base = { discovered_on: "", registered_at: "", confirmation_starts_at: "" };
  const a = entryHash({ ...base, id: "ab", title: "c" });
  const b = entryHash({ ...base, id: "a", title: "bc" });
  assert.notStrictEqual(a, b, "(G1) shifting a character across a field boundary must change the hash");

  // Null and empty must not be distinguishable from each other in a way that
  // depends on coercion order, but they must both differ from a real value.
  const empty = entryHash({ ...base, id: "", title: "" });
  const nulls = entryHash({ ...base, id: null, title: undefined });
  assert.strictEqual(empty, nulls, "(G2) null/undefined normalise to empty");
  assert.notStrictEqual(empty, entryHash({ ...base, id: "x", title: "" }), "(G3) a real value still differs");

  // Changing any single immutable field must move the hash.
  const full = { id: "i", title: "t", rationale: "why", discovered_on: "d", registered_at: "r", confirmation_starts_at: "c" };
  const ref = entryHash(full);
  for (const f of ["id", "title", "rationale", "discovered_on", "registered_at", "confirmation_starts_at"]) {
    const mutated = { ...full };
    mutated[f] = `${mutated[f]}X`;
    assert.notStrictEqual(entryHash(mutated), ref, `(G4:${f}) editing ${f} must change the hash`);
  }
}

// The evidence that justified a hypothesis must be as protected as its dates.
// Leaving rationale mutable meant the one field recording WHY a hypothesis was
// opened could be rewritten silently — which is exactly what a registry exists
// to prevent, and exactly what was needed on 2026-09-14 when registered figures
// turned out to come from a construction that was not the one frozen.
{
  const registryPath = tmpRegistry();
  const args = {
    registryPath,
    id: "evidence",
    title: "t",
    rationale: "in-sample paired difference +1.076pp",
    confirmationStartsAt: "2027-01-01T00:00:00.000Z",
    now: NOW,
  };
  registerHypothesis(args);

  // Same rationale re-registers as a no-op.
  assert.strictEqual(registerHypothesis(args).unchanged, true, "(I1) identical rationale is idempotent");

  // A revised rationale is a different hypothesis and must be refused.
  assert.throws(
    () => registerHypothesis({ ...args, rationale: "in-sample paired difference -0.559pp" }),
    /IMMUTABLE_FIELD_CHANGED/,
    "(I2) revising the evidence in place must throw — it needs a new id"
  );

  // Hand-editing it in the file must fail validation.
  const doc = readRegistry(registryPath);
  doc.hypotheses[0].rationale = "quietly corrected";
  fs.writeFileSync(registryPath, JSON.stringify(doc, null, 2));
  const v = validateRegistry({ registryPath });
  assert.strictEqual(v.ok, false, "(I3) an edited rationale fails validation");
  assert.deepStrictEqual(v.tampered, ["evidence"], "(I4) and names the entry");
}

// Both these modules and this test must stay plain text. A control byte in
// the source makes git classify the file as binary, which kills diff, blame
// and review on the one file whose job is detecting edits. entryHash once
// used a NUL as its field separator, git flagged the whole module binary,
// and stripping that byte silently changed every stored hash.
//
// The check is code-point arithmetic rather than a character class on
// purpose: authoring a control-character regex is how the bytes got in.
{
  const fsMod = require("fs");
  const firstControl = (s) => {
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charCodeAt(i);
      if (c < 9 || c === 11 || c === 12 || (c > 13 && c < 32)) return i;
    }
    return -1;
  };
  for (const rel of ["../research/hypothesisRegistry", "../research/staticBenchmarkGate", "../research/monotonicityGate"]) {
    const text = fsMod.readFileSync(require.resolve(rel), "utf8");
    assert.strictEqual(firstControl(text), -1, `(H1:${rel}) control character in source`);
  }
  const selfText = fsMod.readFileSync(__filename, "utf8");
  assert.strictEqual(firstControl(selfText), -1, "(H2) the test file must be free of control characters");
}

console.log("HYPOTHESIS_REGISTRY_TESTS_PASS");
