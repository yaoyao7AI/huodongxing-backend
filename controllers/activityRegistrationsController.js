const { pool } = require("../db");

function sendError(res, statusCode, message) {
  return res.status(statusCode).json({ success: false, message });
}

function toInt(value) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : NaN;
}

const TABLE = "activity_registrations";
const DB_NAME = process.env.DB_NAME || "huodongxing_db";
let cachedColumns = null;
let cachedActivitiesColumns = null;

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

function pickBodyColumns(body, columns) {
  const result = {};
  if (!body || typeof body !== "object") return result;
  for (const key of Object.keys(body)) {
    if (columns.includes(key)) result[key] = body[key];
  }
  return result;
}

function getRegistrationActivityIdColumn(columns) {
  if (columns.includes("activity_id")) return "activity_id";
  return null;
}

function getRegistrationPhoneColumn(columns) {
  if (columns.includes("user_phone")) return "user_phone";
  if (columns.includes("phone")) return "phone";
  if (columns.includes("mobile")) return "mobile";
  return null;
}

async function assertActivityCanRegister(conn, activityId) {
  const activitiesColumns = await getActivitiesColumns();
  const hasStatus = activitiesColumns.includes("status");

  const [rows] = await conn.query(
    hasStatus
      ? "SELECT id, status FROM activities WHERE id = ? LIMIT 1"
      : "SELECT id FROM activities WHERE id = ? LIMIT 1",
    [activityId]
  );

  if (!rows || rows.length === 0) {
    return { ok: false, statusCode: 404, message: "活动不存在" };
  }

  if (!hasStatus) {
    return { ok: true };
  }

  const status = rows[0].status;
  if (status === "draft") return { ok: false, statusCode: 409, message: "活动未发布，暂不可报名" };
  if (status === "ended") return { ok: false, statusCode: 409, message: "活动已结束，暂不可报名" };

  return { ok: true };
}

function buildRegLockKey(activityId, phone) {
  // MySQL 8: GET_LOCK name max length is 64
  const raw = `hx:reg:${String(activityId)}:${String(phone)}`;
  return raw.length <= 64 ? raw : raw.slice(0, 64);
}

async function acquireLock(conn, lockKey, timeoutSeconds = 3) {
  const [[row]] = await conn.query("SELECT GET_LOCK(?, ?) AS ok", [lockKey, timeoutSeconds]);
  return row && row.ok === 1;
}

