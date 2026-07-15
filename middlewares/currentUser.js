const { pool } = require("../db");

function sendError(res, statusCode, message) {
  return res.status(statusCode).json({ success: false, message });
}

const DB_NAME = process.env.DB_NAME || "huodongxing_db";
let cachedUserColumns = null;

async function getUserColumns() {
  if (cachedUserColumns) return cachedUserColumns;
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME AS name
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [DB_NAME, "users"]
  );
  cachedUserColumns = rows.map((r) => r.name);
  return cachedUserColumns;
}

function sanitizeUser(user, columns) {
  if (!user) return user;
  const out = { ...user };
  if (columns.includes("password")) delete out.password;
  if (columns.includes("password_hash")) delete out.password_hash;
  return out;
}

function parsePermissions(user, columns) {
  const roleCol = columns.includes("role")
    ? "role"
    : columns.includes("user_role")
      ? "user_role"
      : null;

  const isAdminCol = columns.includes("is_admin")
    ? "is_admin"
    : columns.includes("admin")
      ? "admin"
      : null;

  const orgCol = columns.includes("organization_id")
    ? "organization_id"
    : columns.includes("org_id")
      ? "org_id"
      : null;

  const role = roleCol ? user?.[roleCol] : undefined;
  const isAdmin =
    (typeof role === "string" && role.toLowerCase() === "admin") ||
    (isAdminCol ? Boolean(user?.[isAdminCol]) : false);

  const orgId = orgCol ? user?.[orgCol] : undefined;

  return {
    role,
    isAdmin,
    orgId
  };
}

async function attachCurrentUser(req, res, next) {
  try {
    const uid = req.auth?.uid;
    if (uid === undefined || uid === null) return sendError(res, 401, "未登录");

    const columns = await getUserColumns();
    const [rows] = await pool.query("SELECT * FROM users WHERE id = ? LIMIT 1", [uid]);
    if (!rows || rows.length === 0) return sendError(res, 401, "用户不存在或已被删除");

    const user = rows[0];
    req.user = sanitizeUser(user, columns);
    req.permissions = parsePermissions(user, columns);
    return next();
  } catch (err) {
    return sendError(res, 500, err.message || "服务器错误");
  }
}

module.exports = {
  attachCurrentUser
};

