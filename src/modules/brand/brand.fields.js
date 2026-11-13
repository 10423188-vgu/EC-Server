export const BRAND_BASE_FIELDS = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
};

export const BRAND_ADMIN_SELECT = {
  ...BRAND_BASE_FIELDS,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};
