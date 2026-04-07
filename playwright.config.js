// @ts-check
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3000",
    headless: true,
  },
  webServer: {
    command: "MOCK_DATA=1 ALLOW_LOCAL_NO_OAUTH=1 /opt/homebrew/bin/node server.js",
    port: 3000,
    reuseExistingServer: true,
    timeout: 15000,
  },
  projects: [
    {
      name: "desktop",
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      use: { viewport: { width: 375, height: 812 } },
    },
  ],
});
