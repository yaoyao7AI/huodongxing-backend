/**
 * Events Token Exchange 轻量测试（node:assert，无 Jest）。
 *
 * 用法：
 *   node -r ./loadEnv scripts/test-events-exchange.js
 *
 * 会在进程内起临时 HTTP 服务；DB 不可用时跳过依赖 DB 的用例。
 */
"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const express = require("express");

// Ensure secrets before requiring app modules that read env at request time
process.env.EVENTS_EXCHANGE_SECRET =
  process.env.EVENTS_EXCHANGE_SECRET || "test-events-exchange-secret";
process.env.EVENTS_JWT_SECRET = process.env.EVENTS_JWT_SECRET || "test-events-jwt-secret";
process.env.EVENTS_TOKEN_TTL_SECONDS = process.env.EVENTS_TOKEN_TTL_SECONDS || "1800";
process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-auth-secret";

const jwt = require("../utils/jwt");
const jtiStore = require("../utils/jtiStore");
const {
  mapRoleToPermissions,
  EVENT_ADMIN_PERMISSIONS
} = require("../utils/eventsPermissions");
const {
  validateExchangeAssertion,
  EXCHANGE_ISS,
  EXCHANGE_AUD,
  EXCHANGE_TOKEN_TYPE,
  EVENTS_TOKEN_TYPE,
  EVENTS_ISS,
  EVENTS_AUD
} = require("../controllers/eventsExchangeController");
const apiRoutes = require("../routes");
const { ping } = require("../db");

let passed = 0;
let failed = 0;
let skipped = 0;

function ok(name) {
  passed += 1;
  console.log(`  PASS  ${name}`);
}

function fail(name, err) {
  failed += 1;
  console.error(`  FAIL  ${name}`);
  console.error(`        ${err && err.message ? err.message : err}`);
}

function skip(name, reason) {
  skipped += 1;
  console.log(`  SKIP  ${name} (${reason})`);
}

async function test(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (err) {
    fail(name, err);
  }
}

function signAssertion(overrides = {}, secret = process.env.EVENTS_EXCHANGE_SECRET) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: "42",
    role: "event_admin",
    permissions: ["center.events.access"],
    token_type: EXCHANGE_TOKEN_TYPE,
    iss: EXCHANGE_ISS,
    aud: EXCHANGE_AUD,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + 30,
    ...overrides
  };
  return { token: jwt.sign(payload, secret), payload };
}

