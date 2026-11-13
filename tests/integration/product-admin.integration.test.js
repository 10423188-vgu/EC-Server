import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import express from "express";
import productRouter from "../../src/modules/product/product.routes.js";
import { Product } from "../../src/models/product.model.js";
import { productService } from "../../src/modules/product/product.service.js";
import { productMongoRepository } from "../../src/modules/product/product.mongo.repository.js";
import { Review } from "../../src/models/review.model.js";
import { deleteFromCloudinary } from "../../src/shared/utils/cloudinary.util.js";
import { buildProductFilter } from "../../src/modules/product/product.filter.js";
import {
  getProductOverview,
  listAdminProducts,
} from "../../src/modules/product/product.admin.service.js";
import { adminProductsSchema } from "../../src/modules/product/product.admin.schema.js";
import { productSchema } from "../../src/modules/product/product.schema.js";
import { prisma } from "../../src/configs/db/index.js";
import { ProductChange } from "../../src/models/product-change.model.js";

vi.mock("../../src/configs/db/index.js", () => ({
  prisma: {
    orderItem: { groupBy: vi.fn().mockResolvedValue([]) },
    $queryRaw: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("../../src/shared/utils/cloudinary.util.js", () => ({
  deleteFromCloudinary: vi.fn(),
}));
vi.mock("../../src/shared/middlewares/authenticate.middleware.js", () => ({
  authenticate: (req, res, next) => {
    const role = req.get("x-test-role");
    if (!role) return res.sendStatus(401);
    req.userId = "admin-test";
    req.userRole = role;
    next();
  },
  authorize:
    (...roles) =>
    (req, res, next) => {
      if (!roles.includes(req.userRole)) return res.sendStatus(403);
      next();
    },
}));

let database;
let httpServer;
let baseUrl;
beforeAll(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(database.getUri());
  await Promise.all([Product.init(), ProductChange.init()]);
  const app = express();
  app.use(express.json());
  app.use("/products", productRouter);
  app.use((error, _req, res, _next) =>
    res.status(error.statusCode ?? 500).json({ message: error.message }),
  );
  httpServer = await new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
  baseUrl = `http://127.0.0.1:${httpServer.address().port}/products`;
});
afterAll(async () => {
  if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
  await mongoose.disconnect();
  await database?.stop();
});
beforeEach(async () => {
  vi.clearAllMocks();
  await Review.deleteMany({});
  await Product.deleteMany({});
  await ProductChange.deleteMany({});
  await Product.create([
    {
      name: "Keyboard [Pro]",
      slug: "keyboard-pro",
      categoryId: "cat-1",
      categoryName: "Keyboards",
      categorySlug: "keyboards",
      isActive: true,
      variants: [
        { sku: "KEY-PRO", name: "Default", price: 100, stock: 3 },
        {
          sku: "KEY-OFF",
          name: "Hidden",
          price: 90,
          stock: 100,
          isActive: false,
        },
      ],
    },
    {
      name: "Mouse",
      slug: "mouse",
      categoryId: "cat-2",
      categoryName: "Mice",
      categorySlug: "mice",
      isActive: true,
      variants: [{ sku: "MOUSE", name: "Default", price: 50, stock: 0 }],
    },
    {
      name: "Archived",
      slug: "archived",
      categoryId: "cat-2",
      categoryName: "Mice",
      categorySlug: "mice",
      isActive: false,
      variants: [{ sku: "ARCHIVE", name: "Default", price: 75, stock: 5 }],
    },
  ]);
});
const query = (filters = {}) =>
  adminProductsSchema.parse({ query: filters }).query;

describe("admin products with real MongoDB", () => {
  it("admin detail includes inactive and deleted variants while public detail hides them", async () => {
    const original = await Product.findOne({ slug: "keyboard-pro" }).lean();
    await productService.deleteVariant(
      original._id,
      original.variants[0]._id,
      "admin",
    );
    const admin = await productService.getAdminProductById(original._id);
    expect(admin.variants).toHaveLength(2);
    expect(admin.variants[0].deletedAt).toBeInstanceOf(Date);
    expect(
      (await productService.getProductById(original._id)).variants,
    ).toEqual([]);
  });

  it("rejects duplicate SKUs within a product and forbids replacing stock during metadata edits", async () => {
    const original = await Product.findOne({ slug: "keyboard-pro" }).lean();
    await expect(
      productService.updateVariant(original._id, original.variants[0]._id, {
        sku: "KEY-OFF",
      }),
    ).rejects.toThrow("already exists");
    await expect(
      productService.updateVariant(original._id, original.variants[0]._id, {
        stock: 100,
      }),
    ).rejects.toThrow("stock adjustment");
    await expect(
      productService.updateVariant(original._id, original.variants[0]._id, {
        price: 100,
        salePrice: 120,
      }),
    ).rejects.toThrow("lower than price");
    await productService.updateVariant(original._id, original.variants[0]._id, {
      sku: "KEY-PRO",
      name: "Renamed",
    });
    const saved = await Product.findById(original._id).lean();
    expect(saved.variants[0]).toMatchObject({ name: "Renamed", stock: 3 });
    const parsed = productSchema.updateVariant.parse({
      params: { id: original._id, variantId: original.variants[0]._id },
      body: { name: "Another name" },
    });
    expect(parsed.body).toEqual({ name: "Another name" });
    expect(
      productSchema.updateVariant.safeParse({
        params: parsed.params,
        body: { stock: 5 },
      }).success,
    ).toBe(false);
  });
  it("includes inactive products and calculates stock only from active variants", async () => {
    const result = await listAdminProducts(
      query({ sortBy: "name", sortOrder: "asc" }),
    );
    expect(result.pagination.total).toBe(3);
    expect(
      result.data.find((product) => product.slug === "keyboard-pro"),
    ).toMatchObject({ stock: 3, variantCount: 2, price: 100 });
    expect(result.data[0].variants).toBeUndefined();
  });
  it("combines category, status, low-stock filters and pagination", async () => {
    const result = await listAdminProducts(
      query({
        status: "active",
        categorySlug: "keyboards",
        stock: "low",
        limit: "1",
      }),
    );
    expect(result.pagination.total).toBe(1);
    expect(result.data[0].slug).toBe("keyboard-pro");
    const empty = await listAdminProducts(query({ page: "2", limit: "3" }));
    expect(empty.data).toEqual([]);
    expect(empty.pagination.total).toBe(3);
  });
  it("summarizes only the requested page for metadata sorts", async () => {
    const aggregate = vi.spyOn(Product, "aggregate");
    try {
      const result = await listAdminProducts(
        query({ sortBy: "name", sortOrder: "asc", limit: "1" }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(3);
      const stages = aggregate.mock.calls[0][0];
      expect(stages.some((stage) => stage.$set)).toBe(false);
      const facet = stages.find((stage) => stage.$facet).$facet;
      expect(facet.count).toEqual([{ $count: "total" }]);
      expect(facet.data.findIndex((stage) => stage.$limit)).toBeLessThan(
        facet.data.findIndex((stage) => stage.$set),
      );
    } finally {
      aggregate.mockRestore();
    }
  });
  it("sorts computed values globally before paginating, with and without stock filters", async () => {
    for (const sortBy of ["price", "stock", "name", "updatedAt"]) {
      for (const sortOrder of ["asc", "desc"]) {
        for (const stock of [undefined, "low", "out"]) {
          const filters = { sortBy, sortOrder, ...(stock && { stock }) };
          const full = await listAdminProducts(query(filters));
          const pages = await Promise.all(
            full.data.map((_product, index) =>
              listAdminProducts(
                query({ ...filters, page: String(index + 1), limit: "1" }),
              ),
            ),
          );
          expect(
            pages.flatMap((page) => page.data.map((product) => product.id)),
          ).toEqual(full.data.map((product) => product.id));
          expect(
            pages.every(
              (page) => page.pagination.total === full.pagination.total,
            ),
          ).toBe(true);
          const values = full.data.map((product) => product[sortBy]);
          for (let index = 1; index < values.length; index++) {
            if (sortOrder === "asc")
              expect(values[index] >= values[index - 1]).toBe(true);
            else expect(values[index] <= values[index - 1]).toBe(true);
          }
        }
      }
    }
  });
  it("treats search as literal text and also searches SKU", async () => {
    expect(
      (await listAdminProducts(query({ search: "[Pro]" }))).data,
    ).toHaveLength(1);
    expect(
      (await listAdminProducts(query({ search: "key-pro" }))).data,
    ).toHaveLength(1);
    expect(
      adminProductsSchema.safeParse({ query: { limit: "invalid" } }).success,
    ).toBe(false);
  });
  it("reports catalog distribution and active out-of-stock products with fourteen empty sales days", async () => {
    const overview = await getProductOverview();
    expect(
      overview.distribution.find((category) => category.slug === "mice").count,
    ).toBe(2);
    expect(overview.outOfStock.map((product) => product.slug)).toEqual([
      "mouse",
    ]);
    expect(overview.sales).toHaveLength(14);
    expect(overview.sales.every((day) => day.total === 0)).toBe(true);
    expect(overview.topSelling).toEqual([]);
  });

  it.each([7, 30, 90])(
    "uses the selected %i-day window for both sales queries",
    async (days) => {
      const response = await fetch(`${baseUrl}/admin/overview?days=${days}`, {
        headers: { "x-test-role": "ADMIN" },
      });
      expect(response.status).toBe(200);
      const { data } = await response.json();
      expect(data.days).toBe(days);
      expect(data.sales).toHaveLength(days);
      const range =
        prisma.orderItem.groupBy.mock.calls[0][0].where.order.is.createdAt;
      expect(range.lt.getTime() - range.gte.getTime()).toBe(days * 86400000);
      expect(data.sales[0].day).toBe(range.gte.toISOString().slice(0, 10));
      expect(data.sales.at(-1).day).toBe(
        new Date(range.lt.getTime() - 86400000).toISOString().slice(0, 10),
      );
      expect(prisma.$queryRaw.mock.calls[0].slice(1)).toEqual([
        range.gte,
        range.lt,
      ]);
    },
  );

  it("rejects invalid overview periods before querying sales", async () => {
    const response = await fetch(`${baseUrl}/admin/overview?days=365`, {
      headers: { "x-test-role": "ADMIN" },
    });
    expect(response.status).not.toBe(200);
    expect(prisma.orderItem.groupBy).not.toHaveBeenCalled();
  });

  it("preserves IDs, inventory, photos and reviews through delete and restore", async () => {
    const original = await Product.findOne({ slug: "keyboard-pro" }).lean();
    await Product.updateOne(
      { _id: original._id },
      { $set: { images: [{ url: "https://example.test/product.webp" }] } },
    );
    await Review.create({
      productId: original._id,
      userId: "buyer",
      userName: "Buyer",
      rating: 5,
      title: "Good",
      body: "Works well",
    });
    await productService.deleteProduct(original._id, "admin-1");
    const deleted = await Product.findById(original._id).lean();
    expect(deleted).toMatchObject({ isActive: false, deletedBy: "admin-1" });
    expect(deleted.deletedAt).toBeInstanceOf(Date);
    expect(deleted.variants).toEqual(original.variants);
    expect(deleted.images[0].url).toBe("https://example.test/product.webp");
    expect(await Review.countDocuments({ productId: original._id })).toBe(1);
    expect(deleteFromCloudinary).not.toHaveBeenCalled();
    await productService.deleteProduct(original._id, "admin-2");
    expect((await Product.findById(original._id).lean()).deletedAt).toEqual(
      deleted.deletedAt,
    );
    expect((await Product.findById(original._id).lean()).deletedBy).toBe(
      "admin-1",
    );
    await expect(productService.getProductById(original._id)).rejects.toThrow(
      "Product not found",
    );
    await expect(
      productService.updateProduct(original._id, { isActive: true }),
    ).rejects.toThrow("Product not found");
    const trash = await listAdminProducts(query({ trash: "true" }));
    expect(trash.data.map((product) => product.id)).toEqual([original._id]);
    expect((await listAdminProducts(query())).pagination.total).toBe(2);
    expect(
      (await getProductOverview()).distribution.some(
        (category) => category.slug === "keyboards",
      ),
    ).toBe(false);
    const restored = await productService.restoreProduct(original._id);
    expect(restored).toMatchObject({
      id: original._id,
      isActive: false,
      deletedAt: null,
    });
    expect(restored.variants[0].id).toBe(original.variants[0]._id);
    expect(restored.variants[0].stock).toBe(3);
    await expect(productService.getProductById(original._id)).rejects.toThrow(
      "Product not found",
    );
    expect(
      await productService.getAdminProductById(original._id),
    ).toMatchObject({ id: original._id });
    await productService.updateProduct(original._id, { isActive: true });
    await productService.restoreProduct(original._id);
    expect(await productService.getProductById(original._id)).toMatchObject({
      id: original._id,
      isActive: true,
    });
  });

  it("keeps SKU and slug reserved in trash", async () => {
    const original = await Product.findOne({ slug: "keyboard-pro" }).lean();
    await productService.deleteProduct(original._id, "admin");
    expect(await productMongoRepository.skuExistsAny(["KEY-PRO"])).toBe(
      "KEY-PRO",
    );
    await expect(
      Product.create({ ...original, _id: "different-id" }),
    ).rejects.toMatchObject({ code: 11000 });
    await expect(productService.restoreProduct("missing")).rejects.toThrow(
      "Product not found",
    );
  });

  it("soft deletes variants without losing stock and restores them as inactive", async () => {
    const original = await Product.findOne({ slug: "keyboard-pro" }).lean();
    const variantId = original.variants[0]._id;
    await productService.deleteVariant(original._id, variantId, "admin");
    await productService.deleteVariant(original._id, variantId, "other-admin");
    const deleted = await Product.findById(original._id).lean();
    expect(deleted.variants).toHaveLength(2);
    expect(deleted.variants[0]).toMatchObject({
      _id: variantId,
      stock: 3,
      isActive: false,
      deletedBy: "admin",
    });
    expect(deleted.minPrice).toBeNull();
    expect(deleted.inStock).toBe(false);
    expect(deleteFromCloudinary).not.toHaveBeenCalled();
    expect(
      (await listAdminProducts(query({ search: "[Pro]" }))).data[0],
    ).toMatchObject({ variantCount: 1, stock: 0 });
    await expect(
      productService.updateVariant(original._id, variantId, { isActive: true }),
    ).rejects.toThrow("Variant not found");
    const restored = await productService.restoreVariant(
      original._id,
      variantId,
    );
    expect(restored).toMatchObject({
      id: variantId,
      stock: 3,
      isActive: false,
      deletedAt: null,
    });
    await productService.updateVariant(original._id, variantId, {
      isActive: true,
    });
    expect((await Product.findById(original._id).lean()).minPrice).toBe(100);
    await productService.restoreVariant(original._id, variantId);
    expect(
      (await Product.findById(original._id).lean()).variants[0].isActive,
    ).toBe(true);
  });

  it("supports old documents without deletedAt and keeps deleted products out of related lists", async () => {
    const original = await Product.findOne({ slug: "keyboard-pro" }).lean();
    await Product.collection.updateOne(
      { _id: original._id },
      { $unset: { deletedAt: "", "variants.0.deletedAt": "" } },
    );
    expect(
      (await productService.getProducts({ page: 1, limit: 10 })).data.some(
        (product) => product.id === original._id,
      ),
    ).toBe(true);
    await productService.deleteProduct(original._id, "admin");
    expect(await Product.find(buildProductFilter({})).countDocuments()).toBe(1);
    expect(
      await productMongoRepository.findForRelated(original._id),
    ).toBeNull();
    const related = await productMongoRepository.findRelated("another", {
      categoryId: "cat-1",
      brandId: null,
      tags: [],
    });
    expect(related).toEqual([]);
  });

  it("exposes trash and restoration only behind admin route guards", async () => {
    const original = await Product.findOne({ slug: "keyboard-pro" }).lean();
    for (const path of [
      `/admin/${original._id}`,
      "/admin/list?trash=true",
      `/${original._id}/restore`,
      `/${original._id}/variants/${original.variants[0]._id}/restore`,
    ]) {
      const method = path.endsWith("/restore") ? "POST" : "GET";
      expect((await fetch(baseUrl + path, { method })).status).toBe(401);
      expect(
        (
          await fetch(baseUrl + path, {
            method,
            headers: { "x-test-role": "USER" },
          })
        ).status,
      ).toBe(403);
    }
    const headers = { "x-test-role": "ADMIN" };
    expect((await fetch(baseUrl + "/admin/list", { headers })).status).toBe(
      200,
    );
    expect((await fetch(baseUrl + "/admin/overview", { headers })).status).toBe(
      200,
    );
    expect(
      (await fetch(baseUrl + `/${original._id}`, { method: "DELETE", headers }))
        .status,
    ).toBe(200);
    const trash = await (
      await fetch(baseUrl + "/admin/list?trash=true", { headers })
    ).json();
    expect(trash.data[0]).toMatchObject({
      id: original._id,
      deletedBy: "admin-test",
    });
    expect((await fetch(baseUrl + `/${original._id}`)).status).toBe(404);
    const restored = await (
      await fetch(baseUrl + `/${original._id}/restore`, {
        method: "POST",
        headers,
      })
    ).json();
    expect(restored.data).toMatchObject({
      id: original._id,
      isActive: false,
      deletedAt: null,
    });
    expect(
      (await fetch(baseUrl + `/admin/${original._id}`, { headers })).status,
    ).toBe(200);
  });
});
