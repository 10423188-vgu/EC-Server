import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import express from "express";
import productRouter from "../../src/modules/product/product.routes.js";
import { Product } from "../../src/models/product.model.js";
import { ProductChange } from "../../src/models/product-change.model.js";

vi.mock("../../src/configs/db/index.js", () => ({
  prisma: {
    user: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: "admin", name: "Admin tester" }]),
    },
    category: {
      findUnique: vi.fn().mockResolvedValue({
        id: "11111111-1111-4111-8111-111111111111",
        name: "Electronics",
        slug: "electronics",
      }),
    },
    brand: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));
vi.mock("../../src/shared/middlewares/authenticate.middleware.js", () => ({
  authenticate: (req, res, next) => {
    if (!req.get("x-role")) return res.sendStatus(401);
    req.userId = "admin";
    req.userRole = req.get("x-role");
    next();
  },
  authorize:
    (...roles) =>
    (req, res, next) =>
      roles.includes(req.userRole) ? next() : res.sendStatus(403),
}));
let database, server, url, first, second;
const headers = { "x-role": "ADMIN", "Content-Type": "application/json" };
const request = (path, method = "GET", body, extraHeaders = headers) =>
  fetch(url + path, {
    method,
    headers: extraHeaders,
    ...(body && { body: JSON.stringify(body) }),
  });
const bulk = (action, ids) => request("/admin/bulk", "POST", { action, ids });
beforeAll(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(database.getUri());
  await Promise.all([Product.init(), ProductChange.init()]);
  const app = express();
  app.use(express.json());
  app.use("/products", productRouter);
  app.use((error, _req, res, _next) => {
    if (!res.headersSent)
      res
        .status(error.name === "ZodError" ? 400 : (error.statusCode ?? 500))
        .json({ message: error.message });
  });
  server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  url = `http://127.0.0.1:${server.address().port}/products`;
}, 120000);
afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await database?.stop();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([Product.deleteMany({}), ProductChange.deleteMany({})]);
  const make = (name, isActive) =>
    Product.create({
      name,
      slug: name.toLowerCase(),
      categoryId: "cat",
      categoryName: "Electronics",
      categorySlug: "electronics",
      isActive,
      images: [{ url: "https://example.test/image.png" }],
      variants: [
        { sku: `${name}-1`, name: "Default", price: 100, stock: 10 },
        {
          sku: `${name}-2`,
          name: "Second",
          price: 200,
          stock: 5,
          isActive: false,
        },
      ],
    });
  first = await make("Alpha", true);
  second = await make("Beta", false);
});

