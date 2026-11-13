import { describe, it, expect, vi, beforeEach } from "vitest";
import { couponPrismaRepository } from "../../../src/modules/coupon/coupon.prisma.repository.js";
import { prisma } from "../../../src/configs/db/index.js";
import { NotFoundError, BadRequestError } from "../../../src/shared/errors/app.error.js";

// why: applyUsage runs inside prisma.$transaction(async (tx) => {...}) — mock $transaction
// to actually invoke the callback with a fake tx, so the branching logic (limit checks) runs
// for real. The row-lock semantics of `FOR UPDATE` itself can't be exercised without a real
// Postgres (unit tests mock Postgres in this project — see integration test's own comment).
const makeTx = ({ coupon, userUsed = 0 }) => ({
  $queryRaw: vi.fn().mockResolvedValue(coupon ? [coupon] : []),
  couponUsage: {
    count: vi.fn().mockResolvedValue(userUsed),
    create: vi.fn().mockResolvedValue({ id: "usage-1" }),
  },
  coupon: {
    update: vi.fn().mockResolvedValue({}),
  },
});

vi.mock("../../../src/configs/db/index.js", () => ({
  prisma: { $transaction: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("couponPrismaRepository.applyUsage", () => {
  it("joins checkout's transaction instead of committing coupon usage separately", async () => {
    const tx = makeTx({ coupon: { usageLimit: 100, usageCount: 1, perUserLimit: 3 } });
    await couponPrismaRepository.applyUsage({ couponId: "c1", userId: "u1", orderId: "o1", discount: "10" }, tx);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.couponUsage.create).toHaveBeenCalledWith({
      data: { couponId: "c1", userId: "u1", orderId: "o1", discount: "10" },
    });
  });
  it("throws NotFoundError when the coupon row no longer exists", async () => {
    const tx = makeTx({ coupon: null });
    prisma.$transaction.mockImplementation((cb) => cb(tx));

    await expect(
      couponPrismaRepository.applyUsage({ couponId: "c1", userId: "u1", orderId: "o1", discount: "10" })
    ).rejects.toThrow(NotFoundError);
    expect(tx.coupon.update).not.toHaveBeenCalled();
  });

  it("throws BadRequestError when usageLimit is already reached", async () => {
    const tx = makeTx({ coupon: { usageLimit: 5, usageCount: 5, perUserLimit: 1 } });
    prisma.$transaction.mockImplementation((cb) => cb(tx));

    await expect(
      couponPrismaRepository.applyUsage({ couponId: "c1", userId: "u1", orderId: "o1", discount: "10" })
    ).rejects.toThrow(BadRequestError);
    expect(tx.coupon.update).not.toHaveBeenCalled();
    expect(tx.couponUsage.create).not.toHaveBeenCalled();
  });

  it("throws BadRequestError when this user already hit perUserLimit", async () => {
    const tx = makeTx({ coupon: { usageLimit: null, usageCount: 3, perUserLimit: 2 }, userUsed: 2 });
    prisma.$transaction.mockImplementation((cb) => cb(tx));

    await expect(
      couponPrismaRepository.applyUsage({ couponId: "c1", userId: "u1", orderId: "o1", discount: "10" })
    ).rejects.toThrow(/only use this coupon 2 times/);
    expect(tx.coupon.update).not.toHaveBeenCalled();
  });

  it("increments usageCount and records usage when both limits still have room", async () => {
    const tx = makeTx({ coupon: { usageLimit: 100, usageCount: 1, perUserLimit: 3 }, userUsed: 1 });
    prisma.$transaction.mockImplementation((cb) => cb(tx));

    await couponPrismaRepository.applyUsage({ couponId: "c1", userId: "u1", orderId: "o1", discount: "10" });

    expect(tx.coupon.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { usageCount: { increment: 1 } },
    });
    expect(tx.couponUsage.create).toHaveBeenCalledWith({
      data: { couponId: "c1", userId: "u1", orderId: "o1", discount: "10" },
    });
  });

  it("never caps a usageLimit: null (unlimited) coupon on the total-usage check", async () => {
    const tx = makeTx({ coupon: { usageLimit: null, usageCount: 999_999, perUserLimit: 1 }, userUsed: 0 });
    prisma.$transaction.mockImplementation((cb) => cb(tx));

    await couponPrismaRepository.applyUsage({ couponId: "c1", userId: "u1", orderId: "o1", discount: "10" });

    expect(tx.coupon.update).toHaveBeenCalled();
  });
});
