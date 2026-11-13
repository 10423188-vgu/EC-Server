import { describe, it, expect, vi, beforeEach } from "vitest";
import { cartService } from "../../../src/modules/cart/cart.service.js";
import { cartRedisRepository } from "../../../src/modules/cart/cart.redis.repository.js";
import { Product } from "../../../src/models/product.model.js";
import { NotFoundError, BadRequestError } from "../../../src/shared/errors/app.error.js";

vi.mock("../../../src/modules/cart/cart.redis.repository.js", () => ({
  cartRedisRepository: {
    getAll: vi.fn(),
    incrementItemAtomic: vi.fn(),
    setItemAtomic: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock("../../../src/models/product.model.js", () => ({
  Product: { find: vi.fn(), findOne: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const mockVariantLookup = (variant, productOverrides = {}) => {
  Product.findOne.mockReturnValue({
    lean: () => Promise.resolve(variant ? { _id: "p1", variants: [variant], ...productOverrides } : null),
  });
};

describe("cartService.getCart", () => {
  it("returns an empty array when the cart is empty", async () => {
    cartRedisRepository.getAll.mockResolvedValue({});

    const result = await cartService.getCart("u1");

    expect(result).toEqual([]);
    expect(Product.find).not.toHaveBeenCalled();
  });

  it("resolves product/variant details, skipping inactive variants and stale cart entries", async () => {
    cartRedisRepository.getAll.mockResolvedValue({ "v-active": "2", "v-inactive": "1", "v-deleted": "3" });
    Product.find.mockReturnValue({
      lean: () =>
        Promise.resolve([
          {
            _id: "p1",
            name: "Shoe",
            slug: "shoe",
            images: [{ url: "shoe.jpg" }],
            variants: [
              { _id: "v-active", sku: "SKU1", name: "Size M", price: 100, salePrice: 90, stock: 5, isActive: true, options: { color: "red" } },
              { _id: "v-inactive", sku: "SKU2", name: "Size L", price: 110, salePrice: null, stock: 3, isActive: false },
            ],
          },
        ]),
    });

    const result = await cartService.getCart("u1");

    // v-inactive is dropped (isActive:false), v-deleted is dropped (no longer in any product's variants)
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      product: { id: "p1", name: "Shoe", slug: "shoe", image: { url: "shoe.jpg" } },
      variant: { id: "v-active", sku: "SKU1", name: "Size M", price: 100, salePrice: 90, stock: 5, options: { color: "red" } },
      quantity: 2,
    });
  });

  it("prefers the variant's own image over the product's default image", async () => {
    cartRedisRepository.getAll.mockResolvedValue({ "v-red": "1" });
    Product.find.mockReturnValue({
      lean: () =>
        Promise.resolve([
          {
            _id: "p1",
            name: "Shoe",
            slug: "shoe",
            images: [{ url: "shoe-default.jpg" }],
            variants: [
              {
                _id: "v-red",
                sku: "SKU1",
                name: "Red",
                price: 100,
                salePrice: null,
                stock: 5,
                isActive: true,
                images: [{ url: "shoe-red.jpg" }],
              },
            ],
          },
        ]),
    });

    const result = await cartService.getCart("u1");

    expect(result[0].product.image).toEqual({ url: "shoe-red.jpg" });
  });
});

describe("cartService.addItem", () => {
  it("throws NotFoundError when the variant does not exist", async () => {
    mockVariantLookup(null);

    await expect(cartService.addItem("u1", "missing")).rejects.toThrow(NotFoundError);
  });

  it("throws BadRequestError when the variant is not active", async () => {
    mockVariantLookup({ _id: "v1", isActive: false, stock: 5 });

    await expect(cartService.addItem("u1", "v1")).rejects.toThrow("Variant is not available");
  });

  it("increments the quantity atomically on success", async () => {
    mockVariantLookup({ _id: "v1", isActive: true, stock: 5 });
    cartRedisRepository.incrementItemAtomic.mockResolvedValue(3);

    const result = await cartService.addItem("u1", "v1");

    expect(cartRedisRepository.incrementItemAtomic).toHaveBeenCalledWith("u1", "v1", 5);
    expect(result).toEqual({ updated: true, quantity: 3 });
  });

  it("translates the Redis OVER_STOCK error into a BadRequestError naming the available stock", async () => {
    mockVariantLookup({ _id: "v1", isActive: true, stock: 2 });
    cartRedisRepository.incrementItemAtomic.mockRejectedValue(new Error("OVER_STOCK"));

    await expect(cartService.addItem("u1", "v1")).rejects.toThrow("Only 2 item(s) in stock");
  });

  it("rethrows unrelated Redis errors as-is", async () => {
    mockVariantLookup({ _id: "v1", isActive: true, stock: 2 });
    cartRedisRepository.incrementItemAtomic.mockRejectedValue(new Error("ECONNRESET"));

    await expect(cartService.addItem("u1", "v1")).rejects.toThrow("ECONNRESET");
  });
});

describe("cartService.upsertItem", () => {
  it("throws NotFoundError when the variant does not exist", async () => {
    mockVariantLookup(null);

    await expect(cartService.upsertItem("u1", "missing", 1)).rejects.toThrow(NotFoundError);
  });

  it("removes the item instead of writing when quantity is zero or negative", async () => {
    mockVariantLookup({ _id: "v1", isActive: true, stock: 5 });

    const result = await cartService.upsertItem("u1", "v1", 0);

    expect(cartRedisRepository.removeItem).toHaveBeenCalledWith("u1", "v1");
    expect(cartRedisRepository.setItemAtomic).not.toHaveBeenCalled();
    expect(result).toEqual({ removed: true });
  });

  it("sets the exact quantity atomically on success", async () => {
    mockVariantLookup({ _id: "v1", isActive: true, stock: 5 });
    cartRedisRepository.setItemAtomic.mockResolvedValue(4);

    const result = await cartService.upsertItem("u1", "v1", 4);

    expect(cartRedisRepository.setItemAtomic).toHaveBeenCalledWith("u1", "v1", 5, 4);
    expect(result).toEqual({ updated: true, quantity: 4 });
  });

  it("translates the Redis OVER_STOCK error into a BadRequestError naming the available stock", async () => {
    mockVariantLookup({ _id: "v1", isActive: true, stock: 2 });
    cartRedisRepository.setItemAtomic.mockRejectedValue(new Error("OVER_STOCK"));

    await expect(cartService.upsertItem("u1", "v1", 10)).rejects.toThrow(BadRequestError);
  });
});

describe("cartService.removeItem / clearCart", () => {
  it("delegates removeItem to the Redis repository", async () => {
    await cartService.removeItem("u1", "v1");
    expect(cartRedisRepository.removeItem).toHaveBeenCalledWith("u1", "v1");
  });

  it("delegates clearCart to the Redis repository", async () => {
    await cartService.clearCart("u1");
    expect(cartRedisRepository.clear).toHaveBeenCalledWith("u1");
  });
});
