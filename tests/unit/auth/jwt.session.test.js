import { describe, expect, it, vi } from "vitest";

describe("session tokens", () => {
  it("issues distinct refresh tokens for the same session within one second", async () => {
    vi.stubEnv("JWT_ACCESS_SECRET", "a".repeat(32));
    vi.stubEnv("JWT_REFRESH_SECRET", "b".repeat(32));
    const { generateRefreshToken, verifyRefreshToken } = await import(
      "../../../src/shared/utils/jwt.util.js"
    );

    const first = generateRefreshToken("user-1", 0, "session-1");
    const second = generateRefreshToken("user-1", 0, "session-1");

    expect(first).not.toBe(second);
    expect(verifyRefreshToken(first)).toMatchObject({
      id: "user-1",
      sessionId: "session-1",
    });
    vi.unstubAllEnvs();
  });
});
