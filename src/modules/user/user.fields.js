const USER_BASE_FIELDS = {
  id: true,
  name: true,
  reviewDisplayName: true,
  reviewAvatar: true,
  email: true,
  pendingEmail: true,
  phone: true,
  avatar: true,
  banner: true,
  role: true,
  emailVerifiedAt: true,
  createdAt: true,
};

export const USER_SELECT = {
  ...USER_BASE_FIELDS,
};

export const USER_PROFILE_SELECT = {
  ...USER_BASE_FIELDS,
  password: true,
  passwordChangedAt: true,
  twoFactorEnabled: true,
  addresses: true,
  selectedFrame: true,
};
