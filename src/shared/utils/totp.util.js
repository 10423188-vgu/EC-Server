import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "../errors/app.error.js";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const decodeBase32 = (input) => {
  const alphabet = new Map([...BASE32_ALPHABET].map((char, index) => [char, index]));
  let bits = 0;
  let value = 0;
  const output = [];
  for (const char of input.toUpperCase().replace(/=+$/, "")) {
    const digit = alphabet.get(char);
    if (digit === undefined) throw new Error("Invalid base32 secret");
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
};

const encodeBase32 = (buffer) => {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
};

const encryptionKey = () => {
  const value = process.env.TWO_FACTOR_ENCRYPTION_KEY?.trim();
  if (!/^[a-f\d]{64}$/i.test(value ?? "")) {
    throw new AppError("Two-factor authentication is not configured", 503, "TWO_FACTOR_UNAVAILABLE");
  }
  return Buffer.from(value, "hex");
};

export const generateTotpSecret = () => encodeBase32(randomBytes(20));

export const createTotpUri = (email, secret) => {
  const issuer = "Lorem";
  const label = encodeURIComponent(`${issuer}:${email}`);
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${query}`;
};

const makeCode = (secret, counter) => {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const value = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, "0");
};

export const verifyTotp = (secret, code, now = Date.now()) => {
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(now / 30_000);
  const supplied = Buffer.from(code);
  for (let offset = -1; offset <= 1; offset += 1) {
    const expected = Buffer.from(makeCode(secret, counter + offset));
    if (timingSafeEqual(supplied, expected)) return true;
  }
  return false;
};

export const encryptTotpSecret = (secret) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `v1:${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted.toString("hex")}`;
};

export const decryptTotpSecret = (value) => {
  const [version, ivHex, tagHex, encryptedHex] = value.split(":");
  if (version !== "v1" || !ivHex || !tagHex || !encryptedHex) {
    throw new Error("Invalid encrypted two-factor secret");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
};
