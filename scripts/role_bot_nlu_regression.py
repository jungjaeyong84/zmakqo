#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
BOT_PATH = REPO_ROOT / "noye" / "telegram_role_bot.py"
CASES_PATH = REPO_ROOT / "noye" / "intent_router_regression.json"
ENV_PATH = REPO_ROOT / "noye" / ".env"


def load_bot():
    spec = importlib.util.spec_from_file_location("role_bot_module", BOT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load bot module: {BOT_PATH}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[attr-defined]
    return mod


def make_state():
    return {
        "chats": {
            "1": {
                "history": [],
                "pending_approvals": [],
                "approval_seq": 0,
                "custom_roles": {},
                "next_report_at_kst": "",
                "next_report_reason": "",
                "last_auto_report_date": "",
                "last_cycle_run_utc": "",
                "last_autonomous_run_utc": "",
                "role_memory": {},
                "quality_events": [],
            }
        }
    }


def resolve_role(mod, state, cmd, args):
    if cmd != "/task" or not args:
        return None
    return mod.resolve_role_for_chat(state, 1, args[0])


def parse_and_route(mod, state, text: str, use_nlu: bool):
    cmd, args = mod.parse_input(text)
    if not use_nlu:
        return cmd, args
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    model = os.environ.get("OPENAI_ROLE_BOT_MODEL", "gpt-4o-mini")
    return mod.route_input_with_nlu(
        text=text,
        base_cmd=cmd,
        base_args=args,
        state=state,
        chat_id=1,
        api_key=api_key,
        model=model,
    )


def main() -> int:
    if not BOT_PATH.exists():
        print(f"[FAIL] missing bot: {BOT_PATH}")
        return 2
    if not CASES_PATH.exists():
        print(f"[FAIL] missing cases: {CASES_PATH}")
        return 2

    mod = load_bot()
    if ENV_PATH.exists():
        mod.load_env(ENV_PATH)

    raw = json.loads(CASES_PATH.read_text())
    cases = raw.get("cases", [])
    if not isinstance(cases, list) or not cases:
        print("[FAIL] no cases")
        return 2

    limit_raw = os.environ.get("ROLE_NLU_REGRESSION_LIMIT", "").strip()
    if limit_raw:
        try:
            limit = max(1, int(limit_raw))
            cases = cases[:limit]
        except ValueError:
            pass

    use_nlu = os.environ.get("ROLE_NLU_REGRESSION_ONLINE", "0").strip().lower() in {
        "1",
        "true",
        "yes",
        "y",
        "on",
    }
    if use_nlu and not os.environ.get("OPENAI_API_KEY", "").strip():
        print("[WARN] ROLE_NLU_REGRESSION_ONLINE=1 but OPENAI_API_KEY missing -> fallback offline")
        use_nlu = False

    print(f"[INFO] cases={len(cases)} mode={'online-nlu' if use_nlu else 'offline-parser'}")

    fail = 0
    for idx, case in enumerate(cases, start=1):
        name = str(case.get("name", f"case_{idx}"))
        text = str(case.get("input", ""))
        expect = case.get("expect", {}) or {}
        state = make_state()
        cmd, args = parse_and_route(mod, state, text, use_nlu=use_nlu)
        role = resolve_role(mod, state, cmd, args)

        reasons = []
        exp_cmd = expect.get("cmd")
        if exp_cmd and cmd != exp_cmd:
            reasons.append(f"cmd expected={exp_cmd} got={cmd}")
        exp_role = expect.get("role")
        if exp_role and role != exp_role:
            reasons.append(f"role expected={exp_role} got={role}")
        exp_ap = expect.get("ap_id")
        if exp_ap:
            got_ap = args[0] if args else None
            if got_ap != exp_ap:
                reasons.append(f"ap_id expected={exp_ap} got={got_ap}")

        if reasons:
            fail += 1
            print(f"[FAIL] {name}")
            print(f"  input: {text}")
            print(f"  got  : cmd={cmd} args={args} role={role}")
            for r in reasons:
                print(f"  - {r}")
        else:
            print(f"[PASS] {name}")

    total = len(cases)
    passed = total - fail
    print(f"[SUMMARY] passed={passed} failed={fail} total={total}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
