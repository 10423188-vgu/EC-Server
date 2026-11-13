const { availableParallelism } = require("node:os");

module.exports = {
  apps: [
    {
      name: "ec-server",
      script: "src/server.js",
      // why: each process owns separate database pools; "max" can exhaust the
      // database connection budget on large hosts before requests need the CPUs.
      instances:
        Number(process.env.WEB_CONCURRENCY) || Math.min(2, availableParallelism()),
      exec_mode: "cluster",
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};
