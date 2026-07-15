const crypto = require("crypto");

function base64UrlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecodeToBuffer(str) {
  const b64 = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (b64.length % 4)) % 4;
  const padded = b64 + "=".repeat(padLen);
  return Buffer.from(padded, "base64");
}

function jwtError(name, message, code) {
  return { ok: false, name, message, code: code || message };
}

function normalizeAudienceValue(aud) {
  if (typeof aud === "string") return aud;
  if (Array.isArray(aud)) return aud;
  return aud;
}

function audienceMatches(expected, actual) {
  const normalized = normalizeAudienceValue(actual);
  if (typeof normalized === "string") return normalized === expected;
  if (Array.isArray(normalized)) return normalized.includes(expected);
  return false;
}

/**
 * Sign a standard 3-part HS256 JWT.
 * @param {object} payload
 * @param {string} secret
 * @returns {string}
 */
function sign(payload, secret) {
  if (!secret || typeof secret !== "string") {
    throw new Error("JWT secret is required");
  }
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest();
  return `${data}.${base64UrlEncode(sig)}`;
}

/**
 * Verify a standard 3-part HS256 JWT.
 * @param {string} token
 * @param {string} secret
 * @param {{
 *   checkExp?: boolean,
 *   algorithms?: string[],
 *   issuer?: string,
 *   audience?: string
 * }} [options]
 * @returns {{ ok: true, payload: object } | { ok: false, name: string, message: string, code: string }}
 */
function verify(token, secret, options = {}) {
  const checkExp = options.checkExp !== false;
  const algorithms = options.algorithms || ["HS256"];
  const issuer = options.issuer;
  const audience = options.audience;

  if (!secret || typeof secret !== "string") {
    return jwtError("JsonWebTokenError", "secret or public key must be provided", "secret missing");
  }
  if (!token || typeof token !== "string") {
    return jwtError("JsonWebTokenError", "jwt malformed", "jwt malformed");
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return jwtError("JsonWebTokenError", "jwt malformed", "jwt malformed");
  }

  const [headerPart, payloadPart, sigPart] = parts;
  const data = `${headerPart}.${payloadPart}`;

  let header;
  try {
    header = JSON.parse(base64UrlDecodeToBuffer(headerPart).toString("utf8"));
  } catch {
    return jwtError("JsonWebTokenError", "jwt malformed", "jwt malformed");
  }

  if (!header || !algorithms.includes(header.alg)) {
    return jwtError("JsonWebTokenError", "invalid algorithm", "invalid algorithm");
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecodeToBuffer(payloadPart).toString("utf8"));
  } catch {
    return jwtError("JsonWebTokenError", "jwt malformed", "jwt malformed");
  }

  const expectedSig = crypto.createHmac("sha256", secret).update(data).digest();
  let actualSig;
  try {
    actualSig = base64UrlDecodeToBuffer(sigPart);
  } catch {
    return jwtError("JsonWebTokenError", "jwt malformed", "jwt malformed");
  }

  if (actualSig.length !== expectedSig.length) {
    return jwtError("JsonWebTokenError", "invalid signature", "invalid signature");
  }
  if (!crypto.timingSafeEqual(actualSig, expectedSig)) {
    return jwtError("JsonWebTokenError", "invalid signature", "invalid signature");
  }

  if (checkExp && payload && typeof payload.exp === "number") {
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec >= payload.exp) {
      return jwtError("TokenExpiredError", "jwt expired", "jwt expired");
    }
  }

  if (typeof payload.nbf === "number") {
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec < payload.nbf) {
      return jwtError("NotBeforeError", "jwt not active", "jwt not active");
    }
  }

  if (issuer !== undefined && payload.iss !== issuer) {
    return jwtError("JsonWebTokenError", "jwt issuer invalid", "jwt issuer invalid");
  }

  if (audience !== undefined && !audienceMatches(audience, payload.aud)) {
    return jwtError("JsonWebTokenError", "jwt audience invalid", "jwt audience invalid");
  }

  return { ok: true, payload };
}

function decodeUnsafe(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(base64UrlDecodeToBuffer(parts[1]).toString("utf8"));
  } catch {
    return null;
  }
}

module.exports = {
  sign,
  verify,
  decodeUnsafe,
  base64UrlEncode,
  base64UrlDecodeToBuffer,
  audienceMatches
};
