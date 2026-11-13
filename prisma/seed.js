import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import mongoose from "mongoose";
import dns from "node:dns/promises";
import { Product } from "../src/models/product.model.js";
import { productMongoRepository } from "../src/modules/product/product.mongo.repository.js";

// Same DNS override as mongo.js — avoids SRV lookup failures on some ISPs
dns.setServers(["1.1.1.1", "8.8.8.8"]);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ─── CATEGORIES ──────────────────────────────────────────────────────────────
const categories = [
  {
    name: "Fashion",
    slug: "fashion",
    description: "Clothing, shoes and accessories",
  },
  {
    name: "Electronics",
    slug: "electronics",
    description: "Phones, gadgets and accessories",
  },
  {
    name: "Home & Living",
    slug: "home-living",
    description: "Furniture, decor and essentials",
  },
  {
    name: "Beauty & Personal Care",
    slug: "beauty-personal-care",
    description: "Skincare, cosmetics and wellness",
  },
  {
    name: "Sports & Outdoor",
    slug: "sports-outdoor",
    description: "Gear for active lifestyle",
  },
  {
    name: "Kids & Toys",
    slug: "kids-toys",
    description: "Toys, learning and fun",
  },
];

// ─── BRANDS ──────────────────────────────────────────────────────────────────
const brands = [
  { name: "Zara", slug: "zara" },
  { name: "ASUS", slug: "asus" },
  { name: "Apple", slug: "apple" },
  { name: "IKEA", slug: "ikea" },
  { name: "Nike", slug: "nike" },
  { name: "LEGO", slug: "lego" },
  { name: "UNIQLO", slug: "uniqlo" },
  { name: "adidas", slug: "adidas" },
  { name: "su:m37°", slug: "sum37" },
];

