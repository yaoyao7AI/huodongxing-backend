const { requireAuth, verifyToken } = require("./auth");
const { attachCurrentUser } = require("./currentUser");
const {
  getBearerToken,
  verifyEventsTokenString,
  attachEventsAuth
} = require("./eventsAuth");

function sendError(res, statusCode, message) {
  return res.status(statusCode).json({ success: false, message });
}

/**
 * Dual-track auth:
 * 1) Events Token (EVENTS_JWT_SECRET, 3-part JWT) → no DB lookup
 * 2) Local AUTH_SECRET token → attachCurrentUser (users table)
 */
function authenticate(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return sendError(res, 401, "未登录");

  const eventsSecret = process.env.EVENTS_JWT_SECRET;
  if (eventsSecret) {
    const eventsResult = verifyEventsTokenString(token, eventsSecret);
    if (eventsResult.ok) {
      attachEventsAuth(req, eventsResult.payload);
      return next();
    }
  }

  // Fall back to local two-part HMAC token
  const local = verifyToken(token);
  if (!local.ok) return sendError(res, 401, local.message);

  req.auth = {
    uid: local.payload.uid,
    iat: local.payload.iat,
    exp: local.payload.exp
  };
  req.authType = "local";

  return attachCurrentUser(req, res, next);
}

/**
 * Optional helper: require local auth only (users routes).
 * Events token holders get 403.
 */
function requireLocalAuth(req, res, next) {
  if (req.authType === "events") {
    return sendError(res, 403, "无权限");
  }
  if (req.authType === "local" && req.user) return next();
  return sendError(res, 401, "未登录");
}

module.exports = {
  authenticate,
  requireLocalAuth,
  // re-export for callers that still want the old pieces
  requireAuth,
  attachCurrentUser
};
