import { beforeEach, describe, expect, it, vi } from "vitest";
import { userSecurityService } from "../../../src/modules/user/user.security.service.js";
import { userPrismaRepository } from "../../../src/modules/user/user.prisma.repository.js";
import {
  createTotpUri,
  generateTotpSecret,
  verifyTotp,
} from "../../../src/shared/utils/totp.util.js";
import {
  BadRequestError,
  NotFoundError,
} from "../../../src/shared/errors/app.error.js";

vi.mock("../../../src/modules/user/user.prisma.repository.js", () => ({
  userPrismaRepository: {
    findTwoFactorById: vi.fn(),
    enableTwoFactor: vi.fn(),
    disableTwoFactor: vi.fn(),
    consumeTwoFactorRecoveryCode: vi.fn(),
  },
}));

vi.mock("../../../src/shared/utils/totp.util.js", () => ({
  createTotpUri: vi.fn(),
  decryptTotpSecret: vi.fn(),
  encryptTotpSecret: vi.fn(),
  generateTotpSecret: vi.fn(),
  verifyTotp: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

describe("userSecurityService", () => {
  it("returns the two-factor status and recovery-code count", async () => {
    userPrismaRepository.findTwoFactorById.mockResolvedValue({
      twoFactorEnabled: true,
      twoFactorRecoveryCodes: ["a", "b"],
    });

    await expect(userSecurityService.getTwoFactorStatus("u1")).resolves.toEqual(
      {
        enabled: true,
        recoveryCodesRemaining: 2,
      },
    );
  });

  it("rejects setup for a missing or already protected user", async () => {
    userPrismaRepository.findTwoFactorById.mockResolvedValue(null);
    await expect(
      userSecurityService.beginTwoFactorSetup("missing"),
    ).rejects.toThrow(NotFoundError);

    userPrismaRepository.findTwoFactorById.mockResolvedValue({
      twoFactorEnabled: true,
      email: "user@example.com",
    });
    await expect(userSecurityService.beginTwoFactorSetup("u1")).rejects.toThrow(
      BadRequestError,
    );
    expect(generateTotpSecret).not.toHaveBeenCalled();
  });

  it("creates a setup URI only for users without two-factor enabled", async () => {
    userPrismaRepository.findTwoFactorById.mockResolvedValue({
      twoFactorEnabled: false,
      email: "user@example.com",
    });
    generateTotpSecret.mockReturnValue("secret");
    createTotpUri.mockReturnValue("otpauth://totp/example");

    await expect(
      userSecurityService.beginTwoFactorSetup("u1"),
    ).resolves.toEqual({
      secret: "secret",
      otpauthUri: "otpauth://totp/example",
    });
    expect(createTotpUri).toHaveBeenCalledWith("user@example.com", "secret");
  });

  it("does not write two-factor credentials when the supplied code is invalid", async () => {
    userPrismaRepository.findTwoFactorById.mockResolvedValue({
      twoFactorEnabled: false,
    });
    verifyTotp.mockReturnValue(false);

    await expect(
      userSecurityService.enableTwoFactor("u1", "secret", "000000"),
    ).rejects.toThrow(BadRequestError);
    expect(userPrismaRepository.enableTwoFactor).not.toHaveBeenCalled();
  });
});