// ─── PRODUCTS (go to MongoDB) ─────────────────────────────────────────────────
const productSeed = [
  // ── ELECTRONICS — ASUS ROG ────────────────────────────────────────────────
  {
    name: "ASUS ROG Zephyrus Duo 16 GX650RX-LO156W",
    slug: "asus-rog-zephyrus-duo-16-gx650rx-lo156w",
    description:
      "Flagship gaming laptop featuring AMD Ryzen 9 6900HX (8-core/16-thread, boost up to 4.9GHz) and NVIDIA GeForce RTX 3080 Ti 16GB VRAM. Equipped with a 16-inch Mini LED QHD+ 165Hz 100% DCI-P3 HDR 1100-nit main display and a 14-inch 4K touchscreen ScreenPad Plus for unmatched multitasking.",
    categorySlug: "electronics",
    brandSlug: "asus",
    isFeatured: true,
    images: [
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1777731600/jtm0ynevkndilceckfqf.webp",
        position: 0,
      },
    ],
    variants: [
      {
        sku: "GX650RX-LO156W-32-2T",
        name: "32GB DDR5 / 2TB SSD",
        price: 89990000,
        salePrice: 79990000,
        stock: 10,
        options: { RAM: "32GB DDR5", Storage: "2TB SSD" },
        images: [
          {
            url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1777731600/jtm0ynevkndilceckfqf.webp",
            position: 0,
          },
          {
            url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1777731602/siiorberwpncldodrgli.webp",
            position: 1,
          },
          {
            url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1777731603/vqrnsm1t23vqscjbrj6e.webp",
            position: 2,
          },
          {
            url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1777731604/amal7ngrwpnhdjoz23gp.webp",
            position: 3,
          },
          {
            url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1777731605/mutzq8mm1prlfl0wqhij.webp",
            position: 4,
          },
          {
            url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1777731606/cj7wiwn6pquruhlvcard.webp",
            position: 5,
          },
          {
            url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1777731605/xbv3cnmwh7mapnfl09jy.webp",
            position: 6,
          },
          {
            url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1777731607/bjtf35gfoxg4jlx5k1yj.webp",
            position: 7,
          },
        ],
      },
    ],
    attributes: [
      {
        key: "CPU",
        value: "AMD Ryzen 9 6900HX (8 cores / 16 threads, boost ~4.9GHz)",
      },
      { key: "GPU", value: "NVIDIA GeForce RTX 3080 Ti 16GB GDDR6" },
      { key: "RAM", value: "32GB DDR5 (upgradeable up to 64GB)" },
      { key: "Storage", value: "2TB PCIe 4.0 NVMe SSD" },
      {
        key: "Main Display",
        value: "16-inch QHD+ Mini LED 165Hz 100% DCI-P3 HDR 1100 nits",
      },
      {
        key: "Secondary Display",
        value: "14-inch ScreenPad Plus 4K touchscreen",
      },
      { key: "Cooling", value: "AAS Plus 2.0 + Vapor Chamber + Dual Fan" },
      { key: "Battery", value: "90Wh (~4–6h everyday use)" },
      { key: "OS", value: "Windows 11 Home" },
    ],
    tags: ["new-arrival", "featured"],
  },

  // ── ELECTRONICS — iPhone ─────────────────────────────────────────────────
  {
    name: "Apple iPhone 17 Pro",
    slug: "apple-iphone-17-pro",
    description:
      "Apple's most powerful iPhone with A19 Pro chip, 48MP Fusion camera system, and premium titanium design.",
    categorySlug: "electronics",
    brandSlug: "apple",
    isFeatured: true,
    images: [
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1777729270/mdsvg2oteuhbbm9sauaj.webp",
        position: 0,
      },
    ],
    variants: [
      {
        sku: "IP17P-256-ORG",
        name: "256GB Desert Titanium",
        price: 36990000,
        stock: 20,
        options: { Storage: "256GB", Color: "Desert Titanium" },
        images: [
          {
            url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1777729270/mdsvg2oteuhbbm9sauaj.webp",
            position: 0,
          },
          {
            url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1777731248/edphm2e8p4dpblqlkdnl.webp",
            position: 1,
          },
          {
            url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1777731249/ks5dg0r9q2udlsnurpsk.webp",
            position: 2,
          },
          {
            url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1777731249/k8bunqcrop0mvldqibhz.webp",
            position: 3,
          },
        ],
      },
      {
        sku: "IP17P-256-SLV",
        name: "256GB Silver Titanium",
        price: 36990000,
        stock: 20,
        options: { Storage: "256GB", Color: "Silver Titanium" },
        images: [
          {
            url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1777735114/pekecboruz2cdpjqdeci.webp",
            position: 0,
          },
          {
            url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1777735113/vxligxv9ordvdtfqh2sl.webp",
            position: 1,
          },
          {
            url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1777735114/c8jt1eyfnbpmigqdorcs.webp",
            position: 2,
          },
        ],
      },
    ],
    attributes: [
      { key: "Chip", value: "Apple A19 Pro" },
      { key: "Display", value: "6.3-inch Super Retina XDR ProMotion 120Hz" },
      {
        key: "Camera",
        value: "48MP Fusion + 12MP Ultra Wide + 12MP 5x Tetraprism",
      },
      { key: "Battery", value: "Up to 30 hours video playback" },
      { key: "Build", value: "Titanium frame with Ceramic Shield" },
    ],
    tags: ["new-arrival", "best-seller", "featured"],
  },

  // ── KIDS & TOYS ───────────────────────────────────────────────────────────
  {
    name: "LEGO Editions FIFA World Cup Official Trophy 43020",
    slug: "lego-editions-fifa-world-cup-official-trophy-43020",
    description:
      "A masterpiece for football fans. This 2,842-piece set meticulously recreates the iconic FIFA World Cup Trophy.",
    categorySlug: "kids-toys",
    brandSlug: "lego",
    isFeatured: true,
    images: [
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1777737428/njkvy8ojnr5ufemqq2kp.webp",
        position: 0,
      },
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1777737428/lp6s8ojtixqckpdfkmri.webp",
        position: 1,
      },
    ],
    variants: [
      {
        sku: "LEGO-43020-WC26",
        name: "Official Edition",
        price: 5999000,
        stock: 15,
        options: {},
      },
    ],
    attributes: [
      { key: "Theme", value: "LEGO Editions (FIFA World Cup 2026)" },
      { key: "Set Number", value: "43020" },
      { key: "Pieces", value: "2,842 pieces" },
      { key: "Minifigure", value: "1 Exclusive World Cup 2026 Character" },
      { key: "Age Range", value: "12+" },
    ],
    tags: ["new-arrival", "featured"],
  },

  // Source: https://www.nike.com/vn/t/air-force-1-07-mens-shoes-WrLlWX/CW2288-111
  {
    name: "Nike Air Force 1 '07 White/White",
    slug: "nike-air-force-1-07-white-white",
    description:
      "Classic low-top shoes with a leather upper, perforated toe box, Nike Air cushioning and a rubber outsole.",
    categorySlug: "fashion",
    brandSlug: "nike",
    isFeatured: true,
    images: [
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206834/ec/products/fashion/nike-air-force-1-07-white-white-cutout.png",
        altText: "Nike Air Force 1 '07 White/White",
        position: 0,
      },
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206836/ec/products/fashion/nike-air-force-1-07-outsole-cutout.png",
        altText: "Nike Air Force 1 '07 outsole",
        position: 1,
      },
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206834/ec/products/fashion/nike-air-force-1-07-angle-cutout.png",
        altText: "Nike Air Force 1 '07 angled view",
        position: 2,
      },
    ],
    variants: [
      {
        sku: "CW2288-111-42",
        name: "White/White / EU 42",
        price: 2929000,
        salePrice: 2629000,
        stock: 5,
        options: { Color: "White/White", Size: "EU 42" },
      },
      {
        sku: "CW2288-111-43",
        name: "White/White / EU 43",
        price: 2929000,
        salePrice: 2629000,
        stock: 5,
        options: { Color: "White/White", Size: "EU 43" },
      },
      {
        sku: "CW2288-111-44",
        name: "White/White / EU 44",
        price: 2929000,
        salePrice: 2629000,
        stock: 5,
        options: { Color: "White/White", Size: "EU 44" },
      },
    ],
    attributes: [
      { key: "Style", value: "CW2288-111" },
      { key: "Upper", value: "Leather with perforated toe box" },
      { key: "Cushioning", value: "Nike Air" },
    ],
  },

  // Source: https://www.uniqlo.com/vn/vi/products/E465185-000/00?colorCode=COL00
  {
    name: "UNIQLO AIRism Cotton Oversized T-Shirt White",
    slug: "uniqlo-airism-cotton-oversized-t-shirt-white",
    description:
      "Unisex crew-neck T-shirt with a relaxed fit, dropped shoulders and smooth AIRism Cotton fabric.",
    categorySlug: "fashion",
    brandSlug: "uniqlo",
    images: [
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206837/ec/products/fashion/uniqlo-airism-cotton-oversized-t-shirt-white-cutout.png",
        altText: "UNIQLO AIRism Cotton oversized T-shirt in white",
        position: 0,
      },
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206837/ec/products/fashion/uniqlo-airism-t-shirt-back-cutout.png",
        altText: "UNIQLO AIRism Cotton oversized T-shirt back view",
        position: 1,
      },
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206838/ec/products/fashion/uniqlo-airism-t-shirt-angle-cutout.png",
        altText: "UNIQLO AIRism Cotton oversized T-shirt angled view",
        position: 2,
      },
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206839/ec/products/fashion/uniqlo-airism-t-shirt-neck-cutout.png",
        altText: "UNIQLO AIRism Cotton oversized T-shirt front neckline view",
        position: 3,
      },
    ],
    variants: [
      {
        sku: "UQ-465185-WHT-S",
        name: "White / S",
        price: 391000,
        stock: 5,
        options: { Color: "White", Size: "S" },
      },
      {
        sku: "UQ-465185-WHT-M",
        name: "White / M",
        price: 391000,
        stock: 5,
        options: { Color: "White", Size: "M" },
      },
      {
        sku: "UQ-465185-WHT-L",
        name: "White / L",
        price: 391000,
        stock: 5,
        options: { Color: "White", Size: "L" },
      },
    ],
    attributes: [
      { key: "Fit", value: "Oversized" },
      { key: "Neckline", value: "Crew neck" },
      { key: "Fabric", value: "53% cotton, 47% polyester" },
    ],
  },

  // Source: https://www.uniqlo.com/vn/vi/products/E487742-000/00
  {
    name: "UNIQLO Straight Jeans Blue",
    slug: "uniqlo-straight-jeans-blue",
    description:
      "Straight-cut men's jeans in blue denim, with a straight leg from waist to hem.",
    categorySlug: "fashion",
    brandSlug: "uniqlo",
    images: [
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206840/ec/products/fashion/uniqlo-straight-jeans-blue-cutout.png",
        altText: "UNIQLO men's straight jeans in blue",
        position: 0,
      },
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206840/ec/products/fashion/uniqlo-straight-jeans-back-cutout.png",
        altText: "UNIQLO straight jeans back view in dark indigo",
        position: 1,
      },
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206842/ec/products/fashion/uniqlo-straight-jeans-angle-cutout.png",
        altText: "UNIQLO straight jeans angled view in dark indigo",
        position: 2,
      },
    ],
    variants: [
      {
        sku: "UQ-487742-BLU-30",
        name: "Blue / 30 inch",
        price: 980000,
        salePrice: 829000,
        stock: 5,
        options: { Color: "Blue", Size: "30 inch" },
      },
      {
        sku: "UQ-487742-BLU-31",
        name: "Blue / 31 inch",
        price: 980000,
        salePrice: 829000,
        stock: 5,
        options: { Color: "Blue", Size: "31 inch" },
      },
      {
        sku: "UQ-487742-BLU-32",
        name: "Blue / 32 inch",
        price: 980000,
        salePrice: 829000,
        stock: 5,
        options: { Color: "Blue", Size: "32 inch" },
      },
    ],
    attributes: [
      { key: "Fit", value: "Straight" },
      { key: "Main fabric", value: "100% cotton" },
      { key: "Style", value: "487742" },
    ],
  },

  // Source: https://www.adidas.com.vn/en/manchester-united-26-27-home-jersey-authentic/KA6868.html
  {
    name: "Manchester United 26/27 Home Authentic Jersey",
    slug: "manchester-united-26-27-home-authentic-jersey",
    description:
      "Manchester United 2026/27 home shirt in the authentic player version. Slim fit, red design with a striped polo collar, heat-applied club crest and CLIMACOOL+ fabric. Shirt comes without a player name or number.",
    categorySlug: "sports-outdoor",
    brandSlug: "adidas",
    images: [
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206842/ec/products/sports/manchester-united-26-27-home-authentic-front.png",
        altText: "Manchester United 26/27 authentic home jersey front",
        position: 0,
      },
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206841/ec/products/sports/manchester-united-26-27-home-authentic-back.png",
        altText: "Manchester United 26/27 authentic home jersey back",
        position: 1,
      },
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206844/ec/products/sports/manchester-united-26-27-home-authentic-angle.png",
        altText: "Manchester United 26/27 authentic home jersey angled view",
        position: 2,
      },
    ],
    variants: ["S", "M", "L"].map((size) => ({
      sku: `KA6868-${size}`,
      name: `Red / ${size}`,
      price: 3000000,
      salePrice: 2690000,
      stock: 5,
      options: { Color: "Red", Size: size },
    })),
    attributes: [
      { key: "Season", value: "2026/27" },
      { key: "Version", value: "Authentic / Player" },
      { key: "Product code", value: "KA6868" },
      { key: "Fit", value: "Slim fit" },
      { key: "Fabric", value: "100% recycled polyester" },
      { key: "Technology", value: "CLIMACOOL+" },
    ],
    tags: ["new-arrival"],
  },

  // Source: https://www.adidas.com.vn/en/real-madrid-26-27-home-authentic-jersey/JZ7218.html
  {
    name: "Real Madrid 26/27 Home Authentic Jersey",
    slug: "real-madrid-26-27-home-authentic-jersey",
    description:
      "Real Madrid 2026/27 home shirt in the authentic player version. Slim fit white design with dark green trim, pink shoulder stripes, heat-applied club crest and CLIMACOOL+ fabric. Shirt comes without a player name or number.",
    categorySlug: "sports-outdoor",
    brandSlug: "adidas",
    images: [
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206845/ec/products/sports/real-madrid-26-27-home-authentic-front.png",
        altText: "Real Madrid 26/27 authentic home jersey front",
        position: 0,
      },
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206844/ec/products/sports/real-madrid-26-27-home-authentic-back.png",
        altText: "Real Madrid 26/27 authentic home jersey back",
        position: 1,
      },
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206846/ec/products/sports/real-madrid-26-27-home-authentic-angle.png",
        altText: "Real Madrid 26/27 authentic home jersey angled view",
        position: 2,
      },
    ],
    variants: ["S", "M", "L"].map((size) => ({
      sku: `JZ7218-${size}`,
      name: `White / ${size}`,
      price: 3000000,
      stock: 5,
      options: { Color: "White", Size: size },
    })),
    attributes: [
      { key: "Season", value: "2026/27" },
      { key: "Version", value: "Authentic / Player" },
      { key: "Product code", value: "JZ7218" },
      { key: "Fit", value: "Slim fit" },
      { key: "Fabric", value: "100% recycled polyester" },
      { key: "Technology", value: "CLIMACOOL+" },
    ],
    tags: ["new-arrival"],
  },

  // Source: https://www.ikea.com/us/en/p/billy-bookcase-white-20522046/
  {
    name: "IKEA BILLY Bookcase White",
    slug: "ikea-billy-bookcase-white-20522046",
    description:
      "White BILLY bookcase with one fixed shelf and four adjustable shelves. A simple storage unit for books and display items.",
    categorySlug: "home-living",
    brandSlug: "ikea",
    images: [
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206846/ec/products/home/ikea-billy-bookcase-cutout.png",
        altText: "IKEA BILLY white bookcase isolated front view",
        position: 0,
      },
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206846/ec/products/home/ikea-billy-angle-cutout.png",
        altText: "IKEA BILLY white bookcase from a three-quarter angle",
        position: 1,
      },
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206848/ec/products/home/ikea-billy-shelf-cutout.png",
        altText: "Close-up of an adjustable IKEA BILLY shelf",
        position: 2,
      },
    ],
    variants: [
      {
        sku: "IKEA-20522046-WHT",
        name: "White",
        price: 2190000,
        stock: 5,
        options: { Color: "White" },
      },
    ],
    attributes: [
      { key: "Article number", value: "205.220.46" },
      { key: "Dimensions", value: "80 × 28 × 202 cm" },
      { key: "Shelves", value: "1 fixed, 4 adjustable" },
    ],
  },

  // Source: https://www.ikea.com/us/en/p/raskog-utility-cart-white-30586783/
  {
    name: "IKEA RÅSKOG Utility Cart White",
    slug: "ikea-raskog-utility-cart-white-30586783",
    description:
      "Compact white utility cart with three storage tiers and four casters. The casters can be locked to keep the cart in place.",
    categorySlug: "home-living",
    brandSlug: "ikea",
    images: [
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206847/ec/products/home/ikea-raskog-cart-cutout.png",
        altText: "IKEA RÅSKOG white three-tier utility cart isolated view",
        position: 0,
      },
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206847/ec/products/home/ikea-raskog-angle-cutout.png",
        altText: "IKEA RÅSKOG white cart from a three-quarter angle",
        position: 1,
      },
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206849/ec/products/home/ikea-raskog-wheel-cutout.png",
        altText: "Close-up of an IKEA RÅSKOG locking caster",
        position: 2,
      },
    ],
    variants: [
      {
        sku: "IKEA-30586783-WHT",
        name: "White",
        price: 1090000,
        salePrice: 890000,
        stock: 5,
        options: { Color: "White" },
      },
    ],
    attributes: [
      { key: "Article number", value: "305.867.83" },
      { key: "Dimensions", value: "35 × 45 × 77 cm" },
      { key: "Tiers", value: "3" },
    ],
  },

  // Source: https://sum37.com/product/detail.html?product_no=480
  {
    name: "su:m37° Secret Essence Advanced Treatment 100ml",
    slug: "sum37-secret-essence-advanced-treatment-100ml",
    description:
      "Fermented first-step facial essence from su:m37° Secret line. Lightweight liquid texture for daily hydration and radiant-looking skin.",
    categorySlug: "beauty-personal-care",
    brandSlug: "sum37",
    images: [
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206849/ec/products/beauty/sum37-secret-essence-100ml-front.png",
        altText: "su:m37° Secret Essence Advanced Treatment bottle",
        position: 0,
      },
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206850/ec/products/beauty/sum37-secret-essence-100ml-box.png",
        altText: "su:m37° Secret Essence bottle and retail box",
        position: 1,
      },
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206850/ec/products/beauty/sum37-secret-essence-100ml-detail.png",
        altText: "Close-up of the su:m37° Secret Essence bottle cap",
        position: 2,
      },
    ],
    variants: [
      {
        sku: "SUM37-SECRET-ESSENCE-100",
        name: "100ml",
        price: 2190000,
        stock: 10,
        options: { Volume: "100ml" },
      },
    ],
    attributes: [
      { key: "Volume", value: "100ml" },
      { key: "Line", value: "Secret" },
      { key: "Product type", value: "First-step essence" },
    ],
  },

  // Source: https://sum37.com/product/detail.html?product_no=375
  {
    name: "su:m37° Time Energy Moist Barrier Cream 25ml",
    slug: "sum37-time-energy-moist-barrier-cream-25ml",
    description:
      "Moisturizing face cream from the su:m37° Time Energy line, made for daily hydration and a comfortable skin barrier.",
    categorySlug: "beauty-personal-care",
    brandSlug: "sum37",
    images: [
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206851/ec/products/beauty/sum37-time-energy-cream-25ml-front.png",
        altText: "su:m37° Time Energy Moist Barrier Cream jar front",
        position: 0,
      },
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206851/ec/products/beauty/sum37-time-energy-cream-25ml-angle.png",
        altText: "su:m37° Time Energy Moist Barrier Cream angled view",
        position: 1,
      },
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206855/ec/products/beauty/sum37-time-energy-cream-25ml-open.png",
        altText: "su:m37° Time Energy Moist Barrier Cream open jar",
        position: 2,
      },
    ],
    variants: [
      {
        sku: "SUM37-TIME-ENERGY-CREAM-25",
        name: "25ml",
        price: 890000,
        salePrice: 750000,
        stock: 10,
        options: { Volume: "25ml" },
      },
    ],
    attributes: [
      { key: "Volume", value: "25ml" },
      { key: "Line", value: "Time Energy" },
      { key: "Product type", value: "Face cream" },
    ],
  },

  // Source: https://www.lego.com/en-us/product/lego-medium-creative-brick-box-10696
  {
    name: "LEGO Classic Medium Creative Brick Box 10696",
    slug: "lego-classic-medium-creative-brick-box-10696",
    description:
      "Creative brick box with 484 LEGO pieces in 35 colors, including wheels, windows and other building parts.",
    categorySlug: "kids-toys",
    brandSlug: "lego",
    images: [
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206854/ec/products/kids/lego-classic-10696.png",
        altText: "LEGO Classic Medium Creative Brick Box 10696",
        position: 0,
      },
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206853/ec/products/kids/lego-classic-10696-builds-cutout.png",
        altText: "Sample models built from LEGO Classic set 10696",
        position: 1,
      },
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206857/ec/products/kids/lego-classic-10696-pieces-cutout.png",
        altText: "Colorful bricks included in LEGO Classic set 10696",
        position: 2,
      },
    ],
    variants: [
      {
        sku: "LEGO-10696",
        name: "484 pieces",
        price: 899000,
        salePrice: 749000,
        stock: 10,
        options: {},
      },
    ],
    attributes: [
      { key: "Set number", value: "10696" },
      { key: "Pieces", value: "484" },
      { key: "Age range", value: "4+" },
    ],
  },

  // Source: https://www.lego.com/en-us/product/space-shuttle-31134
  {
    name: "LEGO Creator 3in1 Space Shuttle 31134",
    slug: "lego-creator-3in1-space-shuttle-31134",
    description:
      "144-piece LEGO Creator 3in1 set that can be rebuilt as a space shuttle, astronaut or spaceship.",
    categorySlug: "kids-toys",
    brandSlug: "lego",
    images: [
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206857/ec/products/kids/lego-creator-31134.png",
        altText: "LEGO Creator 3in1 Space Shuttle 31134 box",
        position: 0,
      },
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206856/ec/products/kids/lego-creator-31134-shuttle-cutout.png",
        altText: "LEGO Creator 31134 assembled space shuttle",
        position: 1,
      },
      {
        url: "https://res.cloudinary.com/dvodjxsjb/image/upload/v1794206860/ec/products/kids/lego-creator-31134-alternate-cutout.png",
        altText: "Alternate builds pictured on LEGO Creator 31134 box",
        position: 2,
      },
    ],
    variants: [
      {
        sku: "LEGO-31134",
        name: "144 pieces",
        price: 399000,
        stock: 10,
        options: {},
      },
    ],
    attributes: [
      { key: "Set number", value: "31134" },
      { key: "Pieces", value: "144" },
      { key: "Age range", value: "6+" },
      { key: "Builds", value: "Space shuttle, astronaut or spaceship" },
    ],
  },
];

