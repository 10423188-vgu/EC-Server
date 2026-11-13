import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateCategoryParent } from "../../../src/modules/category/category.hierarchy.js";

const tx = { $executeRaw: vi.fn(), category: { findMany: vi.fn() } };
beforeEach(() => {
  vi.clearAllMocks();
  tx.category.findMany.mockResolvedValue([
    { id: "root", parentId: null },
    { id: "child", parentId: "root" },
    { id: "leaf", parentId: "child" },
  ]);
});
describe("category hierarchy", () => {
  it("accepts a valid parent and locks before reading the tree", async () => {
    await expect(
      validateCategoryParent(tx, "leaf", "root"),
    ).resolves.toBeUndefined();
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.category.findMany.mock.invocationCallOrder[0],
    );
  });
  it("accepts moving to root without reading the tree", async () => {
    await validateCategoryParent(tx, "leaf", null);
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.category.findMany).not.toHaveBeenCalled();
  });
  it.each(["root", "child", "leaf"])(
    "rejects setting root's parent to %s",
    async (parent) => {
      await expect(validateCategoryParent(tx, "root", parent)).rejects.toThrow(
        "descendants",
      );
    },
  );
  it("rejects missing parents", async () => {
    await expect(validateCategoryParent(tx, "leaf", "missing")).rejects.toThrow(
      "not found",
    );
  });
  it("rejects an already corrupted parent chain instead of looping", async () => {
    tx.category.findMany.mockResolvedValue([
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ]);
    await expect(validateCategoryParent(tx, null, "a")).rejects.toThrow(
      "descendants",
    );
  });
});
