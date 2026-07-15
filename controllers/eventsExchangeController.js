const jwt = require("../utils/jwt");
const jtiStore = require("../utils/jtiStore");
const { readExchangeSecret } = require("../utils/exchangeSecret");
const {
  mapRoleToPermissions,
  isAllowedExchangeRole
} = require("../utils/eventsPermissions");

const EXCHANGE_ISS = "life-design-backend";
const EXCHANGE_AUD = "huodongxing-backend";
const EXCHANGE_TOKEN_TYPE = "events_exchange";
const EVENTS_TOKEN_TYPE = "events_admin";
const EVENTS_ISS = "huodongxing-backend";
const EVENTS_AUD = "life-design-admin-events";
const MAX_ASSERTION_TTL_SEC = 60;
const REQUIRED_PERMISSION = "center.events.access";

function sendError(res, statusCode, message) {
  return res.status(statusCode).json({ success: false, message });
}

function isDevLikeEnv() {
  return process.env.NODE_ENV !== "production";
}

function logAssertionVerifyError(err, context = {}) {
  if (!isDevLikeEnv()) return;
  console.error("[events-exchange] assertion verify failed", {
    name: err?.name,
    message: err?.message,
    code: err?.code,
    ...context
  });
  if (err?.stack) {
    console.error(err.stack);
  }
}

function mapVerifyFailureToResponse(verified) {
  const code = verified.code || verified.message;
  if (verified.name === "TokenExpiredError" || code === "jwt expired") {
    return { status: 401, message: "assertion 已过期" };
  }
  if (verified.name === "NotBeforeError" || code === "jwt not active") {
    return { status: 401, message: "assertion 尚未生效" };
  }
  if (code === "jwt issuer invalid") {
    return { status: 401, message: "assertion iss 无效" };
  }
  if (code === "jwt audience invalid") {
    return { status: 401, message: "assertion aud 无效" };
  }
  if (code === "invalid signature") {
    return { status: 401, message: "assertion 签名无效" };
  }
  if (code === "invalid algorithm") {
    return { status: 401, message: "assertion 算法无效" };
  }
  if (code === "jwt malformed") {
    return { status: 401, message: "assertion 格式无效" };
  }
  return { status: 401, message: "assertion 无效" };
}

function verifyExchangeAssertion(assertion, secret) {
  return jwt.verify(assertion, secret, {
    algorithms: ["HS256"],
    issuer: EXCHANGE_ISS,
    audience: EXCHANGE_AUD,
    checkExp: true
  });
}

function getEventsTokenTtlSec() {
  const ttl = Number.parseInt(String(process.env.EVENTS_TOKEN_TTL_SECONDS || 1800), 10);
  return Number.isFinite(ttl) && ttl > 0 ? ttl : 1800;
}

/**
 * Validate exchange assertion claims after signature verification.
 * @returns {{ ok: true, payload: object } | { ok: false, status: number, message: string }}
 */
function validateExchangeAssertion(payload) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, status: 401, message: "assertion 无效" };
  }

  if (payload.token_type !== EXCHANGE_TOKEN_TYPE) {
    return { ok: false, status: 401, message: "assertion token_type 无效" };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
    return { ok: false, status: 401, message: "assertion 缺少 exp" };
  }
  if (nowSec >= payload.exp) {
    return { ok: false, status: 401, message: "assertion 已过期" };
  }

  if (typeof payload.iat === "number" && Number.isFinite(payload.iat)) {
    if (payload.exp - payload.iat > MAX_ASSERTION_TTL_SEC) {
      return { ok: false, status: 401, message: "assertion 有效期过长" };
    }
  } else if (payload.exp - nowSec > MAX_ASSERTION_TTL_SEC) {
    return { ok: false, status: 401, message: "assertion 有效期过长" };
  }

  const role = payload.role;
  if (role === "content_admin" || !isAllowedExchangeRole(role)) {
    return { ok: false, status: 403, message: "角色无权限换票" };
  }

  const perms = payload.permissions;
  if (!Array.isArray(perms) || !perms.includes(REQUIRED_PERMISSION)) {
    return { ok: false, status: 403, message: "缺少 center.events.access" };
  }

  if (payload.sub === undefined || payload.sub === null || String(payload.sub).trim() === "") {
    return { ok: false, status: 401, message: "assertion 缺少 sub" };
  }

  if (!payload.jti || typeof payload.jti !== "string") {
    return { ok: false, status: 401, message: "assertion 缺少 jti" };
  }

  return { ok: true, payload };
}

async function exchange(req, res) {
  try {
    const exchangeSecretResult = readExchangeSecret();
    const eventsSecret = process.env.EVENTS_JWT_SECRET;
    if (!exchangeSecretResult.ok || !eventsSecret || String(eventsSecret).trim() === "") {
      return sendError(res, 503, "换票服务未配置");
    }

    const secret = exchangeSecretResult.secret;
    const assertion = req.body?.assertion;
    if (!assertion || typeof assertion !== "string" || !assertion.trim()) {
      return sendError(res, 400, "assertion 不能为空");
    }

    const verified = verifyExchangeAssertion(assertion.trim(), secret);
    if (!verified.ok) {
      logAssertionVerifyError(verified, {
        assertionLength: assertion.trim().length,
        secretLength: secret.length
      });
      const mapped = mapVerifyFailureToResponse(verified);
      return sendError(res, mapped.status, mapped.message);
    }

    const validated = validateExchangeAssertion(verified.payload);
    if (!validated.ok) {
      if (validated.status === 401 && isDevLikeEnv()) {
        logAssertionVerifyError(
          { name: "AssertionClaimError", message: validated.message, code: validated.message },
          { stage: "claim_validation" }
        );
      }
      return sendError(res, validated.status, validated.message);
    }

    const payload = validated.payload;
    if (!jtiStore.consume(payload.jti, payload.exp)) {
      return sendError(res, 401, "assertion 已使用或无效");
    }

    const permissions = mapRoleToPermissions(payload.role);
    if (!permissions) {
      return sendError(res, 403, "角色无权限换票");
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const expiresIn = getEventsTokenTtlSec();
    const eventsPayload = {
      sub: String(payload.sub),
      role: payload.role,
      token_type: EVENTS_TOKEN_TYPE,
      iss: EVENTS_ISS,
      aud: EVENTS_AUD,
      permissions,
      iat: nowSec,
      exp: nowSec + expiresIn
    };

    const token = jwt.sign(eventsPayload, String(eventsSecret).trim());

    return res.json({
      success: true,
      data: {
        token,
        expiresIn,
        user: {
          externalAdminId: payload.sub,
          role: payload.role
        },
        permissions
      }
    });
  } catch (err) {
    logAssertionVerifyError(err, { stage: "exchange_handler" });
    return sendError(res, 500, err.message || "服务器错误");
  }
}

module.exports = {
  exchange,
  validateExchangeAssertion,
  verifyExchangeAssertion,
  mapVerifyFailureToResponse,
  logAssertionVerifyError,
  EXCHANGE_ISS,
  EXCHANGE_AUD,
  EXCHANGE_TOKEN_TYPE,
  EVENTS_TOKEN_TYPE,
  EVENTS_ISS,
  EVENTS_AUD,
  MAX_ASSERTION_TTL_SEC,
  REQUIRED_PERMISSION,
  getEventsTokenTtlSec
};
