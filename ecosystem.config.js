module.exports = {
  apps: [
    {
      name: 'polywynn-start',
      script: 'npm',
      args: 'run start:polywynn',
      cwd: __dirname,
      env: {
        LOGGER_DISABLE_CONSOLE: 'true',
      },
      out_file: './logs/pm2-start-out.log',
      error_file: './logs/pm2-start-error.log',
    },
    {
      name: 'logs-server',
      script: 'npm',
      args: 'run logs:server',
      cwd: __dirname,
      env: {
        PORT: 8090,
      },
      out_file: './logs/pm2-logs-server-out.log',
      error_file: './logs/pm2-logs-server-error.log',
    },
  ],
};