async function releaseLock(conn, lockKey) {
  try {
    await conn.query("SELECT RELEASE_LOCK(?)", [lockKey]);
  } catch {
    // ignore
  }
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

async function listActivityRegistrations(req, res) {
  try {
    const [rows] = await pool.query(`SELECT * FROM ${TABLE} ORDER BY id DESC`);
    return res.json({ success: true, data: rows });
  } catch (err) {
    return sendError(res, 500, err.message || "服务器错误");
  }
}

async function getActivityRegistrationById(req, res) {
  try {
    const id = toInt(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return sendError(res, 400, "参数 id 无效");

    const [rows] = await pool.query(`SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`, [id]);
    if (!rows || rows.length === 0) return sendError(res, 404, "报名记录不存在");
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    return sendError(res, 500, err.message || "服务器错误");
  }
}

async function createActivityRegistration(req, res) {
  const conn = await pool.getConnection();
  let lockKey = null;
  try {
    const columns = await getColumns();
    const activityIdCol = getRegistrationActivityIdColumn(columns);
    const phoneCol = getRegistrationPhoneColumn(columns);

    const picked = pickBodyColumns(req.body, columns);
    const data = filterWritableForCreate(picked);

    // 强校验：如果表里有这些列，就要求必填
    if (activityIdCol) {
      const activityId = data[activityIdCol];
      if (activityId === undefined || activityId === null || String(activityId).trim() === "") {
        return sendError(res, 400, `${activityIdCol} 不能为空`);
      }
    }
    if (phoneCol) {
      const phone = data[phoneCol];
      if (phone === undefined || phone === null || String(phone).trim() === "") {
        return sendError(res, 400, `${phoneCol} 不能为空`);
      }
      data[phoneCol] = String(phone).trim();
    }

    // 并发去重：使用 MySQL GET_LOCK 做互斥（不依赖唯一索引）
    if (activityIdCol && phoneCol) {
      lockKey = buildRegLockKey(data[activityIdCol], data[phoneCol]);
      const locked = await acquireLock(conn, lockKey, 3);
      if (!locked) {
        return sendError(res, 409, "报名处理中，请稍后重试");
      }
    }

    await conn.beginTransaction();

    // 活动状态控制：draft/ended 不可报名；activity 不存在返回 404
    if (activityIdCol) {
      const check = await assertActivityCanRegister(conn, data[activityIdCol]);
      if (!check.ok) {
        await conn.rollback();
        return sendError(res, check.statusCode, check.message);
      }
    }

    // 报名去重：同一 activity + 手机号 只能报名一次（事务内再次确认）
    if (activityIdCol && phoneCol) {
      const [dupRows] = await conn.query(
        `SELECT id FROM ${TABLE} WHERE \`${activityIdCol}\` = ? AND \`${phoneCol}\` = ? LIMIT 1`,
        [data[activityIdCol], data[phoneCol]]
      );
      if (dupRows && dupRows.length > 0) {
        await conn.rollback();
        return sendError(res, 409, "该手机号已报名该活动");
      }
    }

    const keys = Object.keys(data);
    if (keys.length === 0) {
      await conn.rollback();
      return sendError(res, 400, "没有可写入的字段");
    }

    const placeholders = keys.map(() => "?").join(", ");
    const values = keys.map((k) => data[k]);

    const [result] = await conn.execute(
      `INSERT INTO ${TABLE} (${keys.join(", ")}) VALUES (${placeholders})`,
      values
    );

    const newId = result.insertId;
    const [rows] = await conn.query(`SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`, [newId]);

    await conn.commit();
    return res.status(201).json({ success: true, data: rows[0] || { id: newId } });
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      // ignore
    }
    return sendError(res, 500, err.message || "服务器错误");
  } finally {
    if (lockKey) await releaseLock(conn, lockKey);
    conn.release();
  }
}

async function updateActivityRegistration(req, res) {
  const conn = await pool.getConnection();
  let lockKey = null;
  try {
    const id = toInt(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return sendError(res, 400, "参数 id 无效");

    const columns = await getColumns();
    const activityIdCol = getRegistrationActivityIdColumn(columns);
    const phoneCol = getRegistrationPhoneColumn(columns);

    const picked = pickBodyColumns(req.body, columns);
    const data = filterWritableForUpdate(picked);

    // 更新时：如果传入了手机号字段，要求非空并 trim
    if (phoneCol && data[phoneCol] !== undefined) {
      const phone = data[phoneCol];
      if (phone === null || String(phone).trim() === "") {
        return sendError(res, 400, `${phoneCol} 不能为空`);
      }
      data[phoneCol] = String(phone).trim();
    }

    const keys = Object.keys(data);
    if (keys.length === 0) return sendError(res, 400, "没有可更新的字段");

    // 若更新涉及 activity_id/手机号，做并发安全去重：GET_LOCK + 事务内再确认
    if (activityIdCol && phoneCol && (data[activityIdCol] !== undefined || data[phoneCol] !== undefined)) {
      // 先读当前记录（用于计算下一组唯一键）
      const [currentRows] = await conn.query(`SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`, [id]);
      if (!currentRows || currentRows.length === 0) return sendError(res, 404, "报名记录不存在");

      const current = currentRows[0];
      const nextActivityId =
        data[activityIdCol] !== undefined ? data[activityIdCol] : current[activityIdCol];
      const nextPhone = data[phoneCol] !== undefined ? data[phoneCol] : current[phoneCol];

      if (nextActivityId !== undefined && nextPhone !== undefined && String(nextPhone).trim() !== "") {
        lockKey = buildRegLockKey(nextActivityId, String(nextPhone).trim());
        const locked = await acquireLock(conn, lockKey, 3);
        if (!locked) return sendError(res, 409, "报名处理中，请稍后重试");
      }

      await conn.beginTransaction();

      // 活动状态控制：仅当传入新的 activity_id 时校验
      if (activityIdCol && data[activityIdCol] !== undefined) {
        const activityId = data[activityIdCol];
        if (activityId === null || String(activityId).trim() === "") {
          await conn.rollback();
          return sendError(res, 400, `${activityIdCol} 不能为空`);
        }
        const check = await assertActivityCanRegister(conn, activityId);
        if (!check.ok) {
          await conn.rollback();
          return sendError(res, check.statusCode, check.message);
        }
      }

      // 事务内再确认：排除自己
      if (nextActivityId !== undefined && nextPhone !== undefined && String(nextPhone).trim() !== "") {
        const [dupRows] = await conn.query(
          `SELECT id FROM ${TABLE}
           WHERE \`${activityIdCol}\` = ? AND \`${phoneCol}\` = ? AND id <> ?
           LIMIT 1`,
          [nextActivityId, String(nextPhone).trim(), id]
        );
        if (dupRows && dupRows.length > 0) {
          await conn.rollback();
          return sendError(res, 409, "该手机号已报名该活动");
        }
      }

      const sets = keys.map((k) => `${k} = ?`).join(", ");
      const values = keys.map((k) => data[k]);
      values.push(id);

      const [result] = await conn.execute(`UPDATE ${TABLE} SET ${sets} WHERE id = ?`, values);
      if (result.affectedRows === 0) {
        await conn.rollback();
        return sendError(res, 404, "报名记录不存在");
      }

      const [rows] = await conn.query(`SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`, [id]);
      await conn.commit();
      return res.json({ success: true, data: rows[0] });
    }

    // 不涉及去重字段的普通更新
    if (activityIdCol && data[activityIdCol] !== undefined) {
      const activityId = data[activityIdCol];
      if (activityId === null || String(activityId).trim() === "") {
        return sendError(res, 400, `${activityIdCol} 不能为空`);
      }
      const check = await assertActivityCanRegister(conn, activityId);
      if (!check.ok) return sendError(res, check.statusCode, check.message);
    }

    const sets = keys.map((k) => `${k} = ?`).join(", ");
    const values = keys.map((k) => data[k]);
    values.push(id);

    const [result] = await conn.execute(`UPDATE ${TABLE} SET ${sets} WHERE id = ?`, values);
    if (result.affectedRows === 0) return sendError(res, 404, "报名记录不存在");

    const [rows] = await conn.query(`SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`, [id]);
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      // ignore
    }
    return sendError(res, 500, err.message || "服务器错误");
  } finally {
    if (lockKey) await releaseLock(conn, lockKey);
    conn.release();
  }
}

async function deleteActivityRegistration(req, res) {
  try {
    const id = toInt(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return sendError(res, 400, "参数 id 无效");

    const [result] = await pool.execute(`DELETE FROM ${TABLE} WHERE id = ?`, [id]);
    if (result.affectedRows === 0) return sendError(res, 404, "报名记录不存在");
    return res.json({ success: true, data: { id } });
  } catch (err) {
    return sendError(res, 500, err.message || "服务器错误");
  }
}

module.exports = {
  listActivityRegistrations,
  getActivityRegistrationById,
  createActivityRegistration,
  updateActivityRegistration,
  deleteActivityRegistration,

  // 兼容现有 routes/activity_registrations.js
  list: listActivityRegistrations,
  getById: getActivityRegistrationById,
  create: createActivityRegistration,
  updateById: updateActivityRegistration,
  deleteById: deleteActivityRegistration
};
