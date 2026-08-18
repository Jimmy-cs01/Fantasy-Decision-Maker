import { timingSafeEqual } from "node:crypto";

export function isValidYahooOAuthState(received: string | null, expected: string | null) {
  if (!received || !expected) return false;
  const left = Buffer.from(received); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