const retiredProductSlugs = [
  "loreal-revitalift-15-hyaluronic-acid-serum-30ml",
  "loreal-revitalift-hyaluronic-acid-day-cream-50ml",
];

const refreshedGallerySlugs = new Set([
  "ikea-billy-bookcase-white-20522046",
  "ikea-raskog-utility-cart-white-30586783",
  "lego-classic-medium-creative-brick-box-10696",
  "lego-creator-3in1-space-shuttle-31134",
  "sum37-secret-essence-advanced-treatment-100ml",
]);

const refreshedSaleSlugs = new Set([
  "manchester-united-26-27-home-authentic-jersey",
  "ikea-raskog-utility-cart-white-30586783",
  "sum37-time-energy-moist-barrier-cream-25ml",
  "lego-classic-medium-creative-brick-box-10696",
]);

// ─── MAIN ─────────────────────────────────────────────────────────────────────
const main = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ MongoDB connected");

  console.log("🌱 Seeding database...");

  // 1. Upsert categories (Postgres)
  const categoryMap = {};
  for (const cat of categories) {
    const record = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: {},
      create: {
        name: cat.name,
        slug: cat.slug,
        description: cat.description ?? null,
      },
    });
    categoryMap[cat.slug] = {
      id: record.id,
      name: record.name,
      slug: record.slug,
    };
  }
  console.log("✅ Categories seeded (Postgres)");

  // 2. Upsert brands (Postgres)
  const brandMap = {};
  for (const brand of brands) {
    const record = await prisma.brand.upsert({
      where: { slug: brand.slug },
      update: {},
      create: { name: brand.name, slug: brand.slug },
    });
    brandMap[brand.slug] = {
      id: record.id,
      name: record.name,
      slug: record.slug,
    };
  }
  console.log("✅ Brands seeded (Postgres)");

  // 3. Seed products (MongoDB)
  await Product.deleteMany({ slug: { $in: retiredProductSlugs } });

  for (const p of productSeed) {
    const existing = await Product.findOne({ slug: p.slug });
    if (existing) {
      let refreshed = false;
      if (refreshedGallerySlugs.has(p.slug)) {
        await Product.updateOne(
          { _id: existing._id },
          { $set: { images: p.images } },
        );
        console.log(`  ✅ Updated images: ${p.name}`);
        refreshed = true;
      }
      if (refreshedSaleSlugs.has(p.slug)) {
        for (const seedVariant of p.variants) {
          const currentVariant = existing.variants.find(
            (variant) => variant.sku === seedVariant.sku,
          );
          if (
            currentVariant &&
            currentVariant.salePrice !== seedVariant.salePrice
          ) {
            await productMongoRepository.updateVariant(
              existing._id,
              currentVariant._id,
              { salePrice: seedVariant.salePrice },
            );
          }
        }
        console.log(`  ✅ Updated sale prices: ${p.name}`);
        refreshed = true;
      }
      if (refreshed) continue;
      console.log(`  ⏭  Skipping existing product: ${p.name}`);
      continue;
    }

    const category = categoryMap[p.categorySlug];
    const brand = p.brandSlug ? brandMap[p.brandSlug] : null;

    await Product.create({
      name: p.name,
      slug: p.slug,
      description: p.description ?? null,
      categoryId: category.id,
      categorySlug: category.slug,
      categoryName: category.name,
      brandId: brand?.id ?? null,
      brandSlug: brand?.slug ?? null,
      brandName: brand?.name ?? null,
      isFeatured: p.isFeatured ?? false,
      tags: p.tags ?? [],
      images: p.images ?? [],
      variants: p.variants ?? [],
      attributes: p.attributes ?? [],
      minPrice: Math.min(
        ...p.variants.map((variant) => variant.salePrice ?? variant.price),
      ),
      hasSale: p.variants.some(
        (variant) =>
          variant.salePrice != null && variant.salePrice < variant.price,
      ),
      inStock: p.variants.some((variant) => variant.stock > 0),
    });

    console.log(`  ✅ Created: ${p.name}`);
  }

  console.log("\n🎉 Seeding completed successfully!");
};

main()
  .catch((err) => {
    console.error("❌ Error seeding database:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await mongoose.disconnect();
  });
