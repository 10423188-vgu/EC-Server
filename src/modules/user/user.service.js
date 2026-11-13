import bcrypt from "bcryptjs";
import { userPrismaRepository } from "./user.prisma.repository.js";
import { sessionRedisRepository } from "../auth/session.redis.repository.js";
import { orderPrismaRepository } from "../order/order.prisma.repository.js";
import { wishlistPrismaRepository } from "../wishlist/wishlist.prisma.repository.js";
import { reviewMongoRepository } from "../review/review.mongo.repository.js";
import { deleteFromCloudinary } from "../../shared/utils/cloudinary.util.js";
import { logger } from "../../shared/utils/logger.js";
import { csvCell } from "../../shared/utils/csv.util.js";
import {
  NotFoundError,
  BadRequestError,
  ForbiddenError,
  ConflictError,
} from "../../shared/errors/app.error.js";

const SALT_ROUNDS = 10;

// why: lifetime spend tiers, League of Legends-style 9-rank ladder — highest-first
// so the first match wins; each tier needs both the spend and the order-count floor.
// `elite` is the single source of truth for which tiers get the client's taller
// profile-frame artwork — client reads it off the profile response instead of
// keeping its own copy of these 3 names.
const TIERS = [
  { name: "Challenger", minSpent: 300_000_000, minOrders: 75, elite: true },
  { name: "Grandmaster", minSpent: 150_000_000, minOrders: 40, elite: true },
  { name: "Master", minSpent: 75_000_000, minOrders: 25, elite: true },
  { name: "Diamond", minSpent: 40_000_000, minOrders: 15 },
  { name: "Emerald", minSpent: 20_000_000, minOrders: 8 },
  { name: "Platinum", minSpent: 10_000_000, minOrders: 5 },
  { name: "Gold", minSpent: 5_000_000, minOrders: 3 },
  { name: "Silver", minSpent: 2_000_000, minOrders: 2 },
  { name: "Bronze", minSpent: 0, minOrders: 0 },
];

export const TIER_NAMES = TIERS.map((tier) => tier.name);

const getTier = (totalSpent, ordersCount) =>
  TIERS.find(
    (tier) => totalSpent >= tier.minSpent && ordersCount >= tier.minOrders,
  );

// why: frame eligibility follows current paid spend; refunded orders can lower
// the tier, so unlocked frames are recomputed rather than permanently granted.
const getUnlockedFrames = (realTier) => {
  const realTierIndex = TIERS.findIndex((tier) => tier.name === realTier.name);
  return TIERS.slice(realTierIndex);
};

// why: re-validate selectedFrame against unlockedFrames on every read (not just trust
// the stored value) so it can never render a tier the user hasn't actually earned
const resolveDisplayTier = (realTier, selectedFrame, unlockedFrames) =>
  unlockedFrames.find((tier) => tier.name === selectedFrame) ?? realTier;

const updateImage = async (userId, field, url, folder) => {
  const user = await userPrismaRepository.findById(userId);
  if (!user) throw new NotFoundError("User");

  const updated = await userPrismaRepository.update(userId, { [field]: url });

  if (user[field]) {
    deleteFromCloudinary(user[field], folder).catch((err) =>
      logger.error({ err }, `[Cloudinary] ${field} cleanup failed`),
    );
  }
  return updated;
};

