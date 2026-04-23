#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const alertPreview = require("./lib/v2-promotion-submit-operator-alert");

const DEFAULT_FILENAME = "promotion-cloudbuild-submit-request.json";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function resolveSubmitRequestFile(env = process.env) {
  const explicit = trimOrNull(env.V2_PROMOTION_SUBMIT_REQUEST_FILE);
  if (explicit) return path.resolve(explicit);
  const artifactDir = trimOrNull(env.V2_PROMOTION_ARTIFACT_DIR);
  if (artifactDir) return path.resolve(artifactDir, DEFAULT_FILENAME);
  throw new Error("V2_PROMOTION_SUBMIT_REQUEST_FILE_REQUIRED");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function buildExpectedPreview(payload, filePath) {
  return alertPreview.buildOperatorAlertPreview({
    ok: payload && payload.approval_verification && payload.approval_verification.ok === true,
    output_file: filePath,
    request: payload,
  });
}

function assertEmbeddedPreviewFresh(payload, filePath) {
  if (!payload || !payload.operator_alert_preview) return null;
  const embedded = payload.operator_alert_preview;
  const expected = buildExpectedPreview(payload, filePath);
  if (
    trimOrNull(embedded.source_fingerprint_version) !== trimOrNull(expected.source_fingerprint_version) ||
    trimOrNull(embedded.source_fingerprint) !== trimOrNull(expected.source_fingerprint)
  ) {
    throw new Error("V2_PROMOTION_OPERATOR_ALERT_PREVIEW_STALE");
  }
  return embedded;
}

function renderAlert(env = process.env) {
  const filePath = resolveSubmitRequestFile(env);
  const payload = readJson(filePath);
  const preview = assertEmbeddedPreviewFresh(payload, filePath) || buildExpectedPreview(payload, filePath);
  return Object.freeze({
    ok: true,
    file: filePath,
    preview,
    telegram_args: alertPreview.buildTelegramSummaryArgs(preview),
  });
}

async function main(env = process.env) {
  const result = renderAlert(env);
  console.log(JSON.stringify(result));
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error("RENDER_V2_PROMOTION_SUBMIT_OPERATOR_ALERT_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    renderAlert,
    __test: {
      DEFAULT_FILENAME,
      trimOrNull,
      resolveSubmitRequestFile,
      readJson,
      buildExpectedPreview,
      assertEmbeddedPreviewFresh,
    },
  };
}
