import crypto from "crypto";
import { redisClient, redisCircuit } from "../../configs/cache/redis.js";

const REFRESH_TOKEN_PREFIX = "refresh_token:";
const SESSION_PREFIX = "auth_session:";
const SESSION_INDEX_PREFIX = "auth_session_ids:";
const RESET_TOKEN_PREFIX = "reset_token:";
const EMAIL_VERIFY_TOKEN_PREFIX = "email_verify_token:";
const TWO_FACTOR_CHALLENGE_PREFIX = "two_factor_challenge:";
const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60;
const RESET_TOKEN_TTL = 15 * 60;
// why: more generous than the password-reset TTL — lower stakes than a reset link, and
// verification emails realistically sit unread in an inbox longer than 15 minutes
const EMAIL_VERIFY_TOKEN_TTL = 24 * 60 * 60;
const TWO_FACTOR_CHALLENGE_TTL = 5 * 60;

// why: compare-and-swap keeps refresh rotation atomic across concurrent requests.
const ROTATE_REFRESH_SCRIPT = `
local stored = redis.call('HGET', KEYS[1], 'tokenHash')
if stored == ARGV[1] then
  redis.call('HSET', KEYS[1], 'tokenHash', ARGV[2], 'lastSeenAt', ARGV[3])
  redis.call('EXPIRE', KEYS[1], ARGV[4])
  redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[5])
  redis.call('ZADD', KEYS[2], ARGV[6], ARGV[7])
  redis.call('EXPIRE', KEYS[2], ARGV[4])
  return 1
end
return 0
`;

// why: one Redis operation prevents a new login slipping between listing and revocation.
const REVOKE_OTHER_SESSIONS_SCRIPT = `
local ids = redis.call('ZRANGE', KEYS[1], 0, -1)
local revoked = 0
for _, id in ipairs(ids) do
  if id ~= ARGV[1] then
    redis.call('DEL', ARGV[2] .. id)
    redis.call('ZREM', KEYS[1], id)
    revoked = revoked + 1
  end
end
return revoked
`;

const DELETE_ALL_SESSIONS_SCRIPT = `
local ids = redis.call('ZRANGE', KEYS[1], 0, -1)
for _, id in ipairs(ids) do
  redis.call('DEL', ARGV[1] .. id)
end
redis.call('DEL', KEYS[1], KEYS[2])
return #ids
`;

const sessionKey = (userId, sessionId) =>
  `${SESSION_PREFIX}${userId}:${sessionId}`;
const sessionIndexKey = (userId) => `${SESSION_INDEX_PREFIX}${userId}`;
const hashRefreshToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

// why: identical shape to ROTATE_REFRESH_SCRIPT — compare+delete atomically so a reset
// link can only ever be consumed once, even under concurrent requests
const CONSUME_RESET_SCRIPT = `
local stored = redis.call('GET', KEYS[1])
if stored == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

// why: identical shape to CONSUME_RESET_SCRIPT — compare+delete atomically so a
// verification link can only ever be consumed once, even under concurrent requests
const CONSUME_EMAIL_VERIFY_SCRIPT = `
local stored = redis.call('GET', KEYS[1])
if stored == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

