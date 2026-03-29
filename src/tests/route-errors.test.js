"use strict";

const assert = require("assert");
const { buildRouteErrorRef, sanitizeRouteError } = require("../utils/routeErrors");

function run() {
  const ref = buildRouteErrorRef("home");
  assert.ok(/^HOME_[A-Z0-9_]+$/i.test(ref), `unexpected ref: ${ref}`);

  const sanitized = sanitizeRouteError(new Error("Firestore secret failed"), {
    defaultCode: "HOME_ROUTE_ERROR",
    defaultMessage: "generic",
  });
  assert.strictEqual(sanitized.code, "HOME_ROUTE_ERROR");
  assert.strictEqual(sanitized.userMessage, "generic");
  assert.strictEqual(sanitized.status, 500);

  const publicErr = new Error("raw");
  publicErr.publicCode = "BAD_INPUT";
  publicErr.publicMessage = "입력값이 잘못되었습니다.";
  publicErr.status = 400;
  const publicSanitized = sanitizeRouteError(publicErr);
  assert.strictEqual(publicSanitized.code, "BAD_INPUT");
  assert.strictEqual(publicSanitized.userMessage, "입력값이 잘못되었습니다.");
  assert.strictEqual(publicSanitized.status, 400);
  console.log("ROUTE_ERRORS_TEST_OK");
}

run();
