function sendError(res, statusCode, message) {
  return res.status(statusCode).json({ success: false, message });
}

/**
 * Local admin only. Events Token holders are always rejected (403).
 */
function requireAdmin(req, res, next) {
  if (req.authType === "events") return sendError(res, 403, "无权限");
  if (req.permissions?.isAdmin) return next();
  return sendError(res, 403, "无权限");
}

/**
 * Block Events Token on routes that remain local-user only (e.g. /api/users reads).
 */
function requireLocalUser(req, res, next) {
  if (req.authType === "events") return sendError(res, 403, "无权限");
  if (req.authType === "local" && req.user) return next();
  return sendError(res, 401, "未登录");
}

module.exports = {
  requireAdmin,
  requireLocalUser
};

