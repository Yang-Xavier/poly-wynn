module.exports = {
    apps: [
      {
        name: 'app',
        script: "./dist/index.js",
        out_file: './logs/out.log',
        error_file: './logs/error.log'
      }
    ]
  }