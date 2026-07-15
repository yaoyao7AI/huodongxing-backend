const jwt = require("../utils/jwt");
const { isWritePermission } = require("../utils/eventsPermissions");
const {
  EVENTS_TOKEN_TYPE,
  EVENTS_ISS,
  EVENTS_AUD
} = require("../controllers/eventsExchangeController");

function sendError(res, statusCode, message) {
  return res.status(statusCode).json({ success: false, message });
}

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

/**
 * Authenticate Events Token (HS256 JWT signed with EVENTS_JWT_SECRET).
 * On success sets:
 *   req.authType = 'events'
 *   req.user = { externalAdminId, role }
 *   req.permissions = { codes, role, isAdmin: false }
 *   req.auth = { sub, role, iat, exp }
 */
function authenticateEventsToken(req, res, next) {
  const secret = process.env.EVENTS_JWT_SECRET;
  if (!secret) return sendError(res, 401, "未登录");

  const token = getBearerToken(req);
  if (!token) return sendError(res, 401, "未登录");

  const result = verifyEventsTokenString(token, secret);
  if (!result.ok) return sendError(res, 401, result.message);

  attachEventsAuth(req, result.payload);
  return next();
}

function verifyEventsTokenString(token, secret) {
  const verified = jwt.verify(token, secret, { checkExp: true });
  if (!verified.ok) {
    return {
      ok: false,
      message: verified.message === "token 已过期" ? "token 已过期" : "未登录"
    };
  }

  const payload = verified.payload;
  if (payload.token_type !== EVENTS_TOKEN_TYPE) {
    return { ok: false, message: "未登录" };
  }
  if (payload.iss !== EVENTS_ISS) {
    return { ok: false, message: "未登录" };
  }
  if (payload.aud !== EVENTS_AUD) {
    return { ok: false, message: "未登录" };
  }
  if (payload.sub === undefined || payload.sub === null || String(payload.sub).trim() === "") {
    return { ok: false, message: "未登录" };
  }
  if (!Array.isArray(payload.permissions)) {
    return { ok: false, message: "未登录" };
  }

  return { ok: true, payload };
}

function attachEventsAuth(req, payload) {
  req.authType = "events";
  req.auth = {
    sub: payload.sub,
    role: payload.role,
    iat: payload.iat,
    exp: payload.exp
  };
  req.user = {
    externalAdminId: payload.sub,
    role: payload.role
  };
  req.permissions = {
    codes: payload.permissions,
    role: payload.role,
    isAdmin: false
  };
}

/**
 * Require an events permission code.
 * - events auth: must include code
 * - local auth: write/manage → isAdmin; read → logged-in OK; registrations.write → logged-in OK (compat)
 */
function requireEventsPermission(code) {
  return function requireEventsPermissionMiddleware(req, res, next) {
    if (req.authType === "events") {
      const codes = req.permissions?.codes;
      if (Array.isArray(codes) && codes.includes(code)) return next();
      return sendError(res, 403, "无权限");
    }

    if (req.authType === "local") {
      if (isWritePermission(code)) {
        // Local organizer/admin write: keep existing isAdmin gate for org/activity writes.
        // Registrations write stays open for any logged-in local user (current behavior).
        if (code === "events.registrations.write") return next();
        if (req.permissions?.isAdmin) return next();
        return sendError(res, 403, "无权限");
      }
      // Read: any logged-in local user
      return next();
    }

    return sendError(res, 401, "未登录");
  };
}

module.exports = {
  authenticateEventsToken,
  requireEventsPermission,
  verifyEventsTokenString,
  attachEventsAuth,
  getBearerToken
};
