import { Router } from "express";
import authRoutes from "./modules/auth/auth.routes.js";
import userRoutes from "./modules/user/user.routes.js";
import addressRoutes from "./modules/address/address.routes.js";
import productRoutes from "./modules/product/product.routes.js";
import categoryRoutes from "./modules/category/category.routes.js";
import brandRoutes from "./modules/brand/brand.routes.js";
import uploadRoutes from "./modules/upload/upload.routes.js";
import wishlistRoutes from "./modules/wishlist/wishlist.routes.js";
import cartRoutes from "./modules/cart/cart.routes.js";
import reviewRoutes from "./modules/review/review.routes.js";
import couponRoutes from "./modules/coupon/coupon.routes.js";
import searchRoutes from "./modules/search/search.routes.js";
import orderRoutes from "./modules/order/order.routes.js";
import paymentRoutes from "./modules/payment/payment.routes.js";
import notificationRoutes from "./modules/notification/notification.routes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/addresses", addressRoutes);
router.use("/products", productRoutes);
router.use("/categories", categoryRoutes);
router.use("/brands", brandRoutes);
router.use("/upload", uploadRoutes);
router.use("/wishlist", wishlistRoutes);
router.use("/cart", cartRoutes);
router.use("/coupons", couponRoutes);
router.use("/search", searchRoutes);
router.use("/orders", orderRoutes);
router.use("/payments", paymentRoutes);
router.use("/notifications", notificationRoutes);

// why: review routes span both /products/:id/reviews and /reviews/:id, so they can't take a fixed prefix like the other modules
router.use("/", reviewRoutes);

export default router;
