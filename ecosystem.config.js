module.exports = {
  apps: [
    // {
    //   name: "crypto15min-eth",
    //   script: "npm",
    //   args: "run crypto15min:runPolyWynn",
    //   cwd: __dirname,
    //   env: {
    //     LOGGER_DISABLE_CONSOLE: "true",
    //     // 将 PASSWORD 传递给子进程
    //     ...(process.env.PASSWORD && { PASSWORD: process.env.PASSWORD }),
    //     NODE_ENV: process.env.NODE_ENV || "production",
    //     MARKET: process.env.MARKET || "eth",
    //   },
    //   out_file: "./logs/pm2-start-out.log",
    //   error_file: "./logs/pm2-start-error.log",
    // },
    // {
    //   name: "crypto15min-btc",
    //   script: "npm",
    //   args: "run crypto15min:runPolyWynn",
    //   cwd: __dirname,
    //   env: {
    //     LOGGER_DISABLE_CONSOLE: "true",
    //     // 将 PASSWORD 传递给子进程
    //     ...(process.env.PASSWORD && { PASSWORD: process.env.PASSWORD }),
    //     NODE_ENV: process.env.NODE_ENV || "production",
    //     MARKET: process.env.MARKET || "btc",
    //   },
    //   out_file: "./logs/pm2-start-out.log",
    //   error_file: "./logs/pm2-start-error.log",
    // },
    {
      name: "spreadArbitrage",
      script: "bun",
      args: "src/app/spreadArbitrage/index.ts",
      cwd: __dirname,
      env: {
        LOGGER_DISABLE_CONSOLE: "true",
        NODE_ENV: process.env.NODE_ENV || "production",
        ...(process.env.PASSWORD && { PASSWORD: process.env.PASSWORD }),
      },
      out_file: "./logs/spreadArbitrage-out.log",
      error_file: "./logs/spreadArbitrage-error.log",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
    },
    {
      name: "web-server",
      script: "npm",
      args: "run web:server:prod",
      cwd: __dirname,
      env: {
        WEB_PORT: process.env.WEB_PORT || 8080,
        NODE_ENV: process.env.NODE_ENV || "production",
      },
      out_file: "./logs/web-server-out.log",
      error_file: "./logs/web-server-error.log",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
    },
  ],
};
