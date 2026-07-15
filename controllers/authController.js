const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { pool } = require("../db");

function sendError(res, statusCode, message) {
  return res.status(statusCode).json({ success: false, message });
}

const TABLE = "users";
const DB_NAME = process.env.DB_NAME || "huodongxing_db";
let cachedColumns = null;

async function getUserColumns() {
  if (cachedColumns) return cachedColumns;
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME AS name
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [DB_NAME, TABLE]
  );
  cachedColumns = rows.map((r) => r.name);
  return cachedColumns;
}

function base64UrlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signToken(payloadObj) {
  const secret = process.env.AUTH_SECRET || "dev-secret";
  const payload = base64UrlEncode(JSON.stringify(payloadObj));
  const sig = crypto.createHmac("sha256", secret).update(payload).digest();
  return `${payload}.${base64UrlEncode(sig)}`;
}

function sanitizeUser(user, columns) {
  if (!user) return user;
  const out = { ...user };
  if (columns.includes("password")) delete out.password;
  if (columns.includes("password_hash")) delete out.password_hash;
  return out;
}

async function login(req, res) {
  try {
    const { password, phone, mobile, username, email, login: loginValue } = req.body || {};
    if (!password || typeof password !== "string") {
      return sendError(res, 400, "password 不能为空");
    }

    const columns = await getUserColumns();

    const identifierPriority = ["phone", "mobile", "username", "email"];
    const identifierColumn = identifierPriority.find((c) => columns.includes(c));
    if (!identifierColumn) {
      return sendError(res, 500, "users 表缺少登录标识字段（phone/mobile/username/email）");
    }

    const identifier =
      (identifierColumn === "phone" ? phone : undefined) ??
      (identifierColumn === "mobile" ? mobile : undefined) ??
      (identifierColumn === "username" ? username : undefined) ??
      (identifierColumn === "email" ? email : undefined) ??
      loginValue;

    if (identifier === undefined || identifier === null || String(identifier).trim() === "") {
      return sendError(res, 400, `${identifierColumn} 不能为空`);
    }

    const passwordColumn = columns.includes("password")
      ? "password"
      : columns.includes("password_hash")
        ? "password_hash"
        : null;

    if (!passwordColumn) {
      return sendError(res, 500, "users 表缺少密码字段（password 或 password_hash）");
    }

    const [rows] = await pool.query(
      `SELECT * FROM ${TABLE} WHERE \`${identifierColumn}\` = ? LIMIT 1`,
      [identifier]
    );

    if (!rows || rows.length === 0) {
      return sendError(res, 401, "账号或密码错误");
    }

    const user = rows[0];
    const hash = user[passwordColumn];
    if (!hash || typeof hash !== "string") {
      return sendError(res, 401, "账号或密码错误");
    }

    const ok = await bcrypt.compare(password, hash);
    if (!ok) {
      return sendError(res, 401, "账号或密码错误");
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const ttlSec = Number.parseInt(String(process.env.AUTH_TOKEN_TTL_SECONDS || 7 * 24 * 3600), 10);
    const exp = nowSec + (Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec : 7 * 24 * 3600);

    const token = signToken({ uid: user.id, iat: nowSec, exp });
    return res.json({
      success: true,
      data: {
        token,
        user: sanitizeUser(user, columns)
      }
    });
  } catch (err) {
    return sendError(res, 500, err.message || "服务器错误");
  }
}

async function me(req, res) {
  try {
    if (req.authType === "events") {
      return res.json({
        success: true,
        data: {
          user: req.user,
          permissions: req.permissions?.codes || [],
          authType: "events"
        }
      });
    }

    // 若已由 attachCurrentUser / authenticate 注入，则直接返回（避免重复查询）
    if (req.user) {
      return res.json({
        success: true,
        data: { user: req.user, permissions: req.permissions, authType: req.authType || "local" }
      });
    }

    const uid = req.auth?.uid;
    if (uid === undefined || uid === null) return sendError(res, 401, "未登录");

    const columns = await getUserColumns();
    const [rows] = await pool.query(`SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`, [uid]);
    if (!rows || rows.length === 0) return sendError(res, 401, "用户不存在或已被删除");

    return res.json({ success: true, data: { user: sanitizeUser(rows[0], columns) } });
  } catch (err) {
    return sendError(res, 500, err.message || "服务器错误");
  }
}

module.exports = {
  login,
  me
};

