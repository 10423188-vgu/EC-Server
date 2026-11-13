import { beforeEach, describe, expect, it, vi } from "vitest";
import { authPrismaRepository } from "../../../src/modules/auth/auth.prisma.repository.js";
import { prisma } from "../../../src/configs/db/index.js";

vi.mock("../../../src/configs/db/index.js", () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));

beforeEach(() => vi.resetAllMocks());

it("loads credentials without repeating the profile/address query before login", async () => {
  await authPrismaRepository.findByEmailWithPassword("alice@example.com");
  expect(prisma.user.findUnique).toHaveBeenCalledWith({
    where: { email: "alice@example.com" },
    select: { id: true, role: true, password: true },
  });
});

describe("Google identity repository", () => {
  it("includes googleId in private identity lookups", async () => {
    await authPrismaRepository.findByGoogleId("sub-1");
    await authPrismaRepository.findByEmailForGoogle("alice@gmail.com");
    expect(prisma.user.findUnique).toHaveBeenNthCalledWith(1, {
      where: { googleId: "sub-1" },
      select: expect.objectContaining({ googleId: true }),
    });
    expect(prisma.user.findUnique).toHaveBeenNthCalledWith(2, {
      where: { email: "alice@gmail.com" },
      select: expect.objectContaining({ googleId: true }),
    });
  });

  it("atomically requires unchanged email and no existing Google link", async () => {
    const emailVerifiedAt = new Date("2026-01-01");
    await authPrismaRepository.linkGoogleId("u1", {
      email: "alice@gmail.com",
      googleId: "sub-1",
      emailVerifiedAt,
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1", email: "alice@gmail.com", googleId: null },
      data: { googleId: "sub-1", emailVerifiedAt },
      select: expect.any(Object),
    });
  });

  it("propagates a lost compare-and-set so the service rechecks identity", async () => {
    prisma.user.update.mockRejectedValue({ code: "P2025" });
    await expect(
      authPrismaRepository.linkGoogleId("u1", {
        email: "alice@gmail.com",
        googleId: "sub-1",
        emailVerifiedAt: undefined,
      }),
    ).rejects.toEqual({ code: "P2025" });
  });
});
