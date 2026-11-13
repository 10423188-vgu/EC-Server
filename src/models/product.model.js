import mongoose from "mongoose";
import { randomUUID } from "crypto";

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    altText: { type: String, default: null },
    position: { type: Number, default: 0 },
  },
  { _id: false },
);

const attributeSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    value: { type: String, required: true },
  },
  { _id: false },
);

const variantSchema = new mongoose.Schema(
  {
    _id: { type: String, default: () => randomUUID() },
    sku: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    salePrice: { type: Number, default: null },
    stock: { type: Number, default: 0 },
    weight: { type: Number, default: null },
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, default: null },
    options: { type: Map, of: String, default: () => new Map() },
    images: { type: [imageSchema], default: [] },
    // why: an outbox event may retry after Mongo already restored this variant's stock.
    stockRestoreKeys: { type: [String], default: [], select: false },
    stockDeductionKeys: { type: [String], default: [], select: false },
  },
  { timestamps: true },
);

const productSchema = new mongoose.Schema(
  {
    _id: { type: String, default: () => randomUUID() },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: null },

    categoryId: { type: String, required: true },
    categorySlug: { type: String, required: true },
    categoryName: { type: String, required: true },

    brandId: { type: String, default: null },
    brandSlug: { type: String, default: null },
    brandName: { type: String, default: null },

    isActive: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, default: null },

    tags: { type: [String], default: [] },

    images: { type: [imageSchema], default: [] },

    attributes: { type: [attributeSchema], default: [] },
    variants: { type: [variantSchema], default: [] },

    // why: minPrice/hasSale/inStock summarize the variants array, kept in sync by the
    // repository on every write that touches variants — lets sort/filter use real
    // indexes instead of computing over variants for the whole result set each time
    minPrice: { type: Number, default: null },
    hasSale: { type: Boolean, default: false },
    inStock: { type: Boolean, default: false },

    reviewStats: {
      count: { type: Number, default: 0 },
      average: { type: Number, default: 0 },
      distribution: {
        1: { type: Number, default: 0 },
        2: { type: Number, default: 0 },
        3: { type: Number, default: 0 },
        4: { type: Number, default: 0 },
        5: { type: Number, default: 0 },
      },
    },
  },
  { timestamps: true },
);

productSchema.index({ categorySlug: 1 });
productSchema.index({ deletedAt: 1, isActive: 1, updatedAt: -1 });
productSchema.index({ brandSlug: 1 });
productSchema.index({ tags: 1 });
productSchema.index({ isActive: 1, isFeatured: 1 });
productSchema.index({ isActive: 1, createdAt: -1 });
productSchema.index({ isActive: 1, categorySlug: 1 });
productSchema.index({ isActive: 1, brandSlug: 1 });
productSchema.index({ name: "text", description: "text" });
productSchema.index({ "variants.sku": 1 }, { unique: true, sparse: true });
productSchema.index({ "variants._id": 1 });
productSchema.index({ isActive: 1, minPrice: 1 });
productSchema.index({ isActive: 1, name: 1 });
productSchema.index({ isActive: 1, hasSale: 1 });
productSchema.index({ isActive: 1, inStock: 1 });
productSchema.index({ categoryId: 1, isActive: 1 });
productSchema.index({ brandId: 1 });
// why: ESR (Equality-Sort-Range) order matching product.filter.js — every list query starts
// with isActive:true, then optionally category/brand, then sorts/filters by price or date
productSchema.index({ isActive: 1, categorySlug: 1, minPrice: 1 });
productSchema.index({ isActive: 1, categorySlug: 1, createdAt: -1 });
productSchema.index({ isActive: 1, brandSlug: 1, minPrice: 1 });

export const Product = mongoose.model("Product", productSchema);
