import assert from "node:assert/strict";
import test from "node:test";
import { redirectSuccessToastMessage, showSuccessToast, WAYBOOK_TOAST_EVENT, withSuccessToast } from "./toast.ts";

test("showSuccessToast dispatches the shared tenant toast contract", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const target = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  try {
    let detail: unknown;
    target.addEventListener(WAYBOOK_TOAST_EVENT, (event) => { detail = (event as CustomEvent).detail; });

    showSuccessToast("  Client record saved.  ");

    assert.deepEqual(detail, { message: "Client record saved." });
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else delete (globalThis as { window?: unknown }).window;
  }
});

test("showSuccessToast is safe when rendered without a browser", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  delete (globalThis as { window?: unknown }).window;
  try {
    assert.doesNotThrow(() => showSuccessToast("Saved."));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
  }
});

test("withSuccessToast preserves existing drawer selection query", () => {
  assert.equal(withSuccessToast("/north/app/products?product=p-1", "Product saved."), "/north/app/products?product=p-1&toast=product-saved");
  assert.equal(redirectSuccessToastMessage("product-saved"), "Product saved.");
  assert.equal(redirectSuccessToastMessage("spoofed"), null);
});
