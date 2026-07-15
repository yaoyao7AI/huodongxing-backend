// PM2 进程管理配置
// 用法：
//   pm2 start ecosystem.config.js
//   pm2 save && pm2 startup   # 开机自启
module.exports = {
  apps: [
    {
      name: "huodongxing-backend",
      script: "app.js",
      // loadEnv.js 会读取项目根目录下的 .env（.env 不入库，需在服务器上手动创建）
      node_args: "-r ./loadEnv",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      watch: false,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production"
      },
      out_file: "./logs/out.log",
      error_file: "./logs/error.log",
      merge_logs: true,
      time: true
    }
  ]
};
