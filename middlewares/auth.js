const crypto = require("crypto");

function sendError(res, statusCode, message) {
  return res.status(statusCode).json({ success: false, message });
}

function base64UrlDecodeToBuffer(str) {
  const b64 = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (b64.length % 4)) % 4;
  const padded = b64 + "=".repeat(padLen);
  return Buffer.from(padded, "base64");
}

function verifyToken(token) {
  const secret = process.env.AUTH_SECRET || "dev-secret";

  if (!token || typeof token !== "string") {
    return { ok: false, message: "未登录" };
  }

  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, message: "token 无效" };

  const [payloadPart, sigPart] = parts;

  let payloadJson;
  try {
    payloadJson = base64UrlDecodeToBuffer(payloadPart).toString("utf8");
  } catch {
    return { ok: false, message: "token 无效" };
  }

  let payload;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return { ok: false, message: "token 无效" };
  }

  const expectedSig = crypto.createHmac("sha256", secret).update(payloadPart).digest();
  let actualSig;
  try {
    actualSig = base64UrlDecodeToBuffer(sigPart);
  } catch {
    return { ok: false, message: "token 无效" };
  }

  // timing safe compare（长度不同会抛错）
  if (actualSig.length !== expectedSig.length) return { ok: false, message: "token 无效" };
  if (!crypto.timingSafeEqual(actualSig, expectedSig)) return { ok: false, message: "token 无效" };

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload && typeof payload.exp === "number" && nowSec >= payload.exp) {
    return { ok: false, message: "token 已过期" };
  }

  if (!payload || payload.uid === undefined || payload.uid === null) {
    return { ok: false, message: "token 无效" };
  }

  return { ok: true, payload };
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || req.headers.Authorization;
  const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  const result = verifyToken(token);
  if (!result.ok) return sendError(res, 401, result.message);

  req.auth = {
    uid: result.payload.uid,
    iat: result.payload.iat,
    exp: result.payload.exp
  };
  return next();
}

module.exports = {
  requireAuth,
  verifyToken
};

