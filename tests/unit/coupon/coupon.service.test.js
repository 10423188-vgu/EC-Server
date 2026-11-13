import { describe, it, expect, vi, beforeEach } from "vitest";
import { couponService } from "../../../src/modules/coupon/coupon.service.js";
import { couponPrismaRepository } from "../../../src/modules/coupon/coupon.prisma.repository.js";
import { cartRedisRepository } from "../../../src/modules/cart/cart.redis.repository.js";
import { Product } from "../../../src/models/product.model.js";
import { NotFoundError, BadRequestError, ConflictError } from "../../../src/shared/errors/app.error.js";
import { couponSchema } from "../../../src/modules/coupon/coupon.schema.js";

vi.mock("../../../src/modules/coupon/coupon.prisma.repository.js", () => ({
  couponPrismaRepository: {
    findByCode: vi.fn(),
    findById: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    countUserUsage: vi.fn(),
    applyUsage: vi.fn(),
  },
}));

vi.mock("../../../src/modules/cart/cart.redis.repository.js", () => ({
  cartRedisRepository: {
    getAll: vi.fn(),
  },
}));

vi.mock("../../../src/models/product.model.js", () => ({
  Product: {
    find: vi.fn(),
  },
}));

const baseCoupon = (overrides = {}) => ({
  id: "coupon-1",
  code: "SALE10",
  name: "Sale 10%",
  type: "PERCENTAGE",
  value: "10",
  scope: "ALL",
  scopeIds: [],
  isActive: true,
  startsAt: null,
  expiresAt: null,
  usageLimit: null,
  usageCount: 0,
  perUserLimit: 1,
  minOrderAmount: null,
  maxDiscount: null,
  ...overrides,
});

const mockCartHash = (hash) => cartRedisRepository.getAll.mockResolvedValue(hash);

const mockCartProducts = (products) =>
  Product.find.mockReturnValue({ lean: () => Promise.resolve(products) });

