import { prisma } from "../../configs/db/index.js";
import { USER_SELECT, USER_PROFILE_SELECT } from "./user.fields.js";

export const userPrismaRepository = {
  findTwoFactorById: (id) =>
    prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        role: true,
        email: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        twoFactorRecoveryCodes: true,
        suspendedAt: true,
        sessionVersion: true,
      },
    }),

  enableTwoFactor: (id, secret, recoveryCodes) =>
    prisma.user.updateMany({
      where: { id, twoFactorEnabled: false },
      data: {
        twoFactorEnabled: true,
        twoFactorSecret: secret,
        twoFactorRecoveryCodes: recoveryCodes,
      },
    }),

  disableTwoFactor: (id) =>
    prisma.user.update({
      where: { id },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorRecoveryCodes: [],
      },
      select: { id: true },
    }),

  consumeTwoFactorRecoveryCode: async (id, codeHash) => {
    const result = await prisma.$executeRaw`
      UPDATE "User"
      SET "twoFactorRecoveryCodes" = array_remove("twoFactorRecoveryCodes", ${codeHash})
      WHERE id = ${id}
        AND ${codeHash} = ANY("twoFactorRecoveryCodes")
    `;
    return result === 1;
  },

  findCustomers: (
    skip,
    take,
    search,
    status,
    sortBy = "registered",
    sortOrder = "desc",
  ) => {
    const where = {
      role: "CUSTOMER",
      ...(status === "active" && { suspendedAt: null }),
      ...(status === "suspended" && { suspendedAt: { not: null } }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
        ],
      }),
    };
    const orderBy =
      sortBy === "orders"
        ? [
            { orders: { _count: sortOrder } },
            { createdAt: "desc" },
            { id: "desc" },
          ]
        : sortBy === "name"
          ? [{ name: sortOrder }, { id: sortOrder }]
          : [{ createdAt: sortOrder }, { id: sortOrder }];

    return Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take,
        orderBy,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          avatar: true,
          emailVerifiedAt: true,
          suspendedAt: true,
          createdAt: true,
          _count: { select: { orders: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);
  },

  countSelectedCustomers: (ids) =>
    prisma.user.count({ where: { id: { in: ids }, role: "CUSTOMER" } }),

  findCustomerDetails: (id) =>
    prisma.user.findFirst({
      where: { id, role: "CUSTOMER" },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        suspendedAt: true,
        createdAt: true,
        addresses: {
          orderBy: [{ isDefault: "desc" }, { id: "asc" }],
          select: {
            id: true,
            fullName: true,
            phone: true,
            street: true,
            ward: true,
            district: true,
            city: true,
            postalCode: true,
            countryCode: true,
            isDefault: true,
          },
        },
        _count: { select: { orders: true } },
      },
    }),

  findCustomerOrders: (id, skip, take) =>
    prisma.order.findMany({
      where: { userId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take,
      select: {
        id: true,
        createdAt: true,
        status: true,
        total: true,
      },
    }),

  findCustomerExportBatch: (
    { search, status, sortBy, sortOrder, ids },
    cursorId,
    take,
  ) =>
    prisma.user.findMany({
      where: {
        role: "CUSTOMER",
        ...(ids && { id: { in: ids } }),
        ...(!ids && status === "active" && { suspendedAt: null }),
        ...(!ids &&
          status === "suspended" && {
            suspendedAt: { not: null },
          }),
        ...(!ids &&
          search && {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { phone: { contains: search, mode: "insensitive" } },
            ],
          }),
      },
      ...(cursorId && { cursor: { id: cursorId }, skip: 1 }),
      take,
      orderBy:
        sortBy === "orders"
          ? [
              { orders: { _count: sortOrder ?? "desc" } },
              { createdAt: "desc" },
              { id: "desc" },
            ]
          : sortBy === "name"
            ? [{ name: sortOrder ?? "desc" }, { id: sortOrder ?? "desc" }]
            : [{ createdAt: sortOrder ?? "desc" }, { id: sortOrder ?? "desc" }],
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        suspendedAt: true,
        createdAt: true,
        _count: { select: { orders: true } },
      },
    }),

  getCustomerOverview: async (since, previousSince) => {
    const [
      total,
      newCustomers,
      previousNewCustomers,
      activeRows,
      previousActiveRows,
      dailyRows,
      activeDailyRows,
      segmentRows,
    ] = await Promise.all([
      prisma.user.count({ where: { role: "CUSTOMER" } }),
      prisma.user.count({
        where: { role: "CUSTOMER", createdAt: { gte: since } },
      }),
      prisma.user.count({
        where: {
          role: "CUSTOMER",
          createdAt: { gte: previousSince, lt: since },
        },
      }),
      prisma.$queryRaw`
          SELECT COUNT(DISTINCT o."userId")::int AS count
          FROM "Order" o
          JOIN "User" u ON u.id = o."userId"
          WHERE u.role = 'CUSTOMER'
            AND o."createdAt" >= ${since}
            AND o.status::text IN ('PAID', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED')
        `,
      prisma.$queryRaw`
          SELECT COUNT(DISTINCT o."userId")::int AS count
          FROM "Order" o
          JOIN "User" u ON u.id = o."userId"
          WHERE u.role = 'CUSTOMER'
            AND o."createdAt" >= ${previousSince}
            AND o."createdAt" < ${since}
            AND o.status::text IN ('PAID', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED')
        `,
      prisma.$queryRaw`
          SELECT u."createdAt"::date AS day,
                 COUNT(*)::int AS count
          FROM "User" u
          WHERE u.role = 'CUSTOMER' AND u."createdAt" >= ${since}
          GROUP BY 1
          ORDER BY 1
        `,
      prisma.$queryRaw`
          SELECT o."createdAt"::date AS day,
                 COUNT(DISTINCT o."userId")::int AS count
          FROM "Order" o
          JOIN "User" u ON u.id = o."userId"
          WHERE u.role = 'CUSTOMER'
            AND o."createdAt" >= ${since}
            AND o.status::text IN ('PAID', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED')
          GROUP BY 1
          ORDER BY 1
        `,
      prisma.$queryRaw`
          WITH purchases AS (
            SELECT u.id, COUNT(o.id) FILTER (
              WHERE o.status::text IN ('PAID', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED')
            )::int AS count
            FROM "User" u
            LEFT JOIN "Order" o ON o."userId" = u.id
            WHERE u.role = 'CUSTOMER'
            GROUP BY u.id
          )
          SELECT
            COUNT(*) FILTER (WHERE count >= 10)::int AS heavy,
            COUNT(*) FILTER (WHERE count BETWEEN 4 AND 9)::int AS regular,
            COUNT(*) FILTER (WHERE count BETWEEN 1 AND 3)::int AS occasional,
            COUNT(*) FILTER (WHERE count = 0)::int AS none
          FROM purchases
        `,
    ]);
    return {
      total,
      newCustomers,
      previousNewCustomers,
      activeCustomers: activeRows[0]?.count ?? 0,
      previousActiveCustomers: previousActiveRows[0]?.count ?? 0,
      daily: dailyRows,
      activeDaily: activeDailyRows,
      segments: segmentRows[0] ?? {
        heavy: 0,
        regular: 0,
        occasional: 0,
        none: 0,
      },
    };
  },

  findById: async (id) => {
    return prisma.user.findUnique({ where: { id }, select: USER_SELECT });
  },

  findEmailOwner: (email) =>
    prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    }),

  setCustomerSuspension: (id, suspended) =>
    prisma.user.updateMany({
      where: { id, role: "CUSTOMER" },
      data: {
        suspendedAt: suspended ? new Date() : null,
        // why: old access/refresh tokens stay invalid after the account is restored.
        ...(suspended && {
          sessionVersion: { increment: 1 },
          wishlistShareToken: null,
        }),
      },
    }),

  findByIdWithAddresses: async (id) => {
    return prisma.user.findUnique({
      where: { id },
      select: USER_PROFILE_SELECT,
    });
  },

  findPublicReviewProfiles: (ids) =>
    prisma.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        avatar: true,
        reviewDisplayName: true,
        reviewAvatar: true,
      },
    }),

  findByIdWithPassword: async (id) => {
    return prisma.user.findUnique({ where: { id } });
  },

  update: async (id, data) => {
    return prisma.user.update({ where: { id }, data, select: USER_SELECT });
  },
};
