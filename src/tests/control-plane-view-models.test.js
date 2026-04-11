"use strict";

const assert = require("assert");
const ejs = require("ejs");
const fs = require("fs");
const path = require("path");

const { __test: controlPlaneTest, buildControlPlaneRouteModel } = require("../utils/controlPlaneViewModels");

function run() {
  const opsDailyDir = path.resolve(__dirname, "../../ops/daily");
  const latestName = "tmp_control_plane_recovery_latest.json";
  const fallbackName = "2099-12-31_2359_tmp_control_plane_recovery.json";
  const systemOpsPath = path.join(opsDailyDir, "system_ops_check_latest.json");
  const systemOpsBackup = fs.existsSync(systemOpsPath) ? fs.readFileSync(systemOpsPath, "utf8") : null;
  const latestPath = path.join(opsDailyDir, latestName);
  const fallbackPath = path.join(opsDailyDir, fallbackName);
  const controlPlaneTemplatePath = path.resolve(__dirname, "../views/control-plane.ejs");

  fs.writeFileSync(latestPath, "{broken-json", "utf8");
  fs.writeFileSync(fallbackPath, JSON.stringify({
    summary: {
      governor_status: "RECOVERY_PROMOTION_READY",
      governor_reason: "fallback-source-ok",
    },
  }, null, 2), "utf8");
  fs.writeFileSync(systemOpsPath, JSON.stringify({
    status: "보류",
    reasons: ["writer authority review"],
    active_error_count: 0,
    cost_ratio_pct: 0.12,
    cost_limit_pct: 0.2,
    position_writer_authority_24h: {
      occurrence_count: 3,
      top_symbols: [
        { symbol: "XRPUSDT", count: 2 },
        { symbol: "DOGEUSDT", count: 1 },
      ],
      remediation_candidates: [
        { symbol: "XRPUSDT", count: 2, severity: "LOW", action: "재발 여부 모니터링 및 다음 발생 시 trace 수집" },
      ],
    },
  }, null, 2), "utf8");

  try {
    const artifact = controlPlaneTest.loadLatestArtifact(latestName);
    assert.strictEqual(artifact.missing, false);
    assert.strictEqual(artifact.sourceFileName, fallbackName);
    assert.strictEqual(artifact.sourceKind, "fallback_after_latest_read_fail");
    assert.strictEqual(artifact.summary.governor_status, "RECOVERY_PROMOTION_READY");

    const vm = buildControlPlaneRouteModel("recovery", { exchange: "BINANCEFUT" });
    assert.ok(vm);
    assert.strictEqual(Array.isArray(vm.sections), true);
    assert.ok(vm.sections.length >= 1);
    const operatorSection = vm.sections.find((section) => String(section && section.title || "").includes("핵심 운영 상태"));
    assert.ok(operatorSection);
    const runtimeCard = Array.isArray(operatorSection.cards)
      ? operatorSection.cards.find((card) => String(card && card.title || "").includes("런타임 가드"))
      : null;
    assert.ok(runtimeCard);
    assert.ok(Array.isArray(runtimeCard.rows));
    assert.ok(runtimeCard.rows.some((row) => String(row && row.label || "").includes("신규 진입 배율")));
    assert.ok(runtimeCard.rows.some((row) => String(row && row.label || "").includes("Writer Authority 24h")));
    assert.ok(runtimeCard.table);
    assert.ok(Array.isArray(runtimeCard.table.rows));
    assert.ok(String(runtimeCard.table.rows[0].symbol && runtimeCard.table.rows[0].symbol.label || "").includes("XRPUSDT"));
    const executionCard = Array.isArray(operatorSection.cards)
      ? operatorSection.cards.find((card) => String(card && card.title || "").includes("실행 품질"))
      : null;
    assert.ok(executionCard);
    assert.ok(Array.isArray(executionCard.rows));
    assert.ok(executionCard.rows.some((row) => String(row && row.label || "").includes("지연 P95")));
    assert.ok(executionCard.table);
    assert.ok(Array.isArray(executionCard.table.rows));
    assert.ok(executionCard.table.rows[0].market && executionCard.table.rows[0].market.href);
    assert.ok(executionCard.table.rows[0].open && executionCard.table.rows[0].open.href);
    assert.ok(String(executionCard.table.rows[0].open.href).includes("/dashboard/execution"));
    assert.ok(Array.isArray(vm.hero && vm.hero.pills));
    assert.ok(vm.hero.pills.some((pill) => String(pill && pill.label || "").includes("신규 진입 배율")));

    const html = ejs.render(fs.readFileSync(controlPlaneTemplatePath, "utf8"), { model: vm }, { filename: controlPlaneTemplatePath });
    assert.ok(html.includes("핵심 운영 상태"));
    assert.ok(html.includes("런타임 가드"));
    assert.ok(html.includes("Writer Authority 24h"));
    assert.ok(html.includes("XRPUSDT"));
    assert.ok(html.includes("/dashboard/execution"));
  } finally {
    try { fs.unlinkSync(latestPath); } catch (_) {}
    try { fs.unlinkSync(fallbackPath); } catch (_) {}
    if (systemOpsBackup != null) fs.writeFileSync(systemOpsPath, systemOpsBackup, "utf8");
  }

  console.log("CONTROL_PLANE_VIEW_MODELS_TEST_OK");
}

run();
