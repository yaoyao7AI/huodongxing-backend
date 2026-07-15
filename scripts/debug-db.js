#!/usr/bin/env node
/**
 * 直连 MySQL 调试脚本（绕过 health / dns.lookup / 项目封装）。
 *
 * 用法：
 *   node -r ./loadEnv scripts/debug-db.js
 */
"use strict";

const mysql = require("mysql2/promise");

async function main() {
  const config = {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "huodongxing_db",
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 8000)
  };

  console.log("== Process ==");
  console.log({ pid: process.pid, uptime: process.uptime() });

  console.log("\n== DB config (no password) ==");
  console.log({
    host: JSON.stringify(config.host),
    port: config.port,
    user: config.user,
    database: config.database,
    hasPassword: Boolean(config.password),
    connectTimeout: config.connectTimeout
  });

  let conn = null;
  try {
    console.log("\n== Connecting via mysql.createConnection() ==");
    conn = await mysql.createConnection(config);
    const [rows] = await conn.query("SELECT 1 AS ok");
    console.log("CONNECT: SUCCESS");
    console.log("SELECT 1 =>", rows);
    process.exitCode = 0;
  } catch (err) {
    console.log("CONNECT: FAILED");
    console.log("== Error detail ==");
    console.log({
      name: err && err.name,
      message: err && err.message,
      code: err && err.code,
      errno: err && err.errno,
      syscall: err && err.syscall,
      hostname: err && err.hostname,
      address: err && err.address,
      port: err && err.port,
      fatal: err && err.fatal
    });
    if (err && err.stack) {
      console.log("\n== Stack ==");
      console.log(err.stack);
    }
    process.exitCode = 1;
  } finally {
    if (conn) {
      try {
        await conn.end();
      } catch {
        // ignore
      }
    }
  }
}

main();
