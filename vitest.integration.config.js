import { defineConfig } from "vitest/config";

// why: kept separate from vitest.config.js (unit) on purpose — this suite boots a real
// mongod (mongodb-memory-server) and talks to a real local Redis, so it's slower and has
// an infra dependency the fast unit suite must never acquire. Run explicitly via
// `npm run test:integration`, not as part of the default `npm test` gate.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.js"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      // why: isolated Redis DB index so this suite's flushDb() can never touch a
      // developer's real cart data sitting on index 0
      REDIS_URL: "redis://localhost:6379/15",
      BANK_ID: "vietinbank",
      BANK_ACCOUNT_NO: "113366668888",
      BANK_ACCOUNT_NAME: "NGUYEN VAN A",
      BANK_NAME: "Vietinbank",
      PAYMENT_AUTO_CONFIRM_MIN_MS: "0",
    },
  },
});
