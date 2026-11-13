import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTotpUri,
  decryptTotpSecret,
  encryptTotpSecret,
  verifyTotp,
} from "../../../src/shared/utils/totp.util.js";

describe("TOTP utilities", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts the RFC 6238 six-digit code within its time step", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(verifyTotp(secret, "287082", 59_000)).toBe(true);
    expect(verifyTotp(secret, "287083", 59_000)).toBe(false);
  });

  it("builds an authenticator provisioning URI", () => {
    const uri = createTotpUri("alex@example.com", "JBSWY3DPEHPK3PXP");
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(uri).toContain("issuer=Lorem");
  });

  it("encrypts and decrypts authenticator secrets with AES-GCM", () => {
    vi.stubEnv(
      "TWO_FACTOR_ENCRYPTION_KEY",
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
    const encrypted = encryptTotpSecret("JBSWY3DPEHPK3PXP");
    expect(encrypted).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptTotpSecret(encrypted)).toBe("JBSWY3DPEHPK3PXP");
  });
});
