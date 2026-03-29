require("dotenv").config({ path: require("path").join(__dirname, ".env") });

module.exports = {
  apps: [
    {
      name: "donbeolja",
      script: "server.js",
      cwd: __dirname,
      time: true,
      exec_mode: "fork",
      instances: 1,
      max_restarts: 20,
      min_uptime: 5000,
      env: {
        WEBHOOK_RATE_LIMIT_MAX: "600",
        WEBHOOK_RATE_LIMIT_WINDOW_MS: "60000",
        WEBHOOK_JITTER_MS: "300",
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
      },
    },
  ],
};
