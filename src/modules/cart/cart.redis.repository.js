import { redisClient, redisCircuit } from "../../configs/cache/redis.js";

const CART_TTL = 60 * 60 * 24 * 7;
const key = (userId) => `cart:${userId}`;

// why: retrying a payment cleanup must not erase items added after the first
// cleanup. The marker and matching snapshot removals commit in one Redis script.
const CLEAR_PURCHASED_SCRIPT = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
for i = 1, #ARGV, 2 do
  if redis.call('HGET', KEYS[1], ARGV[i]) == ARGV[i + 1] then
    redis.call('HDEL', KEYS[1], ARGV[i])
  end
end
redis.call('SET', KEYS[2], '1', 'EX', 604800)
return 1
`;

// NOTE: throws Redis error string 'OVER_STOCK' — caller must handle this exact string
const ADD_ITEM_SCRIPT = `
local current = tonumber(redis.call('HGET', KEYS[1], ARGV[1])) or 0
if current + 1 > tonumber(ARGV[2]) then
  return redis.error_reply('OVER_STOCK')
end
local newQty = redis.call('HINCRBY', KEYS[1], ARGV[1], 1)
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return newQty
`;

// NOTE: throws Redis error string 'OVER_STOCK' — caller must handle this exact string
const SET_ITEM_SCRIPT = `
local qty = tonumber(ARGV[3])
if qty > tonumber(ARGV[2]) then
  return redis.error_reply('OVER_STOCK')
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
return qty
`;

export const cartRedisRepository = {
  clearPurchased: async (userId, orderId, items) => {
    await redisCircuit.execute(() => redisClient.eval(CLEAR_PURCHASED_SCRIPT, {
      keys: [key(userId), `cart-cleanup:${orderId}`],
      arguments: items.flatMap(({ variantId, quantity }) => [
        variantId,
        String(quantity),
      ]),
    }));
  },
  getAll: async (userId) => {
    return redisCircuit.execute(() => redisClient.hGetAll(key(userId)));
  },

  // why: OVER_STOCK is a normal business outcome (cart full), not a Redis failure — it's
  // caught and returned as data *inside* the circuit-wrapped function so the breaker
  // counts it as a success, then re-thrown after, so a stock-limited item selling out
  // can't look like a Redis outage and trip the breaker for every other cart in the app
  setItemAtomic: async (userId, variantId, stock, quantity) => {
    const result = await redisCircuit.execute(async () => {
      try {
        return { newQty: await redisClient.eval(SET_ITEM_SCRIPT, {
          keys: [key(userId)],
          arguments: [variantId, String(stock), String(quantity), String(CART_TTL)],
        }) };
      } catch (err) {
        if (err.message === "OVER_STOCK") return { overStock: true };
        throw err;
      }
    });
    if (result.overStock) throw new Error("OVER_STOCK");
    return Number(result.newQty);
  },

  incrementItemAtomic: async (userId, variantId, stock) => {
    const result = await redisCircuit.execute(async () => {
      try {
        return { newQty: await redisClient.eval(ADD_ITEM_SCRIPT, {
          keys: [key(userId)],
          arguments: [variantId, String(stock), String(CART_TTL)],
        }) };
      } catch (err) {
        if (err.message === "OVER_STOCK") return { overStock: true };
        throw err;
      }
    });
    if (result.overStock) throw new Error("OVER_STOCK");
    return Number(result.newQty);
  },

  removeItem: async (userId, variantId) => {
    await redisCircuit.execute(() => redisClient.hDel(key(userId), variantId));
  },

  clear: async (userId) => {
    await redisCircuit.execute(() => redisClient.del(key(userId)));
  },
};
