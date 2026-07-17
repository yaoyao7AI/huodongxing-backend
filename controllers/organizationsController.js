const { pool } = require("../db");

const DB_NAME = process.env.DB_NAME || "huodongxing_db";
let cachedActivitiesColumns = null;

function sendError(res, statusCode, message) {
  return res.status(statusCode).json({ success: false, message });
}

async function getActivitiesColumns() {
  if (cachedActivitiesColumns) return cachedActivitiesColumns;
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME AS name
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [DB_NAME, "activities"]
  );
  cachedActivitiesColumns = rows.map((r) => r.name);
  return cachedActivitiesColumns;
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

async function listOrganizations(req, res) {
  try {
    const { page, pageSize, offset, limit } = parsePagination(req.query || {});
    const status = req.query?.status;
    const keyword = typeof req.query?.keyword === "string" ? req.query.keyword.trim() : "";

    const where = [];
    const params = [];

    if (status !== undefined && status !== null && String(status).trim() !== "") {
      where.push("status = ?");
      params.push(status);
    }
    if (keyword) {
      where.push("name LIKE ?");
      params.push(`%${keyword}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [[countRow]] = await pool.query(
      `SELECT COUNT(*) AS total FROM organizations ${whereSql}`,
      params
    );

    const [rows] = await pool.query(
      `SELECT
        id, name, status, address, admin_name, admin_phone, created_at, updated_at
      FROM organizations
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

async function getOrganizationById(req, res) {
  try {
    const id = toInt(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return sendError(res, 400, "参数 id 无效");
    }

    const [rows] = await pool.query(
      `SELECT
        id, name, status, address, admin_name, admin_phone, created_at, updated_at
      FROM organizations
      WHERE id = ?
      LIMIT 1`,
      [id]
    );

    if (!rows || rows.length === 0) {
      return sendError(res, 404, "主办方不存在");
    }

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    return sendError(res, 500, err.message || "服务器错误");
  }
}

async function createOrganization(req, res) {
  try {
    const { name, status, address, admin_name, admin_phone } = req.body || {};

    if (!name || typeof name !== "string" || !name.trim()) {
      return sendError(res, 400, "name 不能为空");
    }

    const [result] = await pool.execute(
      `INSERT INTO organizations
        (name, status, address, admin_name, admin_phone, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        name.trim(),
        status ?? null,
        address ?? null,
        admin_name ?? null,
        admin_phone ?? null
      ]
    );

    const newId = result.insertId;
    const [rows] = await pool.query(
      `SELECT
        id, name, status, address, admin_name, admin_phone, created_at, updated_at
      FROM organizations
      WHERE id = ?
      LIMIT 1`,
      [newId]
    );

    return res.status(201).json({ success: true, data: rows[0] || { id: newId } });
  } catch (err) {
    return sendError(res, 500, err.message || "服务器错误");
  }
}

async function updateOrganization(req, res) {
  try {
    const id = toInt(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return sendError(res, 400, "参数 id 无效");
    }

    const { name, status, address, admin_name, admin_phone } = req.body || {};

    const fields = [];
    const values = [];

    if (name !== undefined) {
      if (name === null || typeof name !== "string" || !name.trim()) {
        return sendError(res, 400, "name 不能为空");
      }
      fields.push("name = ?");
      values.push(name.trim());
    }
    if (status !== undefined) {
      fields.push("status = ?");
      values.push(status);
    }
    if (address !== undefined) {
      fields.push("address = ?");
      values.push(address);
    }
    if (admin_name !== undefined) {
      fields.push("admin_name = ?");
      values.push(admin_name);
    }
    if (admin_phone !== undefined) {
      fields.push("admin_phone = ?");
      values.push(admin_phone);
    }

    if (fields.length === 0) {
      return sendError(res, 400, "没有可更新的字段");
    }

    fields.push("updated_at = NOW()");
    values.push(id);

    const [result] = await pool.execute(
      `UPDATE organizations
      SET ${fields.join(", ")}
      WHERE id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return sendError(res, 404, "主办方不存在");
    }

    const [rows] = await pool.query(
      `SELECT
        id, name, status, address, admin_name, admin_phone, created_at, updated_at
      FROM organizations
      WHERE id = ?
      LIMIT 1`,
      [id]
    );

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    return sendError(res, 500, err.message || "服务器错误");
  }
}

async function deleteOrganization(req, res) {
  try {
    const id = toInt(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return sendError(res, 400, "参数 id 无效");
    }

    // 删除保护：有关联活动时返回 409（运行时探测 organization_id / org_id）
    const activityCols = await getActivitiesColumns();
    const orgFk = activityCols.includes("organization_id")
      ? "organization_id"
      : activityCols.includes("org_id")
        ? "org_id"
        : null;

    if (orgFk) {
      const [[countRow]] = await pool.query(
        `SELECT COUNT(*) AS total FROM activities WHERE \`${orgFk}\` = ?`,
        [id]
      );
      const total = Number(countRow?.total || 0);
      if (total > 0) {
        return sendError(res, 409, "该主办方存在关联活动，禁止删除");
      }
    } else {
      console.warn(
        "[organizations] activities 表无 organization_id/org_id，跳过关联检查后硬删",
        { id }
      );
    }

    const [result] = await pool.execute(`DELETE FROM organizations WHERE id = ?`, [id]);
    if (result.affectedRows === 0) {
      return sendError(res, 404, "主办方不存在");
    }

    return res.json({ success: true, data: { id } });
  } catch (err) {
    return sendError(res, 500, err.message || "服务器错误");
  }
}

module.exports = {
  // 按你要求的命名导出
  listOrganizations,
  getOrganizationById,
  createOrganization,
  updateOrganization,
  deleteOrganization,

  // 兼容现有 routes/organizations.js 的调用方式（不改路由文件）
  list: listOrganizations,
  getById: getOrganizationById,
  create: createOrganization,
  updateById: updateOrganization,
  deleteById: deleteOrganization
};
