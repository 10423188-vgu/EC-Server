import { createHash, randomBytes } from "node:crypto";
import { BadRequestError, NotFoundError } from "../../shared/errors/app.error.js";
import {
  createTotpUri,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  verifyTotp,
} from "../../shared/utils/totp.util.js";
import { userPrismaRepository } from "./user.prisma.repository.js";

const hashRecoveryCode = (code) =>
  createHash("sha256").update(code.toUpperCase()).digest("hex");

const createRecoveryCodes = () =>
  Array.from({ length: 8 }, () => randomBytes(8).toString("hex").toUpperCase());

export const userSecurityService = {
  getTwoFactorStatus: async (userId) => {
    const user = await userPrismaRepository.findTwoFactorById(userId);
    if (!user) throw new NotFoundError("User");
    return {
      enabled: user.twoFactorEnabled,
      recoveryCodesRemaining: user.twoFactorRecoveryCodes.length,
    };
  },

  beginTwoFactorSetup: async (userId) => {
    const user = await userPrismaRepository.findTwoFactorById(userId);
    if (!user) throw new NotFoundError("User");
    if (user.twoFactorEnabled) {
      throw new BadRequestError("Two-factor authentication is already enabled");
    }
    const secret = generateTotpSecret();
    return { secret, otpauthUri: createTotpUri(user.email, secret) };
  },

  enableTwoFactor: async (userId, secret, code) => {
    const user = await userPrismaRepository.findTwoFactorById(userId);
    if (!user) throw new NotFoundError("User");
    if (user.twoFactorEnabled) {
      throw new BadRequestError("Two-factor authentication is already enabled");
    }
    if (!verifyTotp(secret, code)) {
      throw new BadRequestError("The authenticator code is invalid or expired");
    }
    const recoveryCodes = createRecoveryCodes();
    const enabled = await userPrismaRepository.enableTwoFactor(
      userId,
      encryptTotpSecret(secret),
      recoveryCodes.map(hashRecoveryCode),
    );
    if (!enabled.count) {
      throw new BadRequestError("Two-factor authentication was enabled by another request");
    }
    return { enabled: true, recoveryCodes };
  },

  disableTwoFactor: async (userId, code) => {
    const user = await userPrismaRepository.findTwoFactorById(userId);
    if (!user) throw new NotFoundError("User");
    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestError("Two-factor authentication is not enabled");
    }
    let isValid = verifyTotp(decryptTotpSecret(user.twoFactorSecret), code);
    if (!isValid) {
      isValid = await userPrismaRepository.consumeTwoFactorRecoveryCode(
        userId,
        hashRecoveryCode(code),
      );
    }
    if (!isValid) {
      throw new BadRequestError("The authenticator code is invalid or expired");
    }
    await userPrismaRepository.disableTwoFactor(userId);
    return { enabled: false, recoveryCodesRemaining: 0 };
  },
};
