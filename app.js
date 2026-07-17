require("./loadEnv");

const express = require("express");
const cors = require("cors");
const dns = require("dns");

const { ping } = require("./db");
const apiRoutes = require("./routes");
const {
  logStartupExchangeSecretSummary,
  assertExchangeSecretsAtStartup
} = require("./utils/exchangeSecret");

function parseCorsOrigins(raw) {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isPrivateIPv4(ip) {
  // Only handle IPv4 here; if IPv6 we return null
  const parts = String(ip).split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number.parseInt(p, 10));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;

  const [a, b] = nums;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

const app = express();

const isProduction = process.env.NODE_ENV === "production";
const corsOriginsFromEnv = parseCorsOrigins(process.env.CORS_ORIGINS);
const defaultProdOrigins = [
  "https://life-design.me",
  "https://www.life-design.me",
  "https://admin.life-design.me",
  "http://admin.life-design.me"
];
const allowedOrigins = isProduction
  ? corsOriginsFromEnv.length > 0
    ? corsOriginsFromEnv
    : defaultProdOrigins
  : [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:5174",
      ...defaultProdOrigins
    ];

// admin 浏览器直连本服务时需要 CORS（Events Token 走 Authorization Bearer，不带 cookie）
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (!isProduction) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: false,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    exposedHeaders: ["Content-Length"],
    preflightContinue: false,
    optionsSuccessStatus: 204
  })
);

app.use(express.json());

app.get("/", (req, res) => {
  return res.json({
    success: true,
    data: {
      name: "huodongxing-backend",
      health: "/health",
      apiBase: "/api"
    }
  });
});

app.get("/health", async (req, res) => {
  const host = process.env.DB_HOST || "127.0.0.1";
  const port = Number(process.env.DB_PORT || 3306);
  const verbose = String(req.query.verbose || "") === "1";

  try {
    await ping();
    return res.json({
      success: true,
      data: verbose
        ? {
            db: "up",
            host,
            port,
            pid: process.pid,
            uptime: process.uptime()
          }
        : { db: "up", pid: process.pid, uptime: process.uptime() }
    });
  } catch (err) {
    // Best-effort DNS diagnose (non-blocking / non-fatal)
    const dnsResult = await new Promise((resolve) => {
      dns.lookup(host, (e, address, family) => {
        if (e) return resolve({ ok: false, code: e.code || "DNS_FAIL", message: e.message });
        return resolve({ ok: true, address, family, isPrivateIPv4: isPrivateIPv4(address) });
      });
    });

    const code = err?.code || "DB_FAIL";
    const message = err?.message || "UNKNOWN_ERROR";

    const hint =
      dnsResult?.ok && dnsResult?.isPrivateIPv4 === true
        ? "DB_HOST 解析到内网 IP（如 10.* / 172.16-31.* / 192.168.*），你本机通常无法直连；请改用 RDS 公网地址或通过 VPN/堡垒机/同 VPC 部署后端，并确保白名单放行你的公网 IP。"
        : "请确认：RDS 已开启可达地址（公网或同 VPC）、安全组/白名单放行你的来源 IP、端口 3306 可达。";

    return res.status(500).json({
      success: false,
      message: `数据库不可用: ${code}`,
      data:
        process.env.NODE_ENV === "production" && !verbose
          ? undefined
          : {
              db: "down",
              host,
              port,
              pid: process.pid,
              uptime: process.uptime(),
              dns: dnsResult,
              hint,
              error: { code, message }
            }
    });
  }
});

app.use("/api", apiRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: "NOT_FOUND" });
});

// Error handler
app.use((err, req, res, next) => {
  const status = err.statusCode || err.status || 500;
  res.status(status).json({ success: false, message: err.message || "服务器错误" });
});

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "127.0.0.1";

assertExchangeSecretsAtStartup();
logStartupExchangeSecretSummary();

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);

  // Startup DB probe (log only; health endpoint is the real signal)
  ping()
    .then(() => console.log("DB connected"))
    .catch((e) => console.error("DB connect failed", e?.code || e?.message || e));
});
