#!/usr/bin/env node
/**
 * 本地 assertion 验签诊断。
 *
 * 用法：
 *   ASSERTION="<jwt>" node -r ./loadEnv scripts/debug-verify-assertion.js
 */
"use strict";

const jwt = require("../utils/jwt");
const {
  verifyExchangeAssertion,
  mapVerifyFailureToResponse,
  EXCHANGE_ISS,
  EXCHANGE_AUD
} = require("../controllers/eventsExchangeController");
const {
  getExchangeSecretSummary,
  readExchangeSecret
} = require("../utils/exchangeSecret");

function main() {
  const assertion = process.env.ASSERTION;
  if (!assertion || !String(assertion).trim()) {
    console.error("Usage: ASSERTION=\"<jwt>\" node -r ./loadEnv scripts/debug-verify-assertion.js");
    process.exit(1);
  }

  const token = String(assertion).trim();
  const secretSummary = getExchangeSecretSummary();
  const secretResult = readExchangeSecret();

  console.log("\n== Secret summary ==");
  console.log(secretSummary);

  const decoded = jwt.decodeUnsafe(token);
  console.log("\n== Decoded payload (unsafe) ==");
  console.log(decoded || "(decode failed)");

  if (!secretResult.ok) {
    console.error("\nVerify skipped: EVENTS_EXCHANGE_SECRET is not configured");
    process.exit(1);
  }

  const secret = secretResult.secret;
  console.log("\n== Claim checks (pre-verify) ==");
  console.log({
    issuerExpected: EXCHANGE_ISS,
    issuerActual: decoded?.iss ?? null,
    issuerMatches: decoded?.iss === EXCHANGE_ISS,
    audienceExpected: EXCHANGE_AUD,
    audienceActual: decoded?.aud ?? null,
    audienceMatches: jwt.audienceMatches(EXCHANGE_AUD, decoded?.aud)
  });

  console.log("\n== Verify ==");
  const verified = verifyExchangeAssertion(token, secret);
  if (verified.ok) {
    console.log("verify: OK");
    console.log("payload:", verified.payload);
    process.exit(0);
  }

  const mapped = mapVerifyFailureToResponse(verified);
  console.log("verify: FAILED");
  console.log({
    name: verified.name,
    message: verified.message,
    code: verified.code,
    httpStatus: mapped.status,
    responseMessage: mapped.message
  });
  process.exit(2);
}

main();
