export const CATEGORY_BASE_FIELDS = {
  id: true,
  name: true,
  slug: true,
  description: true,
  imageUrl: true,
  videoUrl: true,
};

export const CATEGORY_CHILDREN_RELATION = {
  children: {
    where: { isActive: true },
    select: CATEGORY_BASE_FIELDS,
  },
};

export const CATEGORY_PUBLIC_SELECT = {
  ...CATEGORY_BASE_FIELDS,
  ...CATEGORY_CHILDREN_RELATION,
};

export const CATEGORY_ADMIN_SELECT = {
  ...CATEGORY_BASE_FIELDS,
  parentId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  ...CATEGORY_CHILDREN_RELATION,
};
