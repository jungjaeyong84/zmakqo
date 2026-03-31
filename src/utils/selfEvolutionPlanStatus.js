"use strict";

function normalizePlanStatus(planStatus = null) {
  const raw = String(planStatus || "").trim().toUpperCase();
  if (!raw) return null;
  if (raw === "APPLIED_ACTIVE_AUTHORITY_BYPASS") return "APPLIED_ACTIVE_PENDING_AUTHORITY";
  if (raw === "APPLIED_PENDING_BUNDLE_ACTIVATION_AUTHORITY_BYPASS") return "APPLIED_PENDING_BUNDLE_ACTIVATION_PENDING_AUTHORITY";
  if (raw === "APPLIED_CONFIRMED_AUTHORITY_BYPASS") return "APPLIED_CONFIRMED_PENDING_AUTHORITY";
  if (raw === "APPLIED_PENDING_SIGNAL_CONFIRMATION_AUTHORITY_BYPASS") return "APPLIED_PENDING_SIGNAL_CONFIRMATION_PENDING_AUTHORITY";
  return raw;
}

function isPendingAuthorityPlanStatus(planStatus = null) {
  return /PENDING_AUTHORITY$/.test(normalizePlanStatus(planStatus) || "");
}

function isAppliedConfirmedLike(planStatus = null) {
  const normalized = normalizePlanStatus(planStatus);
  return normalized === "APPLIED_CONFIRMED"
    || normalized === "APPLIED_CONFIRMED_PENDING_AUTHORITY"
    || normalized === "APPLIED_ACTIVE"
    || normalized === "APPLIED_ACTIVE_PENDING_AUTHORITY";
}

function isAppliedPendingSignalConfirmationLike(planStatus = null) {
  const normalized = normalizePlanStatus(planStatus);
  return normalized === "APPLIED_PENDING_SIGNAL_CONFIRMATION"
    || normalized === "APPLIED_PENDING_SIGNAL_CONFIRMATION_PENDING_AUTHORITY";
}

function isAppliedPendingBundleActivationLike(planStatus = null) {
  const normalized = normalizePlanStatus(planStatus);
  return normalized === "APPLIED_PENDING_BUNDLE_ACTIVATION"
    || normalized === "APPLIED_PENDING_BUNDLE_ACTIVATION_PENDING_AUTHORITY";
}

function isBundleActivationTimeoutLike(planStatus = null) {
  const normalized = normalizePlanStatus(planStatus);
  return normalized === "APPLIED_BUNDLE_ACTIVATION_TIMEOUT"
    || normalized === "APPLIED_BUNDLE_ACTIVATION_TIMEOUT_PENDING_AUTHORITY";
}

module.exports = {
  normalizePlanStatus,
  isPendingAuthorityPlanStatus,
  isAppliedConfirmedLike,
  isAppliedPendingSignalConfirmationLike,
  isAppliedPendingBundleActivationLike,
  isBundleActivationTimeoutLike,
};
