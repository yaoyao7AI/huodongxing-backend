const { pool } = require("../db");
const bcrypt = require("bcrypt");

function sendError(res, statusCode, message) {
  return res.status(statusCode).json({ success: false, message });
}

function toInt(value) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : NaN;
}

const TABLE = "users";
const DB_NAME = process.env.DB_NAME || "huodongxing_db";
let cachedColumns = null;

async function getColumns() {
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

function getPasswordColumn(columns) {
  if (columns.includes("password")) return "password";
  if (columns.includes("password_hash")) return "password_hash";
  return null;
}

function sanitizeUser(user, columns) {
  if (!user) return user;
  const out = { ...user };
  if (columns.includes("password")) delete out.password;
  if (columns.includes("password_hash")) delete out.password_hash;
  return out;
}

function pickBodyColumns(body, columns) {
  const result = {};
  if (!body || typeof body !== "object") return result;
  for (const key of Object.keys(body)) {
    if (columns.includes(key)) result[key] = body[key];
  }
  return result;
}

function filterWritableForCreate(obj) {
  const out = { ...obj };
  delete out.id;
  delete out.created_at;
  delete out.updated_at;
  return out;
}

function filterWritableForUpdate(obj) {
  const out = { ...obj };
  delete out.id;
  delete out.created_at;
  return out;
}

async function listUsers(req, res) {
  try {
    const columns = await getColumns();
    const [rows] = await pool.query(`SELECT * FROM ${TABLE} ORDER BY id DESC`);
    return res.json({ success: true, data: rows.map((r) => sanitizeUser(r, columns)) });
  } catch (err) {
    return sendError(res, 500, err.message || "服务器错误");
  }
}

async function getUserById(req, res) {
  try {
    const id = toInt(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return sendError(res, 400, "参数 id 无效");

    const columns = await getColumns();
    const [rows] = await pool.query(`SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`, [id]);
    if (!rows || rows.length === 0) return sendError(res, 404, "用户不存在");
    return res.json({ success: true, data: sanitizeUser(rows[0], columns) });
  } catch (err) {
    return sendError(res, 500, err.message || "服务器错误");
  }
}

async function createUser(req, res) {
  try {
    const columns = await getColumns();
    const passwordColumn = getPasswordColumn(columns);

    const picked = pickBodyColumns(req.body, columns);
    const data = filterWritableForCreate(picked);

    if (passwordColumn && data[passwordColumn] !== undefined) {
      if (data[passwordColumn] === null || String(data[passwordColumn]).trim() === "") {
        return sendError(res, 400, `${passwordColumn} 不能为空`);
      }
      data[passwordColumn] = await bcrypt.hash(String(data[passwordColumn]), 10);
    }

    const keys = Object.keys(data);
    if (keys.length === 0) return sendError(res, 400, "没有可写入的字段");

    const placeholders = keys.map(() => "?").join(", ");
    const values = keys.map((k) => data[k]);

    const [result] = await pool.execute(
      `INSERT INTO ${TABLE} (${keys.join(", ")}) VALUES (${placeholders})`,
      values
    );

    const newId = result.insertId;
    const [rows] = await pool.query(`SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`, [newId]);
    return res
      .status(201)
      .json({ success: true, data: sanitizeUser(rows[0] || { id: newId }, columns) });
  } catch (err) {
    return sendError(res, 500, err.message || "服务器错误");
  }
}

async function updateUser(req, res) {
  try {
    const id = toInt(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return sendError(res, 400, "参数 id 无效");

    const columns = await getColumns();
    const passwordColumn = getPasswordColumn(columns);

    const picked = pickBodyColumns(req.body, columns);
    const data = filterWritableForUpdate(picked);

    if (passwordColumn && data[passwordColumn] !== undefined) {
      if (data[passwordColumn] === null || String(data[passwordColumn]).trim() === "") {
        return sendError(res, 400, `${passwordColumn} 不能为空`);
      }
      data[passwordColumn] = await bcrypt.hash(String(data[passwordColumn]), 10);
    }

    const keys = Object.keys(data);
    if (keys.length === 0) return sendError(res, 400, "没有可更新的字段");

    const sets = keys.map((k) => `${k} = ?`).join(", ");
    const values = keys.map((k) => data[k]);
    values.push(id);

    const [result] = await pool.execute(`UPDATE ${TABLE} SET ${sets} WHERE id = ?`, values);
    if (result.affectedRows === 0) return sendError(res, 404, "用户不存在");

    const [rows] = await pool.query(`SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`, [id]);
    return res.json({ success: true, data: sanitizeUser(rows[0], columns) });
  } catch (err) {
    return sendError(res, 500, err.message || "服务器错误");
  }
}

async function deleteUser(req, res) {
  try {
    const id = toInt(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return sendError(res, 400, "参数 id 无效");

    const [result] = await pool.execute(`DELETE FROM ${TABLE} WHERE id = ?`, [id]);
    if (result.affectedRows === 0) return sendError(res, 404, "用户不存在");
    return res.json({ success: true, data: { id } });
  } catch (err) {
    return sendError(res, 500, err.message || "服务器错误");
  }
}

module.exports = {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,

  // 兼容现有 routes/users.js
  list: listUsers,
  getById: getUserById,
  create: createUser,
  updateById: updateUser,
  deleteById: deleteUser
};
