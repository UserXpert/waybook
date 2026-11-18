import "server-only";
import { createHash, createHmac } from "node:crypto";

export function normaliseGiftCardCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function giftCardCodeHashes(code: string) {
  const secret = process.env.WAYBOOK_GIFT_CARD_CODE_SECRET;
  if (!secret && process.env.NODE_ENV === "production") throw new Error("Gift cards require WAYBOOK_GIFT_CARD_CODE_SECRET in production.");
  return [createHmac("sha256", secret ?? "waybook-local-development-gift-card-secret").update(code).digest("hex"), createHash("sha256").update(code).digest("hex")] as const;
}
