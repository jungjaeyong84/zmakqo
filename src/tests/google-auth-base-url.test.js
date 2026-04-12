"use strict";

const assert = require("assert");
const { __test } = require("../auth/google");

function withEnv(key, value, fn) {
  const prev = process.env[key];
  if (value == null) delete process.env[key];
  else process.env[key] = value;
  try {
    fn();
  } finally {
    if (prev == null) delete process.env[key];
    else process.env[key] = prev;
  }
}

function buildReq({ host, proto = "https", forwardedHost = null, forwardedProto = null } = {}) {
  const headers = {};
  if (forwardedHost) headers["x-forwarded-host"] = forwardedHost;
  if (forwardedProto) headers["x-forwarded-proto"] = forwardedProto;
  return {
    protocol: proto,
    headers,
    get(name) {
      if (String(name).toLowerCase() === "host") return host;
      return undefined;
    },
  };
}

function run() {
  assert.strictEqual(__test.normalizeBaseUrl("https://example.com/"), "https://example.com");
  assert.strictEqual(__test.normalizeBaseUrl("  "), null);

  withEnv("BASE_URL", "https://env.example.com", () => {
    assert.strictEqual(__test.resolveGoogleBaseUrl(), "https://env.example.com");
    assert.strictEqual(
      __test.resolveGoogleCallbackUrl(),
      "https://env.example.com/auth/google/callback"
    );
  });

  withEnv("BASE_URL", "https://old.example.com", () => {
    const req = buildReq({
      host: "donbeolja-350958953672.asia-northeast3.run.app",
      forwardedProto: "https",
      forwardedHost: "donbeolja-350958953672.asia-northeast3.run.app",
    });
    assert.strictEqual(
      __test.resolveGoogleBaseUrl(req),
      "https://donbeolja-350958953672.asia-northeast3.run.app"
    );
    assert.strictEqual(
      __test.resolveGoogleCallbackUrl(req),
      "https://donbeolja-350958953672.asia-northeast3.run.app/auth/google/callback"
    );
  });
}

try {
  run();
  console.log("GOOGLE_AUTH_BASE_URL_TEST_OK");
} catch (err) {
  console.error("GOOGLE_AUTH_BASE_URL_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