const singleItemCart = ({ variantId = "v1", price = 100, quantity = 2, categoryId = "cat-1", brandId = "brand-1", productId = "prod-1" } = {}) => {
  mockCartHash({ [variantId]: String(quantity) });
  mockCartProducts([
    {
      _id: productId,
      categoryId,
      brandId,
      variants: [{ _id: variantId, isActive: true, price, salePrice: null, stock: 50 }],
    },
  ]);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("couponService.validate — usability guards", () => {
  it("throws NotFoundError when coupon code does not exist", async () => {
    couponPrismaRepository.findByCode.mockResolvedValue(null);

    await expect(couponService.validate({ userId: "u1", code: "NOPE" })).rejects.toThrow(NotFoundError);
  });

  it("throws NotFoundError when coupon is inactive", async () => {
    couponPrismaRepository.findByCode.mockResolvedValue(baseCoupon({ isActive: false }));

    await expect(couponService.validate({ userId: "u1", code: "SALE10" })).rejects.toThrow(NotFoundError);
  });

  it("throws BadRequestError when coupon has not started yet", async () => {
    const future = new Date(Date.now() + 86_400_000);
    couponPrismaRepository.findByCode.mockResolvedValue(baseCoupon({ startsAt: future }));

    await expect(couponService.validate({ userId: "u1", code: "SALE10" })).rejects.toThrow(
      "Coupon is not yet valid"
    );
  });

  it("throws BadRequestError when coupon has expired", async () => {
    const past = new Date(Date.now() - 86_400_000);
    couponPrismaRepository.findByCode.mockResolvedValue(baseCoupon({ expiresAt: past }));

    await expect(couponService.validate({ userId: "u1", code: "SALE10" })).rejects.toThrow(
      "Coupon has expired"
    );
  });

  it("throws BadRequestError when global usage limit is reached", async () => {
    couponPrismaRepository.findByCode.mockResolvedValue(baseCoupon({ usageLimit: 5, usageCount: 5 }));

    await expect(couponService.validate({ userId: "u1", code: "SALE10" })).rejects.toThrow(
      "Coupon usage limit has been reached"
    );
  });

  it("throws BadRequestError with singular message when perUserLimit is 1 and already used", async () => {
    couponPrismaRepository.findByCode.mockResolvedValue(baseCoupon({ perUserLimit: 1 }));
    couponPrismaRepository.countUserUsage.mockResolvedValue(1);

    await expect(couponService.validate({ userId: "u1", code: "SALE10" })).rejects.toThrow(
      "You have already used this coupon"
    );
  });

  it("throws BadRequestError with count message when perUserLimit > 1 and reached", async () => {
    couponPrismaRepository.findByCode.mockResolvedValue(baseCoupon({ perUserLimit: 3 }));
    couponPrismaRepository.countUserUsage.mockResolvedValue(3);

    await expect(couponService.validate({ userId: "u1", code: "SALE10" })).rejects.toThrow(
      "You can only use this coupon 3 times"
    );
  });

  it("throws BadRequestError when cart is empty", async () => {
    couponPrismaRepository.findByCode.mockResolvedValue(baseCoupon());
    couponPrismaRepository.countUserUsage.mockResolvedValue(0);
    mockCartHash({});

    await expect(couponService.validate({ userId: "u1", code: "SALE10" })).rejects.toThrow(
      "Your cart is empty"
    );
  });
});

describe("couponService.validate — scope filtering", () => {
  beforeEach(() => {
    couponPrismaRepository.countUserUsage.mockResolvedValue(0);
  });

  it("scope ALL applies to any cart item", async () => {
    couponPrismaRepository.findByCode.mockResolvedValue(baseCoupon({ scope: "ALL" }));
    singleItemCart({ price: 100, quantity: 1 });

    const result = await couponService.validate({ userId: "u1", code: "SALE10" });
    expect(result.eligibleTotal).toBe(100);
  });

  it("scope CATEGORY excludes items outside scopeIds", async () => {
    couponPrismaRepository.findByCode.mockResolvedValue(
      baseCoupon({ scope: "CATEGORY", scopeIds: ["cat-other"] })
    );
    singleItemCart({ categoryId: "cat-1" });

    await expect(couponService.validate({ userId: "u1", code: "SALE10" })).rejects.toThrow(
      "This coupon is not applicable to any item in your cart"
    );
  });

  it("scope CATEGORY includes items matching scopeIds", async () => {
    couponPrismaRepository.findByCode.mockResolvedValue(
      baseCoupon({ scope: "CATEGORY", scopeIds: ["cat-1"] })
    );
    singleItemCart({ categoryId: "cat-1", price: 50, quantity: 2 });

    const result = await couponService.validate({ userId: "u1", code: "SALE10" });
    expect(result.eligibleTotal).toBe(100);
  });

  it("scope BRAND excludes items with no brandId", async () => {
    couponPrismaRepository.findByCode.mockResolvedValue(
      baseCoupon({ scope: "BRAND", scopeIds: ["brand-1"] })
    );
    singleItemCart({ brandId: null });

    await expect(couponService.validate({ userId: "u1", code: "SALE10" })).rejects.toThrow(
      "This coupon is not applicable to any item in your cart"
    );
  });

  it("scope PRODUCT includes items matching productId", async () => {
    couponPrismaRepository.findByCode.mockResolvedValue(
      baseCoupon({ scope: "PRODUCT", scopeIds: ["prod-1"] })
    );
    singleItemCart({ productId: "prod-1", price: 20, quantity: 3 });

    const result = await couponService.validate({ userId: "u1", code: "SALE10" });
    expect(result.eligibleTotal).toBe(60);
  });
});

describe("couponService.validate — discount calculation", () => {
  beforeEach(() => {
    couponPrismaRepository.countUserUsage.mockResolvedValue(0);
  });

  it("caps PERCENTAGE discount at maxDiscount", async () => {
    couponPrismaRepository.findByCode.mockResolvedValue(
      baseCoupon({ type: "PERCENTAGE", value: "50", maxDiscount: "30" })
    );
    singleItemCart({ price: 100, quantity: 1 }); // eligible = 100, 50% = 50, capped to 30

    const result = await couponService.validate({ userId: "u1", code: "SALE10" });
    expect(result.discountAmount).toBe(30);
  });

  it("caps FIXED discount at eligibleTotal so it never goes negative", async () => {
    couponPrismaRepository.findByCode.mockResolvedValue(baseCoupon({ type: "FIXED", value: "1000" }));
    singleItemCart({ price: 40, quantity: 1 }); // eligible = 40, fixed 1000 -> capped to 40

    const result = await couponService.validate({ userId: "u1", code: "SALE10" });
    expect(result.discountAmount).toBe(40);
    expect(result.finalTotal).toBe(0);
  });

  it("FREE_SHIPPING type yields zero product discount but flags isFreeShipping", async () => {
    couponPrismaRepository.findByCode.mockResolvedValue(baseCoupon({ type: "FREE_SHIPPING", value: "0" }));
    singleItemCart({ price: 100, quantity: 1 });

    const result = await couponService.validate({ userId: "u1", code: "SALE10" });
    expect(result.discountAmount).toBe(0);
    expect(result.coupon.isFreeShipping).toBe(true);
  });

  it("throws BadRequestError when cart total is below minOrderAmount", async () => {
    couponPrismaRepository.findByCode.mockResolvedValue(baseCoupon({ minOrderAmount: "500" }));
    singleItemCart({ price: 100, quantity: 1 });

    await expect(couponService.validate({ userId: "u1", code: "SALE10" })).rejects.toThrow(
      /Minimum order amount/
    );
  });
});

describe("couponService admin CRUD", () => {
  it("allows clearing optional fields when updating a coupon", () => {
    expect(couponSchema.update.safeParse({
      params: { id: "e882484c-90d7-407d-8179-904f1d2243bd" },
      body: {
        description: null,
        maxDiscount: null,
        minOrderAmount: null,
        usageLimit: null,
        startsAt: null,
        expiresAt: null,
      },
    }).success).toBe(true);
  });

  it("create throws ConflictError when code already exists", async () => {
    couponPrismaRepository.findByCode.mockResolvedValue(baseCoupon());

    await expect(couponService.create({ code: "SALE10" })).rejects.toThrow(ConflictError);
    expect(couponPrismaRepository.create).not.toHaveBeenCalled();
  });

  it("create succeeds when code is unique", async () => {
    couponPrismaRepository.findByCode.mockResolvedValue(null);
    couponPrismaRepository.create.mockResolvedValue(baseCoupon());

    const result = await couponService.create({ code: "SALE10" });
    expect(result.code).toBe("SALE10");
  });

  it("update throws NotFoundError for unknown id", async () => {
    couponPrismaRepository.findById.mockResolvedValue(null);

    await expect(couponService.update("missing", {})).rejects.toThrow(NotFoundError);
  });

  it("delete throws NotFoundError for unknown id", async () => {
    couponPrismaRepository.findById.mockResolvedValue(null);

    await expect(couponService.delete("missing")).rejects.toThrow(NotFoundError);
  });

  it("keeps the history of coupons that have been used", async () => {
    couponPrismaRepository.findById.mockResolvedValue(baseCoupon({ usageCount: 1 }));

    await expect(couponService.delete("coupon-1")).rejects.toThrow(ConflictError);
    expect(couponPrismaRepository.delete).not.toHaveBeenCalled();
  });

  it("apply delegates straight to repository.applyUsage", async () => {
    await couponService.apply({ userId: "u1", couponId: "c1", orderId: "o1", discountAmount: 10 });

    expect(couponPrismaRepository.applyUsage).toHaveBeenCalledWith({
      couponId: "c1",
      userId: "u1",
      orderId: "o1",
      discount: 10,
    }, undefined);
  });
});