const CONSUME_TWO_FACTOR_CHALLENGE_SCRIPT = `
local stored = redis.call('GET', KEYS[1])
if stored == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

export const sessionRedisRepository = {
  saveTwoFactorChallenge: async (tokenHash, userId) => {
    const key = `${TWO_FACTOR_CHALLENGE_PREFIX}${tokenHash}`;
    await redisCircuit.execute(() =>
      redisClient.set(key, userId, { EX: TWO_FACTOR_CHALLENGE_TTL }),
    );
  },

  getTwoFactorChallenge: async (tokenHash) => {
    const key = `${TWO_FACTOR_CHALLENGE_PREFIX}${tokenHash}`;
    return redisCircuit.execute(() => redisClient.get(key));
  },

  consumeTwoFactorChallenge: async (tokenHash, userId) => {
    const key = `${TWO_FACTOR_CHALLENGE_PREFIX}${tokenHash}`;
    const result = await redisCircuit.execute(() =>
      redisClient.eval(CONSUME_TWO_FACTOR_CHALLENGE_SCRIPT, {
        keys: [key],
        arguments: [userId],
      }),
    );
    return result === 1;
  },

  createSession: async (userId, sessionId, token, device) => {
    const now = new Date().toISOString();
    await redisCircuit.execute(() =>
      redisClient
        .multi()
        .hSet(sessionKey(userId, sessionId), {
          tokenHash: hashRefreshToken(token),
          device,
          createdAt: now,
          lastSeenAt: now,
        })
        .expire(sessionKey(userId, sessionId), REFRESH_TOKEN_TTL)
        .zRemRangeByScore(
          sessionIndexKey(userId),
          "-inf",
          Date.now() - REFRESH_TOKEN_TTL * 1000,
        )
        .zAdd(sessionIndexKey(userId), {
          score: Date.now(),
          value: sessionId,
        })
        .expire(sessionIndexKey(userId), REFRESH_TOKEN_TTL)
        .exec(),
    );
  },

  rotateSession: async (userId, sessionId, oldToken, newToken) => {
    const result = await redisCircuit.execute(() =>
      redisClient.eval(ROTATE_REFRESH_SCRIPT, {
        keys: [sessionKey(userId, sessionId), sessionIndexKey(userId)],
        arguments: [
          hashRefreshToken(oldToken),
          hashRefreshToken(newToken),
          new Date().toISOString(),
          String(REFRESH_TOKEN_TTL),
          String(Date.now() - REFRESH_TOKEN_TTL * 1000),
          String(Date.now()),
          sessionId,
        ],
      }),
    );
    return result === 1;
  },

  isSessionActive: (userId, sessionId) =>
    redisCircuit.execute(() =>
      redisClient.exists(sessionKey(userId, sessionId)),
    ),

  listSessions: async (userId) => {
    const ids = await redisCircuit.execute(() =>
      redisClient.zRange(sessionIndexKey(userId), 0, -1),
    );
    const sessions = await Promise.all(
      ids.map(async (id) => ({
        id,
        ...(await redisCircuit.execute(() =>
          redisClient.hGetAll(sessionKey(userId, id)),
        )),
      })),
    );
    return sessions
      .filter((session) => session.createdAt)
      .map(({ id, device, createdAt, lastSeenAt }) => ({
        id,
        device,
        createdAt,
        lastSeenAt,
      }));
  },

  revokeSession: (userId, sessionId) =>
    redisCircuit.execute(() =>
      redisClient
        .multi()
        .del(sessionKey(userId, sessionId))
        .zRem(sessionIndexKey(userId), sessionId)
        .exec(),
    ),

  revokeOtherSessions: async (userId, currentSessionId) => {
    return redisCircuit.execute(() =>
      redisClient.eval(REVOKE_OTHER_SESSIONS_SCRIPT, {
        keys: [sessionIndexKey(userId)],
        arguments: [currentSessionId, `${SESSION_PREFIX}${userId}:`],
      }),
    );
  },

  deleteAllSessions: (userId) =>
    redisCircuit.execute(() =>
      redisClient.eval(DELETE_ALL_SESSIONS_SCRIPT, {
        keys: [sessionIndexKey(userId), `${REFRESH_TOKEN_PREFIX}${userId}`],
        arguments: [`${SESSION_PREFIX}${userId}:`],
      }),
    ),

  // why: keyed by userId (not by the token itself) so a new forgot-password request
  // overwrites — and silently invalidates — any older unused reset link for that user.
  // Stores a hash of the token, never the raw value, so a Redis read (backup, replication,
  // monitoring tool) can't be used to reset the account directly.
  saveResetToken: async (userId, tokenHash) => {
    const key = `${RESET_TOKEN_PREFIX}${userId}`;
    await redisCircuit.execute(() =>
      redisClient.set(key, tokenHash, { EX: RESET_TOKEN_TTL }),
    );
  },

  consumeResetToken: async (userId, tokenHash) => {
    const key = `${RESET_TOKEN_PREFIX}${userId}`;
    const result = await redisCircuit.execute(() =>
      redisClient.eval(CONSUME_RESET_SCRIPT, {
        keys: [key],
        arguments: [tokenHash],
      }),
    );
    return result === 1;
  },

  // why: same keyed-by-userId shape as saveResetToken — a new verification email
  // invalidates any older unused link for that user
  saveEmailVerifyToken: async (userId, tokenHash, email) => {
    const key = `${EMAIL_VERIFY_TOKEN_PREFIX}${userId}`;
    await redisCircuit.execute(() =>
      redisClient.set(key, `${tokenHash}|${email}`, {
        EX: EMAIL_VERIFY_TOKEN_TTL,
      }),
    );
  },

  consumeEmailVerifyToken: async (userId, tokenHash, email) => {
    const key = `${EMAIL_VERIFY_TOKEN_PREFIX}${userId}`;
    const result = await redisCircuit.execute(() =>
      redisClient.eval(CONSUME_EMAIL_VERIFY_SCRIPT, {
        keys: [key],
        arguments: [`${tokenHash}|${email}`],
      }),
    );
    return result === 1;
  },
};
