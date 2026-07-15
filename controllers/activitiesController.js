const { pool } = require("../db");

function sendError(res, statusCode, message) {
  return res.status(statusCode).json({ success: false, message });
}

function toInt(value) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : NaN;
}

function parsePagination(query) {
  const pageRaw = query.page ?? 1;
  const pageSizeRaw = query.pageSize ?? 10;

  let page = Number.parseInt(String(pageRaw), 10);
  let pageSize = Number.parseInt(String(pageSizeRaw), 10);

  if (!Number.isFinite(page) || page <= 0) page = 1;
  if (!Number.isFinite(pageSize) || pageSize <= 0) pageSize = 10;
  if (pageSize > 100) pageSize = 100;

  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset, limit: pageSize };
}

const TABLE = "activities";
const DB_NAME = process.env.DB_NAME || "huodongxing_db";
let cachedColumns = null;
let cachedRegistrationsColumns = null;

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

async function getRegistrationsColumns() {
  if (cachedRegistrationsColumns) return cachedRegistrationsColumns;
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME AS name
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [DB_NAME, "activity_registrations"]
  );
  cachedRegistrationsColumns = rows.map((r) => r.name);
  return cachedRegistrationsColumns;
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

async function listActivities(req, res) {
  try {
    const { page, pageSize, offset, limit } = parsePagination(req.query || {});
    const columns = await getColumns();

    const status = req.query?.status;
    const keyword = typeof req.query?.keyword === "string" ? req.query.keyword.trim() : "";

    const where = [];
    const params = [];

    // 只有当表里确实存在这些字段时，才启用筛选（避免猜字段名）
    if (
      status !== undefined &&
      status !== null &&
      String(status).trim() !== "" &&
      columns.includes("status")
    ) {
      where.push("`status` = ?");
      params.push(status);
    }

    const keywordColumn = columns.includes("title")
      ? "title"
      : columns.includes("name")
        ? "name"
        : null;

    if (keyword && keywordColumn) {
      where.push(`\`${keywordColumn}\` LIKE ?`);
      params.push(`%${keyword}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [[countRow]] = await pool.query(
      `SELECT COUNT(*) AS total FROM ${TABLE} ${whereSql}`,
      params
    );

    const [rows] = await pool.query(
      `SELECT * FROM ${TABLE}
      ${whereSql}
      ORDER BY id DESC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return res.json({
      success: true,
      data: {
        list: rows,
        total: Number(countRow?.total || 0),
        page,
        pageSize
      }
    });
  } catch (err) {
    return sendError(res, 500, err.message || "服务器错误");
  }
}

async function getActivityById(req, res) {
  try {
    const id = toInt(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return sendError(res, 400, "参数 id 无效");

    const [rows] = await pool.query(`SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`, [id]);
    if (!rows || rows.length === 0) return sendError(res, 404, "活动不存在");
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    return sendError(res, 500, err.message || "服务器错误");
  }
}

async function createActivity(req, res) {
  try {
    const columns = await getColumns();
    const picked = pickBodyColumns(req.body, columns);
    const data = filterWritableForCreate(picked);
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
    return res.status(201).json({ success: true, data: rows[0] || { id: newId } });
  } catch (err) {
    return sendError(res, 500, err.message || "服务器错误");
  }
}

async function updateActivity(req, res) {
  try {
    const id = toInt(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return sendError(res, 400, "参数 id 无效");

    const columns = await getColumns();
    const picked = pickBodyColumns(req.body, columns);
    const data = filterWritableForUpdate(picked);
    const keys = Object.keys(data);
    if (keys.length === 0) return sendError(res, 400, "没有可更新的字段");

    const sets = keys.map((k) => `${k} = ?`).join(", ");
    const values = keys.map((k) => data[k]);
    values.push(id);

    const [result] = await pool.execute(`UPDATE ${TABLE} SET ${sets} WHERE id = ?`, values);
    if (result.affectedRows === 0) return sendError(res, 404, "活动不存在");

    const [rows] = await pool.query(`SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`, [id]);
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    return sendError(res, 500, err.message || "服务器错误");
  }
}

async function deleteActivity(req, res) {
  try {
    const id = toInt(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return sendError(res, 400, "参数 id 无效");

    // 删除保护：已有报名的活动禁止删除（不改表结构，运行时探测字段）
    const regCols = await getRegistrationsColumns();
    if (!regCols.includes("activity_id")) {
      return sendError(res, 500, "报名表缺少 activity_id，无法执行删除保护");
    }

    const [[countRow]] = await pool.query(
      "SELECT COUNT(*) AS total FROM activity_registrations WHERE activity_id = ?",
      [id]
    );
    const total = Number(countRow?.total || 0);
    if (total > 0) {
      return sendError(res, 409, "该活动已有报名记录，禁止删除");
    }

    const [result] = await pool.execute(`DELETE FROM ${TABLE} WHERE id = ?`, [id]);
    if (result.affectedRows === 0) return sendError(res, 404, "活动不存在");
    return res.json({ success: true, data: { id } });
  } catch (err) {
    return sendError(res, 500, err.message || "服务器错误");
  }
}

module.exports = {
  listActivities,
  getActivityById,
  createActivity,
  updateActivity,
  deleteActivity,

  // 兼容现有 routes/activities.js
  list: listActivities,
  getById: getActivityById,
  create: createActivity,
  updateById: updateActivity,
  deleteById: deleteActivity
};
