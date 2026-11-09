import sharp from "sharp";

const maxImageBytes = 250_000;
const maxImageDimension = 2_400;
const maxImagePixels = 4_000_000;

type ImageInfo = { type: "image/jpeg" | "image/png" | "image/webp"; width: number; height: number };

function invalidImage(): never {
  throw new Error("Use a genuine JPG, PNG, or WebP photo up to 250 KB and 2,400 × 2,400 pixels.");
}

function dimensionsAreSafe(width: number, height: number) {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
    && width <= maxImageDimension && height <= maxImageDimension && width * height <= maxImagePixels;
}

export async function catalogueImageInfo(bytes: Uint8Array): Promise<ImageInfo> {
  try {
    const decoder = sharp(bytes, { animated: false, failOn: "error", limitInputPixels: maxImagePixels, pages: 1 });
    const metadata = await decoder.metadata();
    const type = metadata.format === "jpeg" ? "image/jpeg" : metadata.format === "png" ? "image/png" : metadata.format === "webp" ? "image/webp" : null;
    if (!type || !metadata.width || !metadata.height || !dimensionsAreSafe(metadata.width, metadata.height)) invalidImage();
    await decoder.toBuffer();
    return { type, width: metadata.width, height: metadata.height };
  } catch {
    invalidImage();
  }
}

export async function cataloguePhotoFromForm(
  formData: FormData,
  existing: string | null,
): Promise<string | null> {
  if (String(formData.get("removePhoto") ?? "") === "on") return null;
  const photo = formData.get("photo");
  if (!(photo instanceof File) || photo.size === 0) return existing;
  if (photo.size > maxImageBytes) invalidImage();
  const bytes = new Uint8Array(await photo.arrayBuffer());
  const image = await catalogueImageInfo(bytes);
  const encoded = Buffer.from(bytes).toString("base64");
  return `data:${image.type};base64,${encoded}`;
}
