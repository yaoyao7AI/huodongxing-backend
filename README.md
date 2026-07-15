## huodongxing-backend（最小可运行骨架）

技术栈：Node.js + Express + mysql2（promise，async/await），不使用 ORM。

### 1) 安装依赖

```bash
npm install
```

### 2) 配置环境变量

启动前请设置以下环境变量（示例）：

```bash
export PORT=3001
export DB_HOST=127.0.0.1
export DB_PORT=3306
export DB_USER=root
export DB_PASSWORD=your_password
export DB_NAME=huodongxing_db
export DB_CONNECTION_LIMIT=10
export AUTH_SECRET=change_me_in_prod
export AUTH_TOKEN_TTL_SECONDS=604800
# 跨系统换票（与 life-design-backend 仅共享 EVENTS_EXCHANGE_SECRET）
export EVENTS_EXCHANGE_SECRET=change_me_exchange
export EVENTS_JWT_SECRET=change_me_events_jwt
export EVENTS_TOKEN_TTL_SECONDS=1800
```

也可在项目根目录 `.env` 中配置（由 `loadEnv.js` 自动加载）。

### 3) 启动

```bash
npm start
```

本地端口约定（避免冲突）：
- life-design-backend → `3000`
- **huodongxing-backend → `3001`**
- life-design-admin → `5173`

启动成功后：
- 健康检查：`GET http://127.0.0.1:3001/health`
- API 前缀：`/api`
- 本地登录：`POST /api/auth/login`（body: `password` + `phone/mobile/username/email` 之一）
- 跨系统换票：`POST /api/auth/exchange`（body: `{ assertion }`，无需登录）
- 当前用户：`GET /api/auth/me`（需要 `Authorization: Bearer <token>`）
- 鉴权：除 `/api/auth/login` 与 `/api/auth/exchange` 外，其它 `/api/*` 需要 Bearer Token
  - **本地 Token**（`AUTH_SECRET` 两段式）：organizer / 本地用户
  - **Events Token**（`EVENTS_JWT_SECRET` 标准 JWT）：life-design 内部运营经换票后获得
- 权限：
  - organizations / activities / activity_registrations：按 `events.*.read|write` 权限码校验
  - users：仅本地 admin（Events Token 访问返回 403）

### 4) 换票测试

```bash
npm run test:events-exchange
```

更多实现细节见：`docs/PROJECT_STATUS.md`