export const userService = {
  adminSetCustomerSuspension: async (adminId, customerId, suspended) => {
    if (adminId === customerId)
      throw new ForbiddenError("You cannot suspend your own account");
    const result = await userPrismaRepository.setCustomerSuspension(
      customerId,
      suspended,
    );
    if (!result.count) throw new NotFoundError("Customer");
    logger.info(
      { adminId, customerId, suspended },
      "Customer account access changed",
    );
    if (suspended) {
      // why: DB sessionVersion enforces revocation even if Redis is unavailable.
      await sessionRedisRepository
        .deleteAllSessions(customerId)
        .catch((err) =>
          logger.warn(
            { err, customerId },
            "Customer suspended; session cleanup deferred",
          ),
        );
    }
    return { id: customerId, suspended };
  },
  adminListCustomers: async ({
    page,
    limit,
    search,
    status,
    sortBy = "registered",
    sortOrder,
  }) => {
    const [customers, total] = await userPrismaRepository.findCustomers(
      (page - 1) * limit,
      limit,
      search,
      status,
      sortBy,
      sortOrder,
    );
    return {
      data: customers.map(({ _count, ...customer }) => ({
        ...customer,
        ordersCount: _count.orders,
      })),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  },

  adminGetCustomer: async (id, page) => {
    const customer = await userPrismaRepository.findCustomerDetails(id);
    if (!customer) throw new NotFoundError("Customer");
    const limit = 10;
    const [orders, spend] = await Promise.all([
      userPrismaRepository.findCustomerOrders(id, (page - 1) * limit, limit),
      orderPrismaRepository.getSpendStats(id),
    ]);
    const { _count, ...details } = customer;
    return {
      ...details,
      ordersCount: _count.orders,
      totalSpent: spend.totalSpent,
      orders,
      pagination: {
        page,
        totalPages: Math.ceil(_count.orders / limit),
      },
    };
  },

  adminCustomerOverview: async (days) => {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - days + 1);
    const previousSince = new Date(since);
    previousSince.setUTCDate(previousSince.getUTCDate() - days);
    const overview = await userPrismaRepository.getCustomerOverview(
      since,
      previousSince,
    );
    const counts = new Map(
      overview.daily.map((entry) => [
        entry.day.toISOString().slice(0, 10),
        entry.count,
      ]),
    );
    const activeCounts = new Map(
      overview.activeDaily.map((entry) => [
        entry.day.toISOString().slice(0, 10),
        entry.count,
      ]),
    );
    let runningTotal = overview.total - overview.newCustomers;
    const growth = Array.from({ length: days }, (_, index) => {
      const day = new Date(since);
      day.setUTCDate(day.getUTCDate() + index);
      const date = day.toISOString().slice(0, 10);
      const newCustomers = counts.get(date) ?? 0;
      runningTotal += newCustomers;
      return {
        day: date,
        newCustomers,
        activeCustomers: activeCounts.get(date) ?? 0,
        total: runningTotal,
      };
    });
    return {
      total: overview.total,
      newCustomers: overview.newCustomers,
      activeCustomers: overview.activeCustomers,
      previousNewCustomers: overview.previousNewCustomers,
      previousActiveCustomers: overview.previousActiveCustomers,
      segments: overview.segments,
      days,
      growth,
    };
  },

  adminExportCustomersCsv: async function* ({
    ids,
    search,
    status,
    sortBy = "registered",
    sortOrder,
  }) {
    yield `\uFEFF${["Customer ID", "Name", "Email", "Phone", "Registered at", "Status", "Orders"].map(csvCell).join(",")}\r\n`;
    let cursorId;
    while (true) {
      const customers = await userPrismaRepository.findCustomerExportBatch(
        { ids, search, status, sortBy, sortOrder },
        cursorId,
        500,
      );
      for (const customer of customers) {
        yield [
          customer.id,
          customer.name,
          customer.email,
          customer.phone,
          customer.createdAt.toISOString(),
          customer.suspendedAt ? "Suspended" : "Active",
          customer._count.orders,
        ]
          .map(csvCell)
          .join(",") + "\r\n";
      }
      if (customers.length < 500) break;
      cursorId = customers.at(-1).id;
    }
  },

  adminValidateSelectedCustomers: async (ids) => {
    if (!ids) return;
    const count = await userPrismaRepository.countSelectedCustomers(ids);
    if (count !== ids.length)
      throw new ConflictError(
        "Some selected customers are unavailable. Refresh the list.",
      );
  },

  getProfile: async (userId) => {
    const [user, orderStats, wishlistCount, reviewsCount] = await Promise.all([
      userPrismaRepository.findByIdWithAddresses(userId),
      orderPrismaRepository.getSpendStats(userId),
      wishlistPrismaRepository.count(userId),
      reviewMongoRepository.countByUser(userId),
    ]);
    if (!user) throw new NotFoundError("User");
    const { password, ...profile } = user;

    // why: admins get the top tier as a staff perk, independent of their own spend/orders
    const realTier =
      user.role === "ADMIN"
        ? TIERS[0]
        : getTier(orderStats.totalSpent, orderStats.count);
    const unlockedFrames = getUnlockedFrames(realTier);
    const displayTier = resolveDisplayTier(
      realTier,
      user.selectedFrame,
      unlockedFrames,
    );

    return {
      ...profile,
      hasPassword: Boolean(password),
      ordersCount: orderStats.count,
      wishlistCount,
      reviewsCount,
      tier: realTier.name,
      frame: displayTier.name,
      isEliteTier: !!displayTier.elite,
      unlockedFrames: unlockedFrames.map((tier) => tier.name),
    };
  },

  updateProfile: async (userId, data) => {
    return userPrismaRepository.update(userId, data);
  },

  updateReviewProfile: async (userId, data) => {
    const update = {};
    if (data.reviewDisplayName !== undefined) {
      update.reviewDisplayName = data.reviewDisplayName?.trim() || null;
    }
    let previousReviewAvatar;
    if (data.reviewAvatar !== undefined) {
      const user = await userPrismaRepository.findById(userId);
      if (!user) throw new NotFoundError("User");
      previousReviewAvatar = user.reviewAvatar;
      update.reviewAvatar = data.reviewAvatar;
    }

    const updated = await userPrismaRepository.update(userId, update);
    if (
      previousReviewAvatar &&
      previousReviewAvatar !== data.reviewAvatar
    ) {
      deleteFromCloudinary(previousReviewAvatar, "avatars").catch((err) =>
        logger.error({ err }, "[Cloudinary] review avatar cleanup failed"),
      );
    }
    return updated;
  },

  setFrame: async (userId, frameName) => {
    // why: recompute the real tier from spend/orders here rather than trusting an
    // unlockedFrames list the client might send — the client only ever sees this
    // derived from the server anyway, but the request body itself must never be trusted
    const [user, orderStats] = await Promise.all([
      userPrismaRepository.findById(userId),
      orderPrismaRepository.getSpendStats(userId),
    ]);
    if (!user) throw new NotFoundError("User");

    const realTier =
      user.role === "ADMIN"
        ? TIERS[0]
        : getTier(orderStats.totalSpent, orderStats.count);
    const unlockedFrames = getUnlockedFrames(realTier);
    if (!unlockedFrames.some((tier) => tier.name === frameName)) {
      throw new BadRequestError("You haven't unlocked this frame yet");
    }

    await userPrismaRepository.update(userId, { selectedFrame: frameName });
    // why: return the same derived shape as getProfile (frame/unlockedFrames/isEliteTier)
    // so the client can sync its cache instantly instead of waiting on a refetch
    return userService.getProfile(userId);
  },

  updateAvatar: (userId, url) => updateImage(userId, "avatar", url, "avatars"),

  updateBanner: (userId, url) => updateImage(userId, "banner", url, "banners"),

  changePassword: async (userId, oldPassword, newPassword) => {
    const user = await userPrismaRepository.findByIdWithPassword(userId);
    if (!user) throw new NotFoundError("User");
    // why: a Google-only account has no password hash yet — bcrypt.compare throws on
    // null/undefined instead of just returning false
    if (!user.password)
      throw new BadRequestError(
        'This account has no password yet — use "Forgot password" to set one',
      );

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) throw new BadRequestError("Current password is incorrect");

    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await userPrismaRepository.update(userId, {
      password: hashedPassword,
      passwordChangedAt: new Date(),
      sessionVersion: { increment: 1 },
    });

    // why: sessionVersion revokes access even if Redis cleanup is unavailable.
    await sessionRedisRepository
      .deleteAllSessions(userId)
      .catch((err) =>
        logger.warn(
          { err, userId },
          "Password changed; session cleanup deferred",
        ),
      );
  },
};
