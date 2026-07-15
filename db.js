const mysql = require("mysql2/promise");

function buildPoolConfig() {
  return {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "huodongxing_db",
    // Fail faster on unreachable DB (default can be quite long)
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 8000),
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
    queueLimit: 0
  };
}

// Single stable pool instance. mysql2 pools are lazy: every getConnection()
// re-resolves DNS and opens a fresh TCP connection, so there is NO cached
// "down" state — a transient startup failure recovers on the next call.
const pool = mysql.createPool(buildPoolConfig());

function isConnectionLevelError(err) {
  const code = err && err.code;
  return (
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN" ||
    code === "PROTOCOL_CONNECTION_LOST"
  );
}

async function runSelectOne() {
  const conn = await pool.getConnection();
  try {
    await conn.query("SELECT 1");
  } finally {
    conn.release();
  }
}

/**
 * Real-time DB health check. Runs `SELECT 1` on a fresh pooled connection
 * every call (no cached state). On a transient connection-level failure it
 * retries once before surfacing the error.
 */
async function healthcheck() {
  try {
    await runSelectOne();
  } catch (err) {
    if (!isConnectionLevelError(err)) throw err;
    await runSelectOne();
  }
}

async function ping() {
  return healthcheck();
}

module.exports = {
  pool,
  healthcheck,
  ping
};
