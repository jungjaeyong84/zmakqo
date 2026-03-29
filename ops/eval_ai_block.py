#!/usr/bin/env python3
"""
Evaluate AI_BLOCK vs KEEP using an Improvement Pack.

Usage:
  python3 ops/eval_ai_block.py /path/to/improvement-pack-30d[.zip] [options]

Examples:
  python3 ops/eval_ai_block.py /tmp/improvement-pack-30d.zip
  python3 ops/eval_ai_block.py /tmp/improvement-pack-30d.zip --exchange BINANCEFUT --tf 60m
  python3 ops/eval_ai_block.py /tmp/improvement-pack-30d.zip --market BTCUSDT --horizons 4h,12h
  python3 ops/eval_ai_block.py /tmp/improvement-pack-30d.zip --intent ENTRY --side LONG
"""

import argparse
import csv
import gzip
import math
import os
import shutil
import sys
import tempfile
import zipfile


DEFAULT_HORIZONS = ["4h", "12h", "24h", "72h"]


def parse_float(v):
    try:
        n = float(v)
        if math.isfinite(n):
            return n
    except Exception:
        pass
    return None


def load_labels(labels_path):
    labels = {}
    with gzip.open(labels_path, "rt", newline="") as f:
        r = csv.DictReader(f)
        for row in r:
            event_id = row.get("event_id")
            if event_id:
                labels[event_id] = row
    return labels


def init_stats(horizons):
    return {h: {"sum": 0.0, "count": 0, "win": 0} for h in horizons}


def add_stat(stat, horizon, value):
    stat[horizon]["sum"] += value
    stat[horizon]["count"] += 1
    if value > 0:
        stat[horizon]["win"] += 1


def summarize(stat, horizons):
    out = {}
    for h in horizons:
        c = stat[h]["count"]
        if c == 0:
            out[h] = None
            continue
        avg = stat[h]["sum"] / c
        win = stat[h]["win"] / c
        out[h] = (avg, win, c)
    return out


def fmt(entry):
    if entry is None:
        return "n=0"
    avg, win, count = entry
    return f"n={count} avg={avg:.4%} win={win:.1%}"


def split_list(raw):
    if raw is None:
        return []
    return [s.strip() for s in str(raw).split(",") if s.strip()]


def norm_exchange(v):
    return str(v or "").strip().upper()


def norm_market(v):
    return str(v or "").strip().upper()


def norm_tf(v):
    return str(v or "").strip().lower()


def get_field(row, lab, key):
    return row.get(key) or lab.get(key)