describe("Product admin bulk, export and audit", () => {
  it("rejects stale metadata without overwriting another admin's changes", async () => {
    const snapshot = (await (await request(`/admin/${first._id}`)).json()).data;
    const save = (data) =>
      request(`/${first._id}`, "PUT", {
        expectedRevision: snapshot.revision,
        ...data,
      });
    expect((await save({ description: "Edited by A" })).status).toBe(200);
    const rejected = await save({
      name: "Edited by B",
      description: snapshot.description,
    });
    expect(rejected.status).toBe(409);
    expect((await rejected.json()).message).toContain("Reopen the editor");
    const current = await Product.findById(first._id).lean();
    expect(current.description).toBe("Edited by A");
    expect(current.name).toBe("Alpha");
    expect(await ProductChange.countDocuments({ productId: first._id })).toBe(
      1,
    );
  });

  it("allows only one concurrent metadata save from the same revision", async () => {
    const snapshot = (await (await request(`/admin/${first._id}`)).json()).data;
    const results = await Promise.all(
      ["Admin A", "Admin B"].map((name) =>
        request(`/${first._id}`, "PUT", {
          name,
          expectedRevision: snapshot.revision,
        }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(await ProductChange.countDocuments({ productId: first._id })).toBe(
      1,
    );
  });

  it("guards variant edits independently of metadata, stock and other variants", async () => {
    const snapshot = (await (await request(`/admin/${first._id}`)).json()).data;
    const variant = snapshot.variants[0];
    await Product.updateOne(
      { _id: first._id },
      { $inc: { "variants.0.stock": 2 } },
    );
    const path = `/${first._id}/variants/${variant.id}`;
    expect(
      (
        await request(path, "PUT", {
          price: 150,
          expectedRevision: variant.revision,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(path, "PUT", {
          price: 175,
          expectedRevision: variant.revision,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`/${first._id}`, "PUT", {
          description: "Metadata still current",
          expectedRevision: snapshot.revision,
        })
      ).status,
    ).toBe(200);
    const other = snapshot.variants[1];
    expect(
      (
        await request(`/${first._id}/variants/${other.id}`, "PUT", {
          name: "Other variant",
          expectedRevision: other.revision,
        })
      ).status,
    ).toBe(200);
    const current = await Product.findById(first._id).lean();
    expect(current.variants[0].stock).toBe(12);
    expect(current.variants[0].price).toBe(150);
  });

  it("keeps before/after history consistent when two admins edit concurrently", async () => {
    const responses = await Promise.all([
      request(`/${first._id}`, "PUT", { name: "First edit" }),
      request(`/${first._id}`, "PUT", { name: "Second edit" }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const entries = await ProductChange.find({ productId: first._id }).lean();
    expect(entries).toHaveLength(2);
    const changes = entries.map((entry) =>
      entry.changes.find((change) => change.field === "name"),
    );
    const initial = changes.find((change) => change.before === "Alpha");
    const subsequent = changes.find(
      (change) => change.before === initial.after,
    );
    expect(subsequent).toBeDefined();
    expect((await Product.findById(first._id)).name).toBe(subsequent.after);
  });
  it("guards every new route from anonymous and non-admin users", async () => {
    for (const [path, method, body] of [
      ["/admin/bulk", "POST", { action: "trash", ids: [first._id] }],
      ["/admin/export", "POST", {}],
      [`/admin/${first._id}/history`, "GET"],
    ]) {
      expect((await request(path, method, body, {})).status).toBe(401);
      expect(
        (
          await request(path, method, body, {
            "x-role": "USER",
            "Content-Type": "application/json",
          })
        ).status,
      ).toBe(403);
    }
  });
  it("updates a batch, reports no-ops and missing IDs, and audits only changed products", async () => {
    const missing = randomUUID();
    const response = await bulk("deactivate", [first._id, second._id, missing]);
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.changed).toEqual([first._id]);
    expect(data.skipped).toEqual([second._id]);
    expect(data.failed[0].id).toBe(missing);
    expect(await ProductChange.countDocuments()).toBe(1);
    expect((await ProductChange.findOne().lean()).changes).toEqual([
      { field: "isActive", before: true, after: false },
    ]);
  });
  it("trashes and restores as inactive without changing photos, variants or stock; retries create no duplicate history", async () => {
    await bulk("trash", [first._id, second._id]);
    await bulk("trash", [first._id, second._id]);
    expect(await ProductChange.countDocuments()).toBe(2);
    const blocked = await (await bulk("activate", [first._id])).json();
    expect(blocked.data.failed).toHaveLength(1);
    await bulk("restore", [first._id, second._id]);
    const restored = await Product.findById(first._id).lean();
    expect(restored.isActive).toBe(false);
    expect(restored.deletedAt).toBeNull();
    expect(restored.variants.map((v) => v.stock)).toEqual([10, 5]);
    expect(restored.images).toHaveLength(1);
    await bulk("restore", [first._id]);
    expect(await ProductChange.countDocuments()).toBe(4);
  });
  it("rejects duplicate IDs and oversized batches before any writes", async () => {
    expect((await bulk("trash", [first._id, first._id])).status).toBe(400);
    expect(
      (await bulk("trash", Array.from({ length: 101 }, randomUUID))).status,
    ).toBe(400);
    expect((await Product.findById(first._id)).deletedAt).toBeNull();
  });
  it("rolls back the complete batch if audit insertion fails", async () => {
    vi.spyOn(ProductChange, "insertMany").mockRejectedValueOnce(
      new Error("Audit unavailable"),
    );
    expect((await bulk("trash", [first._id, second._id])).status).toBe(500);
    expect(await Product.countDocuments({ deletedAt: null })).toBe(2);
    expect(await ProductChange.countDocuments()).toBe(0);
  });
  it("records actual before/after values and actor for individual metadata and variant price writes", async () => {
    expect(
      (
        await request(`/${first._id}`, "PUT", {
          name: "Alpha updated",
          isFeatured: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/${first._id}/variants/${first.variants[0]._id}`,
          "PUT",
          { price: 120 },
        )
      ).status,
    ).toBe(200);
    const response = await request(`/admin/${first._id}/history?limit=1`);
    expect(response.status).toBe(200);
    const history = await response.json();
    expect(history.pagination).toMatchObject({ total: 2, totalPages: 2 });
    expect(history.data[0].changedByName).toBe("Admin tester");
    expect(history.data[0].changes).toContainEqual({
      field: `variants.${first.variants[0]._id}.price`,
      before: 100,
      after: 120,
    });
    expect((await Product.findById(first._id)).variants[0].stock).toBe(10);
  });
  it("rolls back individual product writes when history fails and skips no-op saves", async () => {
    await request(`/${first._id}`, "PUT", { name: "Alpha" });
    expect(await ProductChange.countDocuments()).toBe(0);
    vi.spyOn(ProductChange, "create").mockRejectedValueOnce(
      new Error("Audit unavailable"),
    );
    expect(
      (await request(`/${first._id}`, "PUT", { name: "Should rollback" }))
        .status,
    ).toBe(500);
    expect((await Product.findById(first._id)).name).toBe("Alpha");
  });
  it("audits create, delete and restore, including variant actions", async () => {
    const created = await request("/", "POST", {
      name: "Created",
      slug: "created",
      categoryId: "11111111-1111-4111-8111-111111111111",
      variants: [{ name: "New", sku: "NEW", price: 100, stock: 2 }],
    });
    expect(created.status).toBe(201);
    const id = (await created.json()).data.id;
    await request(`/${id}`, "DELETE");
    await request(`/${id}/restore`, "POST");
    expect(await ProductChange.countDocuments({ productId: id })).toBe(3);
    await request(`/${first._id}/variants/${first.variants[0]._id}`, "DELETE");
    await request(
      `/${first._id}/variants/${first.variants[0]._id}/restore`,
      "POST",
    );
    expect(await ProductChange.countDocuments({ productId: first._id })).toBe(
      2,
    );
  });
  it("exports filtered results across pages with a row for each non-deleted variant", async () => {
    const response = await request(
      "/admin/export?search=Alpha&page=999&limit=1",
      "POST",
      {},
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]);
    const csv = new TextDecoder().decode(bytes);
    expect(csv.trim().split("\r\n")).toHaveLength(3);
    expect(csv).toContain('"Alpha-2"');
    expect(csv).not.toContain('"Beta"');
  });
  it("exports only selected IDs using fresh stock and escapes spreadsheet formulas, quotes and commas", async () => {
    await Product.updateOne(
      { _id: first._id },
      { $set: { name: '=SUM(1,2) "test"', "variants.0.stock": 7 } },
    );
    const response = await request(
      "/admin/export?search=does-not-match",
      "POST",
      { ids: [first._id] },
    );
    const csv = await response.text();
    expect(csv).toContain('"\'=SUM(1,2) ""test"""');
    expect(csv).toContain('"7"');
    expect(csv).not.toContain('"Beta"');
    expect(
      (await request("/admin/export", "POST", { ids: [randomUUID()] })).status,
    ).toBe(409);
  });
  it("exports trash only when requested and exposes history for deleted products", async () => {
    await bulk("trash", [first._id]);
    expect(
      await (await request("/admin/export", "POST", {})).text(),
    ).not.toContain('"Alpha"');
    expect(
      await (await request("/admin/export?trash=true", "POST", {})).text(),
    ).toContain('"Alpha"');
    expect((await request(`/admin/${first._id}/history`)).status).toBe(200);
  });
});
