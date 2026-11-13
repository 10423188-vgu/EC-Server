import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../src/configs/db/index.js";
import { userPrismaRepository } from "../../../src/modules/user/user.prisma.repository.js";

vi.mock("../../../src/configs/db/index.js", () => ({
  prisma: {
    user: {
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    order: { findMany: vi.fn() },
  },
}));
beforeEach(() => vi.clearAllMocks());

describe("customer suspension storage", () => {
  it("scopes the write to customers and revokes sessions/sharing atomically", async () => {
    await userPrismaRepository.setCustomerSuspension("customer", true);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "customer", role: "CUSTOMER" },
      data: {
        suspendedAt: expect.any(Date),
        sessionVersion: { increment: 1 },
        wishlistShareToken: null,
      },
    });
  });

  it("does not reset sessionVersion when restoring access", async () => {
    await userPrismaRepository.setCustomerSuspension("customer", false);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "customer", role: "CUSTOMER" },
      data: { suspendedAt: null },
    });
  });
});

describe("customer list filters", () => {
  it("filters suspended customers and sorts by registration date", async () => {
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);

    await userPrismaRepository.findCustomers(
      0,
      10,
      "alex",
      "suspended",
      "registered",
      "asc",
    );

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        where: expect.objectContaining({
          role: "CUSTOMER",
          suspendedAt: { not: null },
          OR: expect.arrayContaining([
            { name: { contains: "alex", mode: "insensitive" } },
          ]),
        }),
      }),
    );
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ suspendedAt: { not: null } }),
    });
  });

  it("sorts customers by order count with stable tie-breaks", async () => {
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);

    await userPrismaRepository.findCustomers(
      0,
      10,
      undefined,
      undefined,
      "orders",
      "desc",
    );

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { orders: { _count: "desc" } },
          { createdAt: "desc" },
          { id: "desc" },
        ],
      }),
    );
  });

  it("sorts customers by name", async () => {
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);

    await userPrismaRepository.findCustomers(
      0,
      10,
      undefined,
      undefined,
      "name",
      "asc",
    );

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
    );
  });

  it("exports selected customers even when they no longer match a filter", async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await userPrismaRepository.findCustomerExportBatch(
      {
        ids: ["customer-1"],
        search: "old name",
        status: "active",
        sortBy: "orders",
        sortOrder: "desc",
      },
      undefined,
      500,
    );

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: "CUSTOMER", id: { in: ["customer-1"] } },
        orderBy: [
          { orders: { _count: "desc" } },
          { createdAt: "desc" },
          { id: "desc" },
        ],
      }),
    );
  });
});

describe("customer details", () => {
  it("only reads customer accounts and sorts saved addresses", async () => {
    await userPrismaRepository.findCustomerDetails("customer-1");
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "customer-1", role: "CUSTOMER" },
        select: expect.objectContaining({
          addresses: expect.objectContaining({
            orderBy: [{ isDefault: "desc" }, { id: "asc" }],
          }),
        }),
      }),
    );
  });

  it("reads only the requested page of the customer's orders", async () => {
    await userPrismaRepository.findCustomerOrders("customer-1", 10, 10);
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "customer-1" },
        skip: 10,
        take: 10,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );
  });
});