def eval_pack(root_dir, opts):
    labels_path = os.path.join(root_dir, "data", "labels", "signal_forward_labels.csv.gz")
    events_path = os.path.join(root_dir, "data", "signals", "signal_events.csv.gz")
    if not os.path.exists(labels_path) or not os.path.exists(events_path):
        raise FileNotFoundError("Improvement pack missing labels or signals CSV.")

    labels = load_labels(labels_path)
    horizons = opts.horizons

    stats = {
        "AI_BLOCK": init_stats(horizons),
        "KEEP": init_stats(horizons),
        "ALL_ENTRY_ADD": init_stats(horizons),
    }
    side_stats = {
        "AI_BLOCK_LONG": init_stats(horizons),
        "AI_BLOCK_SHORT": init_stats(horizons),
        "KEEP_LONG": init_stats(horizons),
        "KEEP_SHORT": init_stats(horizons),
    }

    filters = []
    if opts.exchange_set:
        filters.append(f"exchange={','.join(sorted(opts.exchange_set))}")
    if opts.market_set:
        filters.append(f"market={','.join(sorted(opts.market_set))}")
    if opts.tf_set:
        filters.append(f"tf={','.join(sorted(opts.tf_set))}")
    if opts.intent_set:
        filters.append(f"intent={','.join(sorted(opts.intent_set))}")
    if opts.side_set:
        filters.append(f"side={','.join(sorted(opts.side_set))}")
    filters.append(f"horizons={','.join(horizons)}")
    print("FILTERS:", " | ".join(filters))

    with gzip.open(events_path, "rt", newline="") as f:
        r = csv.DictReader(f)
        for row in r:
            intent = str(row.get("event_intent", "")).strip().upper()
            if opts.intent_set and intent not in opts.intent_set:
                continue
            event_id = row.get("event_id")
            lab = labels.get(event_id)
            if not lab:
                continue
            exchange = norm_exchange(get_field(row, lab, "exchange"))
            market = norm_market(get_field(row, lab, "market"))
            tf = norm_tf(get_field(row, lab, "tf"))
            side_dir = str(lab.get("side_dir", "")).strip().upper()
            if opts.exchange_set and exchange not in opts.exchange_set:
                continue
            if opts.market_set and market not in opts.market_set:
                continue
            if opts.tf_set and tf not in opts.tf_set:
                continue
            if opts.side_set and side_dir not in opts.side_set:
                continue
            if side_dir not in ("LONG", "SHORT"):
                continue
            mult = 1.0 if side_dir == "LONG" else -1.0

            is_ai_block = row.get("drop_reason_code", "") == "AI_BLOCK"
            is_keep = row.get("keep", "") == "true" and row.get("drop", "") == "false"

            for h in horizons:
                val = parse_float(lab.get(f"fwd_ret_{h}", ""))
                if val is None:
                    continue
                val_dir = val * mult
                add_stat(stats["ALL_ENTRY_ADD"], h, val_dir)
                if is_ai_block:
                    add_stat(stats["AI_BLOCK"], h, val_dir)
                    if side_dir == "LONG":
                        add_stat(side_stats["AI_BLOCK_LONG"], h, val_dir)
                    else:
                        add_stat(side_stats["AI_BLOCK_SHORT"], h, val_dir)
                elif is_keep:
                    add_stat(stats["KEEP"], h, val_dir)
                    if side_dir == "LONG":
                        add_stat(side_stats["KEEP_LONG"], h, val_dir)
                    else:
                        add_stat(side_stats["KEEP_SHORT"], h, val_dir)

    print("MAIN:")
    for key in ("AI_BLOCK", "KEEP", "ALL_ENTRY_ADD"):
        print(key, summarize(stats[key], horizons))
    print("\nSIDE:")
    for key in ("AI_BLOCK_LONG", "AI_BLOCK_SHORT", "KEEP_LONG", "KEEP_SHORT"):
        print(key, summarize(side_stats[key], horizons))


def parse_args(argv):
    parser = argparse.ArgumentParser(description="Evaluate AI_BLOCK vs KEEP using an Improvement Pack.")
    parser.add_argument("pack_path", help="Path to improvement-pack folder or .zip")
    parser.add_argument("--exchange", default="", help="Filter exchange(s), comma-separated (e.g., BINANCEFUT)")
    parser.add_argument("--market", default="", help="Filter market(s), comma-separated (e.g., BTCUSDT)")
    parser.add_argument("--tf", default="", help="Filter tf(s), comma-separated (e.g., 60m)")
    parser.add_argument("--intent", default="ENTRY,ADD", help="Filter intent(s), comma-separated (default: ENTRY,ADD)")
    parser.add_argument("--side", default="", help="Filter side(s), comma-separated (LONG,SHORT)")
    parser.add_argument("--horizons", default=",".join(DEFAULT_HORIZONS), help="Horizons (e.g., 4h,12h,24h)")
    args = parser.parse_args(argv)

    args.exchange_set = {norm_exchange(x) for x in split_list(args.exchange)}
    args.market_set = {norm_market(x) for x in split_list(args.market)}
    args.tf_set = {norm_tf(x) for x in split_list(args.tf)}
    args.intent_set = {str(x).strip().upper() for x in split_list(args.intent)}
    args.side_set = {str(x).strip().upper() for x in split_list(args.side)}
    args.horizons = split_list(args.horizons) or list(DEFAULT_HORIZONS)
    return args


def main():
    args = parse_args(sys.argv[1:])
    target = args.pack_path
    if not os.path.exists(target):
        print(f"Path not found: {target}")
        return 2

    if target.endswith(".zip"):
        tmp_dir = tempfile.mkdtemp(prefix="improvement-pack-")
        try:
            with zipfile.ZipFile(target, "r") as zf:
                zf.extractall(tmp_dir)
            eval_pack(tmp_dir, args)
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)
    else:
        eval_pack(target, args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
