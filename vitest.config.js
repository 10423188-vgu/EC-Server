import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.js"],
    env: {
      BANK_ID: "vietinbank",
      BANK_ACCOUNT_NO: "113366668888",
      BANK_ACCOUNT_NAME: "NGUYEN VAN A",
      BANK_NAME: "Vietinbank",
      PAYMENT_AUTO_CONFIRM_MIN_MS: "1000",
      PAYMENT_AUTO_CONFIRM_MAX_MS: "1000",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/modules/**/*.service.js"],
    },
  },
});
