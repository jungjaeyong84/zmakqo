"use strict";

function toUpper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function deriveExecutionEntryLabelScope(row = null) {
  const wasFilled = row && row.labels && row.labels.was_filled === true;
  const family = toUpper(row && row.execution && row.execution.no_fill_reason_family);
  const reason = toUpper(row && row.execution && row.execution.no_fill_reason);
  const subtype = toUpper(row && row.execution && row.execution.no_fill_subtype);

  if (wasFilled) {
    return {
      scope: "FILLED",
      scope_detail: "FILLED",
      learning_bucket: "FILLABLE",
      is_fillable_runtime: true,
      is_blocked_by_policy: false,
      is_runtime_exception: false,
    };
  }
  if (family === "POLICY_OR_CAPACITY") {
    return {
      scope: "POLICY_BLOCKED",
      scope_detail: subtype || reason || "POLICY_BLOCKED",
      learning_bucket: "NON_FILL_POLICY",
      is_fillable_runtime: false,
      is_blocked_by_policy: true,
      is_runtime_exception: false,
    };
  }
  if (family === "RUNTIME_ERROR") {
    return {
      scope: "RUNTIME_EXCEPTION",
      scope_detail: subtype || reason || "RUNTIME_EXCEPTION",
      learning_bucket: "NON_FILL_RUNTIME",
      is_fillable_runtime: false,
      is_blocked_by_policy: false,
      is_runtime_exception: true,
    };
  }
  if (family === "CONTROL_FLOW") {
    return {
      scope: "CONTROL_FLOW",
      scope_detail: subtype || reason || "CONTROL_FLOW",
      learning_bucket: "NON_FILL_CONTROL_FLOW",
      is_fillable_runtime: false,
      is_blocked_by_policy: false,
      is_runtime_exception: false,
    };
  }
  if (family === "FILTER_DROP") {
    return {
      scope: "FILTER_DROP",
      scope_detail: subtype || reason || "FILTER_DROP",
      learning_bucket: "NON_FILL_FILTER",
      is_fillable_runtime: false,
      is_blocked_by_policy: false,
      is_runtime_exception: false,
    };
  }
  return {
    scope: "UNKNOWN",
    scope_detail: subtype || reason || family || "UNKNOWN",
    learning_bucket: "NON_FILL_UNKNOWN",
    is_fillable_runtime: false,
    is_blocked_by_policy: false,
    is_runtime_exception: false,
  };
}

module.exports = {
  deriveExecutionEntryLabelScope,
};
