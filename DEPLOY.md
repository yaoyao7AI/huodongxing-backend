# 部署到阿里云 ECS

目标服务器：`8.217.78.212`（公网 IP，可 SSH）
架构：Nginx（80/443 对外）→ Node/Express（本机 127.0.0.1:3001，PM2 守护）→ 阿里云 RDS MySQL

---

## 0. 前置检查（本地已完成）

- 代码已推送到 GitHub：`https://github.com/yaoyao7AI/huodongxing-backend.git`
- `.env` **不入库**（含密钥），需在服务器上单独创建
- 换票逻辑、DB 健康检查已通过验收

---

## 1. SSH 登录 ECS

```bash
ssh root@8.217.78.212
```

---

## 2. 安装 Node.js 18+ 与 git

推荐用 nvm 安装，兼容所有系统：

```bash
# 安装 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc

# 安装并使用 Node 20 LTS
nvm install 20
nvm use 20
nvm alias default 20
node -v   # 确认 >= 18
```

安装 git：

```bash
# Ubuntu/Debian
apt-get update && apt-get install -y git
# Alibaba Cloud Linux / CentOS
dnf install -y git   # 或 yum install -y git
```

---

## 3. 拉取代码

```bash
mkdir -p /opt/apps && cd /opt/apps
git clone https://github.com/yaoyao7AI/huodongxing-backend.git
cd huodongxing-backend
npm install
```

> 私有仓库需先配置 SSH key 或用 PAT（个人访问令牌）。

---

## 4. 创建 .env（关键，含密钥，不从 git 来）

```bash
cp .env.example .env
vi .env
```

按实际填写，重点：

```dotenv
# ECS 与 RDS 同 VPC/地域时优先用内网地址（更快更安全）
DB_HOST=<RDS内网或公网地址>
DB_PORT=3306
DB_USER=life_admin
DB_PASSWORD=<真实密码>
DB_NAME=huodongxing_db

# 走 Nginx 反代：只监听本机
HOST=127.0.0.1
PORT=3001

# 生产务必改成强随机值
AUTH_SECRET=<强随机>

# 与 life-design-backend 完全一致，两端必须相同
EVENTS_EXCHANGE_SECRET=<共享换票密钥>
EVENTS_JWT_SECRET=<自签Events Token密钥>
EVENTS_TOKEN_TTL_SECONDS=1800
```

> `EVENTS_EXCHANGE_SECRET` 必须与 life-design-backend 生产环境**逐字符一致**，否则换票会 401。可用 `npm run debug:verify-assertion` 核对。

---

## 5. 配置 RDS 白名单

- 若走**内网**：ECS 与 RDS 需在同一 VPC；在 RDS 控制台把 ECS 内网网段/安全组加入白名单，`DB_HOST` 用 RDS 内网地址。
- 若走**公网**：在 RDS 控制台把 ECS 公网 IP `8.217.78.212` 加入白名单，`DB_HOST` 用 RDS 公网地址。

验证连通：

```bash
node -r ./loadEnv scripts/debug-db.js   # 期望 CONNECT: SUCCESS / SELECT 1 => [ { ok: 1 } ]
```

---

## 6. 用 PM2 守护进程

```bash
npm install -g pm2
mkdir -p logs
pm2 start ecosystem.config.js
pm2 save
pm2 startup    # 按提示执行输出的那条命令，实现开机自启

pm2 status
pm2 logs huodongxing-backend --lines 50
```

启动日志应出现：

```
[startup] events exchange secret { hasExchangeSecret: true, exchangeSecretLength: ..., exchangeSecretHashPrefix: '...' }
Server listening on http://127.0.0.1:3001
DB connected
```

---

## 7. 安装并配置 Nginx 反向代理

```bash
# Ubuntu/Debian
apt-get install -y nginx
# Alibaba Cloud Linux / CentOS
dnf install -y nginx && systemctl enable nginx

# 放置反代配置
cp deploy/nginx.conf.example /etc/nginx/conf.d/huodongxing-backend.conf
nginx -t && systemctl reload nginx
```

（有域名并需要 HTTPS，见 `deploy/nginx.conf.example` 底部 certbot 说明。）

---

## 8. 阿里云安全组放行端口

在 ECS 控制台 → 安全组 → 入方向，放行：

- `22`（SSH，建议限制来源 IP）
- `80`（HTTP）
- `443`（HTTPS，如启用）
- **不要**对公网开放 `3001` 和 `3306`

---

## 9. 验收

```bash
# 服务器本机
curl http://127.0.0.1:3001/health?verbose=1

# 从你自己电脑（经 Nginx）
curl http://8.217.78.212/health?verbose=1
```

期望：`{"success":true,"data":{"db":"up",...}}`

真实换票验收（由 life-design-backend 签发 assertion 后）：

```
POST http://8.217.78.212/api/auth/exchange
Body: { "assertion": "<jwt>" }
→ 200 { success:true, data:{ token, expiresIn:1800, permissions:[...] } }
```

---

## 10. 后续更新流程

```bash
cd /opt/apps/huodongxing-backend
git pull
npm install
pm2 reload huodongxing-backend
```

---

## 常见问题

| 现象 | 排查 |
|---|---|
| 换票 401「assertion 签名无效」 | 两端 `EVENTS_EXCHANGE_SECRET` 不一致，用 `npm run debug:verify-assertion` 比对 hashPrefix |
| `/health` db down: ENOTFOUND | RDS 地址写错或 DNS 不通；`node -r ./loadEnv scripts/debug-db.js` 直连排查 |
| `/health` db down: ETIMEDOUT | RDS 白名单未放行 ECS IP，或内外网地址用错 |
| 公网访问不到 | 安全组未放行 80；或 Nginx 未启动；或 `.env` HOST 写成 0.0.0.0 却没开对应端口 |
