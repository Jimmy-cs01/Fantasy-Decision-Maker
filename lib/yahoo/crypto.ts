import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey() {
  const configured = process.env.YAHOO_TOKEN_ENCRYPTION_KEY;
  if (!configured) throw new Error("YAHOO_TOKEN_ENCRYPTION_KEY is not configured.");
  const key = /^[0-9a-f]{64}$/i.test(configured) ? Buffer.from(configured, "hex") : Buffer.from(configured, "base64");
  if (key.length !== 32) throw new Error("YAHOO_TOKEN_ENCRYPTION_KEY must encode exactly 32 bytes.");
  return key;
}

export function encryptYahooToken(token: string) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptYahooToken(value: string) {
  const [version, encodedIv, encodedTag, encodedValue] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedValue) throw new Error("Invalid encrypted Yahoo token.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(encodedIv, "base64url"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encodedValue, "base64url")), decipher.final()]).toString("utf8");
}