function request(baseUrl, method, path, { body, token } = {}) {
  const url = new URL(path, baseUrl);
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      { method, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, body: json, raw });
        });
      }
    );
    req.on("error", reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  jtiStore.clear();

  console.log("\n== Unit: jwt / permissions / assertion ==");

  await test("jwt sign/verify roundtrip", () => {
    const token = jwt.sign({ sub: "1", exp: Math.floor(Date.now() / 1000) + 60 }, "s");
    const v = jwt.verify(token, "s");
    assert.equal(v.ok, true);
    assert.equal(v.payload.sub, "1");
  });

  await test("mapRoleToPermissions event_admin", () => {
    const perms = mapRoleToPermissions("event_admin");
    assert.deepEqual(perms, EVENT_ADMIN_PERMISSIONS);
  });

  await test("validateExchangeAssertion rejects content_admin", () => {
    const now = Math.floor(Date.now() / 1000);
    const r = validateExchangeAssertion({
      sub: "1",
      role: "content_admin",
      permissions: ["center.events.access"],
      token_type: EXCHANGE_TOKEN_TYPE,
      iss: EXCHANGE_ISS,
      aud: EXCHANGE_AUD,
      jti: "x",
      iat: now,
      exp: now + 30
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
  });

  await test("verifyExchangeAssertion rejects wrong secret", () => {
    const { token: assertion } = signAssertion();
    const { verifyExchangeAssertion } = require("../controllers/eventsExchangeController");
    const v = verifyExchangeAssertion(assertion, "wrong-secret");
    assert.equal(v.ok, false);
    assert.equal(v.code, "invalid signature");
  });

  await test("verifyExchangeAssertion rejects wrong issuer", () => {
    const { token: assertion } = signAssertion({ iss: "wrong" });
    const { verifyExchangeAssertion } = require("../controllers/eventsExchangeController");
    const v = verifyExchangeAssertion(assertion, process.env.EVENTS_EXCHANGE_SECRET);
    assert.equal(v.ok, false);
    assert.equal(v.code, "jwt issuer invalid");
  });

  await test("verifyExchangeAssertion rejects wrong audience", () => {
    const { token: assertion } = signAssertion({ aud: "wrong" });
    const { verifyExchangeAssertion } = require("../controllers/eventsExchangeController");
    const v = verifyExchangeAssertion(assertion, process.env.EVENTS_EXCHANGE_SECRET);
    assert.equal(v.ok, false);
    assert.equal(v.code, "jwt audience invalid");
  });

  await test("validateExchangeAssertion rejects missing center.events.access", () => {
    const now = Math.floor(Date.now() / 1000);
    const r = validateExchangeAssertion({
      sub: "1",
      role: "event_admin",
      permissions: [],
      token_type: EXCHANGE_TOKEN_TYPE,
      iss: EXCHANGE_ISS,
      aud: EXCHANGE_AUD,
      jti: "y",
      iat: now,
      exp: now + 30
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
  });

  await test("jtiStore consume once", () => {
    const jti = "jti-" + crypto.randomUUID();
    const exp = Math.floor(Date.now() / 1000) + 60;
    assert.equal(jtiStore.consume(jti, exp), true);
    assert.equal(jtiStore.consume(jti, exp), false);
  });

  console.log("\n== HTTP: exchange + route guards ==");

  const app = express();
  app.use(express.json());
  app.use("/api", apiRoutes);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  let eventsToken = null;

  try {
    await test("1) 合法 Assertion 换票成功 (event_admin)", async () => {
      const { token: assertion } = signAssertion();
      const res = await request(baseUrl, "POST", "/api/auth/exchange", {
        body: { assertion }
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.body.data.token);
      assert.equal(res.body.data.expiresIn, 1800);
      assert.equal(res.body.data.user.role, "event_admin");
      assert.ok(res.body.data.permissions.includes("events.organizations.read"));
      eventsToken = res.body.data.token;

      const decoded = jwt.verify(eventsToken, process.env.EVENTS_JWT_SECRET);
      assert.equal(decoded.ok, true);
      assert.equal(decoded.payload.token_type, EVENTS_TOKEN_TYPE);
      assert.equal(decoded.payload.iss, EVENTS_ISS);
      assert.equal(decoded.payload.aud, EVENTS_AUD);
    });

    await test("1b) super_admin Assertion 换票成功", async () => {
      const { token: assertion } = signAssertion({ role: "super_admin", sub: "1" });
      const res = await request(baseUrl, "POST", "/api/auth/exchange", {
        body: { assertion }
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.user.role, "super_admin");
      assert.ok(res.body.data.permissions.includes("events.users.read"));
    });

    await test("2) 缺 center.events.access → 403", async () => {
      const { token: assertion } = signAssertion({ permissions: ["other"] });
      const res = await request(baseUrl, "POST", "/api/auth/exchange", {
        body: { assertion }
      });
      assert.equal(res.status, 403);
    });

    await test("3) role=content_admin → 403", async () => {
      const { token: assertion } = signAssertion({ role: "content_admin" });
      const res = await request(baseUrl, "POST", "/api/auth/exchange", {
        body: { assertion }
      });
      assert.equal(res.status, 403);
    });

    await test("4) 错误 iss/aud/token_type → 401", async () => {
      for (const overrides of [
        { iss: "wrong" },
        { aud: "wrong" },
        { token_type: "admin" }
      ]) {
        const { token: assertion } = signAssertion(overrides);
        const res = await request(baseUrl, "POST", "/api/auth/exchange", {
          body: { assertion }
        });
        assert.equal(res.status, 401, `expected 401 for ${JSON.stringify(overrides)}`);
      }
    });

    await test("4b) 错误 Secret 签名 → 401", async () => {
      const { token: assertion } = signAssertion({}, "wrong-exchange-secret");
      const res = await request(baseUrl, "POST", "/api/auth/exchange", {
        body: { assertion }
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.message, "assertion 签名无效");
    });

    await test("5) 过期 / TTL>60 → 401", async () => {
      const now = Math.floor(Date.now() / 1000);
      const expired = signAssertion({ iat: now - 120, exp: now - 60 });
      const res1 = await request(baseUrl, "POST", "/api/auth/exchange", {
        body: { assertion: expired.token }
      });
      assert.equal(res1.status, 401);

      const tooLong = signAssertion({ iat: now, exp: now + 120 });
      const res2 = await request(baseUrl, "POST", "/api/auth/exchange", {
        body: { assertion: tooLong.token }
      });
      assert.equal(res2.status, 401);
    });

    await test("6) 同一 jti 第二次 exchange → 401", async () => {
      const jti = "replay-" + crypto.randomUUID();
      const { token: assertion } = signAssertion({ jti });
      const res1 = await request(baseUrl, "POST", "/api/auth/exchange", {
        body: { assertion }
      });
      assert.equal(res1.status, 200);
      const res2 = await request(baseUrl, "POST", "/api/auth/exchange", {
        body: { assertion }
      });
      assert.equal(res2.status, 401);
    });

    await test("7) 错误密钥 Token 调 orgs → 401", async () => {
      const now = Math.floor(Date.now() / 1000);
      const fake = jwt.sign(
        {
          sub: "1",
          role: "event_admin",
          token_type: EVENTS_TOKEN_TYPE,
          iss: EVENTS_ISS,
          aud: EVENTS_AUD,
          permissions: EVENT_ADMIN_PERMISSIONS,
          iat: now,
          exp: now + 1800
        },
        "wrong-secret-not-events-jwt"
      );
      const res = await request(baseUrl, "GET", "/api/organizations", { token: fake });
      assert.equal(res.status, 401);
    });

    await test("8) Events Token 无 write 调 POST orgs → 403", async () => {
      const now = Math.floor(Date.now() / 1000);
      const readOnly = jwt.sign(
        {
          sub: "99",
          role: "event_admin",
          token_type: EVENTS_TOKEN_TYPE,
          iss: EVENTS_ISS,
          aud: EVENTS_AUD,
          permissions: ["events.organizations.read"],
          iat: now,
          exp: now + 1800
        },
        process.env.EVENTS_JWT_SECRET
      );
      const res = await request(baseUrl, "POST", "/api/organizations", {
        token: readOnly,
        body: { name: "should-fail" }
      });
      assert.equal(res.status, 403);
    });

    await test("11) 无 Authorization → 401", async () => {
      const res = await request(baseUrl, "GET", "/api/organizations");
      assert.equal(res.status, 401);
    });

    let dbUp = false;
    try {
      await ping();
      dbUp = true;
    } catch {
      dbUp = false;
    }

    if (!dbUp) {
      skip("9) 有效 Events Token GET orgs", "DB unavailable");
      skip("10) 本地 login Token", "DB unavailable");
    } else {
      await test("9) 有效 Events Token GET orgs（非 401/403）", async () => {
        if (!eventsToken) {
          const { token: assertion } = signAssertion();
          const ex = await request(baseUrl, "POST", "/api/auth/exchange", {
            body: { assertion }
          });
          eventsToken = ex.body.data.token;
        }
        const res = await request(baseUrl, "GET", "/api/organizations", {
          token: eventsToken
        });
        assert.notEqual(res.status, 401);
        assert.notEqual(res.status, 403);
        // 200 或业务错误均可，关键是鉴权通过
        assert.ok(res.status === 200 || res.status >= 500 || res.status === 400);
      });

      await test("10) 本地 login 后可访问（若有可用账号则验证）", async () => {
        // 仅验证本地两段 token 鉴权路径：伪造无效 uid 会 401「用户不存在」；
        // 签名合法但用户不存在仍证明走了 local 轨而非 events。
        const cryptoLocal = require("crypto");
        function b64url(buf) {
          return Buffer.from(buf)
            .toString("base64")
            .replace(/=/g, "")
            .replace(/\+/g, "-")
            .replace(/\//g, "_");
        }
        const now = Math.floor(Date.now() / 1000);
        const payload = b64url(JSON.stringify({ uid: -999999, iat: now, exp: now + 3600 }));
        const sig = cryptoLocal
          .createHmac("sha256", process.env.AUTH_SECRET || "dev-secret")
          .update(payload)
          .digest();
        const localToken = `${payload}.${b64url(sig)}`;
        const res = await request(baseUrl, "GET", "/api/organizations", {
          token: localToken
        });
        // 用户不存在 → 401（local 轨）；不是静默当 events
        assert.equal(res.status, 401);
        assert.match(String(res.body?.message || ""), /用户不存在|未登录|token/);
      });
    }

    await test("Events Token 访问 /api/users → 403", async () => {
      if (!eventsToken) {
        const { token: assertion } = signAssertion();
        const ex = await request(baseUrl, "POST", "/api/auth/exchange", {
          body: { assertion }
        });
        eventsToken = ex.body.data.token;
      }
      const res = await request(baseUrl, "GET", "/api/users", { token: eventsToken });
      assert.equal(res.status, 403);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    jtiStore.stopCleanupInterval();
  }

  console.log(`\n结果: ${passed} passed, ${failed} failed, ${skipped} skipped\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
