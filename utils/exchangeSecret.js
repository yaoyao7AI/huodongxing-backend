const crypto = require("crypto");

function readExchangeSecret() {
  const raw = process.env.EVENTS_EXCHANGE_SECRET;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return { ok: false, reason: "missing" };
  }

  const trimmed = String(raw).trim();
  if (trimmed !== String(raw)) {
    return { ok: false, reason: "whitespace", raw };
  }

  return { ok: true, secret: trimmed, raw };
}

function getExchangeSecretSummary() {
  const result = readExchangeSecret();
  if (!result.ok) {
    return {
      hasExchangeSecret: false,
      exchangeSecretLength: null,
      exchangeSecretHashPrefix: null
    };
  }

  const { secret, raw } = result;
  const summary = {
    hasExchangeSecret: true,
    exchangeSecretLength: secret.length,
    exchangeSecretHashPrefix: crypto
      .createHash("sha256")
      .update(secret)
      .digest("hex")
      .slice(0, 8)
  };

  if (process.env.NODE_ENV !== "production") {
    summary.secretJsonRepr = JSON.stringify(raw);
    summary.hasLeadingOrTrailingWhitespace = String(raw) !== String(raw).trim();
    summary.hasControlCharacters = /[\r\n\t]/.test(String(raw));
  }

  return summary;
}

function getExchangeSecretOrThrow() {
  const result = readExchangeSecret();
  if (!result.ok) {
    const err = new Error("EVENTS_EXCHANGE_SECRET is not configured");
    err.code = "EVENTS_EXCHANGE_MISCONFIGURED";
    throw err;
  }
  return result.secret;
}

function logStartupExchangeSecretSummary() {
  const summary = getExchangeSecretSummary();
  console.log("[startup] events exchange secret", summary);
  return summary;
}

function assertExchangeSecretsAtStartup() {
  const exchange = readExchangeSecret();
  const eventsJwt = process.env.EVENTS_JWT_SECRET;
  const missing = [];

  if (!exchange.ok) missing.push("EVENTS_EXCHANGE_SECRET");
  if (!eventsJwt || String(eventsJwt).trim() === "") missing.push("EVENTS_JWT_SECRET");

  if (missing.length > 0) {
    console.error(
      `[startup] missing required env for events exchange: ${missing.join(", ")}`
    );
    if (process.env.NODE_ENV === "production") {
      const err = new Error(`Missing env: ${missing.join(", ")}`);
      err.code = "EVENTS_EXCHANGE_MISCONFIGURED";
      throw err;
    }
  }
}

module.exports = {
  readExchangeSecret,
  getExchangeSecretSummary,
  getExchangeSecretOrThrow,
  logStartupExchangeSecretSummary,
  assertExchangeSecretsAtStartup
};
