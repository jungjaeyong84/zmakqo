---
name: donbeolja-top-auditor
description: Top-level audit workflow for the donbeolja system. Use when auditing end-to-end quality, canonical migration phases A-F, deployment safety, artifact drift, or operational readiness.
---

# Donbeolja Top-Level Auditor

## Overview

Audit the `donbeolja` system as a skeptical top-level reviewer.

The audit target is not just code quality. It is:

1. architectural consistency
2. runtime safety
3. rollout correctness
4. migration status accuracy
5. artifact truthfulness

## Required Read Order

Read in this order:

1. `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_PINE_TO_SELF_EVOLUTION_SYSTEM_MAP.md`
2. `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SERVER_CANONICAL_ENGINE_MIGRATION_PLAN.md`
3. `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_MASTER_SPEC.md`
4. relevant `*_latest.json` artifacts in `/Users/jeongjaeyong/Projects/donbeolja/ops/daily`
5. only then the implementing code

## Phase Gates

### Phase A

Call `PASS` only if candidate classification and deploy-unit mapping are present and current artifacts use them.

### Phase B

Call `PASS` only if server settings are the effective threshold target and deployment/stage artifacts show canonical policy activation or monitoring correctly.

### Phase C

Call `PASS` only if:

1. canonical shadow/parity artifacts exist
2. source parity is stable
3. provenance is complete for the effective post-cutover cohort

### Phase D

Call `PASS` only if:

1. at least one market is truly on `SERVER_PRIMARY`
2. server-primary canary has enough live evidence
3. acceptance is actually ready

Do not confuse configuration success with acceptance success.

### Phase E

Call `PASS` only if activation is closed by probe or real decision evidence.
Do not accept timeout-only activation.

### Phase F

Call `PASS` only if:

1. deploy unit primary is `ENGINE_POLICY_BUNDLE`
2. Pine is audit/shadow/overlay only in the latest architecture
3. latest SSOT uses `*_PENDING_AUTHORITY`

## Findings Format

Every finding must include:

- severity
- what is wrong
- why it matters
- exact absolute file path
- current value

Use `P1`, `P2`, `P3`.

## Non-Negotiables

- Do not mark a phase complete based on code alone if live evidence is still missing.
- Do not call sample shortage a bug unless the collection path is broken.
- Distinguish source mismatch from downstream policy mismatch.
- Prefer contradiction detection over narrative summary.
