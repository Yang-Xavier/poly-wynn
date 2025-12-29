module.exports = {
  apps: [
    {
      name: "crypto15min-start",
      script: "npm",
      args: "run crypto15min:runPolyWynn",
      cwd: __dirname,
      env: {
        LOGGER_DISABLE_CONSOLE: "true",
        // 将 PASSWORD 传递给子进程
        ...(process.env.PASSWORD && { PASSWORD: process.env.PASSWORD }),
      },
      out_file: "./logs/pm2-start-out.log",
      error_file: "./logs/pm2-start-error.log",
    },
  ],
};
