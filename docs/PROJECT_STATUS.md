## 项目现状文档（便于迭代维护）

本文档用于记录当前后端已实现的能力、约定、接口与扩展点，方便后续调整/新增/迭代。

---

### 1) 技术栈与约束

- **Node.js + Express**
- **mysql2/promise**（async/await）
- **RESTful API**
- **JSON 返回**
- **不使用 ORM**
- **数据库**：已有 `huodongxing_db`，现有表结构（`organizations/users/activities/activity_registrations`）不修改、不重命名字段

---

### 2) 目录结构

```
app.js
db.js
routes/
  index.js
  auth.js
  organizations.js
  users.js
  activities.js
  activity_registrations.js
controllers/
  authController.js
  eventsExchangeController.js
  organizationsController.js
  usersController.js
  activitiesController.js
  activityRegistrationsController.js
middlewares/
  auth.js
  authenticate.js
  eventsAuth.js
  currentUser.js
  permissions.js
utils/
  jwt.js
  jtiStore.js
  eventsPermissions.js
scripts/
  test-events-exchange.js
```

---

### 3) 环境变量

- **PORT**：服务端口（默认 **3001**；本地约定：life-design-backend=3000，本服务=3001，life-design-admin=5173）
- **HOST**：监听地址（默认 `127.0.0.1`）
- **DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME/DB_CONNECTION_LIMIT**：数据库连接
- **AUTH_SECRET**：本地登录 token 签名密钥（生产必须替换）
- **AUTH_TOKEN_TTL_SECONDS**：本地 token 过期时间（默认 7 天：604800）
- **EVENTS_EXCHANGE_SECRET**：与 life-design-backend **仅共享**的换票 Assertion 密钥（勿与 `ADMIN_JWT_SECRET` / `AUTH_SECRET` 混用）
- **EVENTS_JWT_SECRET**：本系统签发 Events Token 的密钥
- **EVENTS_TOKEN_TTL_SECONDS**：Events Token 有效期（默认 1800）

---

### 4) 统一返回规范

- **成功**：

```json
{ "success": true, "data": ... }
```

- **失败**：

```json
{ "success": false, "message": "错误原因" }
```

- **404**：`{ success:false, message:"NOT_FOUND" }`

---

### 5) 鉴权与登录（双轨）

#### 5.1 本地登录（organizer / 本地用户）

- **POST `/api/auth/login`**
  - body：`password` + `phone/mobile/username/email` 之一
  - 登录标识字段/密码字段**自动探测**：
    - 标识字段优先级：`phone` → `mobile` → `username` → `email`（从 `users` 实际列中选）
    - 密码字段：`password` 或 `password_hash`（从 `users` 实际列中选）
  - 返回：`{ token, user }`（user 已脱敏）

#### 5.2 本地 token 格式

- token 结构：`payloadBase64Url.signatureBase64Url`（两段式）
- signature：`HMAC-SHA256(payload, AUTH_SECRET)`
- payload：包含 `uid/iat/exp`

#### 5.3 跨系统换票（Events Token Exchange）

- **POST `/api/auth/exchange`**（无需登录）
  - body：`{ assertion }` — life-design-backend 签发的短时 HS256 JWT
  - Assertion 使用 `EVENTS_EXCHANGE_SECRET`，校验：
    - `token_type=events_exchange`、`iss=life-design-backend`、`aud=huodongxing-backend`
    - `exp` 未过期且 `exp-iat<=60`（无 iat 则 `exp-now<=60`）
    - `role ∈ {super_admin, event_admin}`（拒绝 `content_admin`）
    - `permissions` 含 `center.events.access`
    - `jti` 进程内防重放（单实例；多实例需后续 Redis）
  - 成功签发 Events Token（`EVENTS_JWT_SECRET`，TTL 默认 1800），返回：

```json
{
  "success": true,
  "data": {
    "token": "events token",
    "expiresIn": 1800,
    "user": { "externalAdminId": 1, "role": "event_admin" },
    "permissions": ["events.organizations.read", "..."]
  }
}
```

- **禁止**：共享 Life Design `ADMIN_JWT_SECRET`、信任前端 role/permissions、直接接受未换票的 Admin Token。

#### 5.4 鉴权要求

- 公开：`POST /api/auth/login`、`POST /api/auth/exchange`
- 其它 `/api/*`：`Authorization: Bearer <token>`
  - 先尝试 Events Token（`token_type=events_admin`），成功则 **不查** 本地 `users`
  - 否则走本地两段 Token + `attachCurrentUser`
  - 未登录/无效：401

#### 5.5 当前用户

- **GET `/api/auth/me`**
  - 本地：`{ user, permissions: { role, isAdmin, orgId }, authType: "local" }`
  - Events：`{ user: { externalAdminId, role }, permissions: [...codes], authType: "events" }`

