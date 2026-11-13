import { addressPrismaRepository } from "./address.prisma.repository.js";
import { BadRequestError } from "../../shared/errors/app.error.js";

// why: caps address list size to keep checkout's address picker usable and
// prevent unbounded spam-adding.
export const MAX_ADDRESSES_PER_USER = 10;

export const addressService = {
  createAddress: async (userId, data) => {
    const count = await addressPrismaRepository.count(userId);
    if (count >= MAX_ADDRESSES_PER_USER) {
      throw new BadRequestError(`You can only save up to ${MAX_ADDRESSES_PER_USER} addresses`);
    }
    if (data.isDefault) {
      return addressPrismaRepository.createAtomic(userId, data);
    }
    return addressPrismaRepository.create(userId, data);
  },

  updateAddress: async (userId, addressId, data) => {
    if (data.isDefault) {
      return addressPrismaRepository.updateAtomic(addressId, userId, data);
    }
    return addressPrismaRepository.update(addressId, userId, data);
  },

  deleteAddress: async (userId, addressId) => {
    return addressPrismaRepository.deleteAtomic(addressId, userId);
  },

  setDefaultAddress: async (userId, addressId) => {
    return addressPrismaRepository.setDefaultAtomic(addressId, userId);
  },
};
