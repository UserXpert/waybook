import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { catalogueImageInfo, cataloguePhotoFromForm } from "./catalogue-media.ts";

async function image(format: "jpeg" | "png" | "webp", width = 2, height = 1) {
  const source = sharp({ create: { width, height, channels: 3, background: "#e80d62" } });
  return source[format]().toBuffer();
}

function formWithPhoto(bytes: Uint8Array, name: string, type: string) {
  const form = new FormData();
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  form.set("photo", new File([copy.buffer], name, { type }));
  return form;
}

test("decodes actual JPG, PNG, and WebP types and dimensions", async () => {
  assert.deepEqual(await catalogueImageInfo(await image("jpeg")), { type: "image/jpeg", width: 2, height: 1 });
  assert.deepEqual(await catalogueImageInfo(await image("png")), { type: "image/png", width: 2, height: 1 });
  assert.deepEqual(await catalogueImageInfo(await image("webp")), { type: "image/webp", width: 2, height: 1 });
});

test("rejects forged, oversized, corrupt, and extreme-dimension uploads", async () => {
  await assert.rejects(() => cataloguePhotoFromForm(formWithPhoto(new Uint8Array([1, 2, 3]), "forged.jpg", "image/jpeg"), null));
  await assert.rejects(() => cataloguePhotoFromForm(formWithPhoto(new Uint8Array(250_001), "large.png", "image/png"), null));
  const valid = await image("png");
  await assert.rejects(() => catalogueImageInfo(valid.slice(0, 10)));
  await assert.rejects(async () => catalogueImageInfo(await image("png", 2_401, 1)));
});

test("uses the decoded content type instead of browser-supplied MIME metadata", async () => {
  const stored = await cataloguePhotoFromForm(formWithPhoto(await image("png"), "photo.jpg", "image/jpeg"), null);
  assert.match(stored ?? "", /^data:image\/png;base64,/);
});