---

### 6) 权限

#### 6.1 本地用户权限注入

本地登录请求注入：
- `req.authType = "local"`
- `req.user`：当前用户（已脱敏）
- `req.permissions`：`{ role, isAdmin, orgId }`
  - `isAdmin`：`role===admin` 或 `is_admin`/`admin` 列

#### 6.2 Events 权限码

Events 登录注入：
- `req.authType = "events"`
- `req.user = { externalAdminId, role }`
- `req.permissions = { codes, role, isAdmin: false }`

角色映射：
- **super_admin**：organizations/activities/registrations 读写 + `events.users.read` + `events.finance.read` + `events.reviews.manage`
- **event_admin**：organizations/activities/registrations 读写

中间件：`requireEventsPermission(code)`
- Events：必须含对应权限码，否则 403
- 本地写（orgs/activities）：仍要求 `isAdmin`；报名写保持「登录即可」兼容
- 本地读：登录即可

#### 6.3 接口保护

| 资源 | 读 | 写 |
|------|----|----|
| `/api/organizations/*` | `events.organizations.read` | `events.organizations.write` |
| `/api/activities/*` | `events.activities.read` | `events.activities.write` |
| `/api/activity_registrations/*` | `events.registrations.read` | `events.registrations.write` |
| `/api/users/*` | 仅本地用户 | 仅本地 `requireAdmin`（Events → 403） |

本期财务/审核权限码可签发，但无对应页面/接口。

---

### 7) 已实现的业务规则（产品级约束）

#### 7.1 列表分页 + 筛选

**organizations**
- `GET /api/organizations?page&pageSize&status&keyword`
- 规则：
  - `status` → `WHERE status = ?`
  - `keyword` → `WHERE name LIKE %keyword%`
  - 返回：`{ list, total, page, pageSize }`

**activities**
- `GET /api/activities?page&pageSize&status&keyword`
- 规则（避免猜字段名）：
  - 只有当 `activities` 表确实存在 `status` 才启用 status 筛选
  - keyword 优先用 `title`，否则用 `name`，都不存在则忽略 keyword
  - 返回：`{ list, total, page, pageSize }`

#### 7.2 users 密码加密与脱敏

- 创建/更新用户时：
  - 若 `users` 表存在 `password` 或 `password_hash`，则自动 `bcrypt.hash(...)`
- 返回用户信息时：
  - 自动移除 `password/password_hash`

#### 7.3 报名去重（并发安全）

`activity_registrations`：
- 同一活动（`activity_id`）+ 同一手机号（`user_phone/phone/mobile`）只能报名一次
- 重复报名返回 **409**
- 为避免高并发下“先查再插”漏判：
  - create/update 在涉及唯一键时使用 MySQL **GET_LOCK(activity_id+phone)** 做互斥
  - 并在事务内再次确认是否已存在记录

#### 7.4 活动状态控制（报名入口）

在创建/更新报名时：
- 若 `activities` 表存在 `status` 列：
  - `draft`：409（未发布不可报名）
  - `ended`：409（已结束不可报名）
- 若不存在 `status` 列：仅校验活动是否存在

#### 7.5 删除保护（活动）

删除活动 `DELETE /api/activities/:id`：
- 若 `activity_registrations` 表存在 `activity_id` 列：
  - 该活动已有报名记录 → **409** 禁止删除
- 若缺少 `activity_id` 列：返回 500（无法执行删除保护，避免误删）

---

### 8) CRUD 覆盖情况

- organizations：CRUD + 列表分页筛选
- users：CRUD + 密码 hash + 返回脱敏（列表未分页）
- activities：CRUD + 列表分页筛选 + 删除保护
- activity_registrations：CRUD + 并发安全去重 + 活动状态校验（列表未分页）

---

### 9) 测试

```bash
npm run test:events-exchange
```

覆盖换票校验、jti 防重放、Events/本地双轨 401/403，以及（DB 可用时）业务读鉴权放行。

---

### 10) 后续迭代建议（下一步清单）

- **（推荐）列表统一分页**：给 `users`、`activity_registrations` 的 list 也统一成 `{list,total,page,pageSize}`，并补常用筛选（手机号、activity_id、时间范围）。
- **权限细化**：从 `isAdmin` 扩展为“组织管理员/主办方管理员”，对活动与报名做组织维度隔离。
- **jti 防重放多实例**：内存 Map 换 Redis。
- **登出/撤销 token**：增加黑名单（先内存 Map，后续 Redis）。
- **可观测性**：请求日志（method/path/status/耗时/uid）、错误码标准化（`code` 字段）、SQL 错误脱敏。

