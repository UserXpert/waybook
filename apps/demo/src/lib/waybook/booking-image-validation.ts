export function bookingImageError(file: Pick<File, "size" | "type"> | undefined): string {
  if (!file) return "";
  if (file.size > 250_000) return "Image is too large. Choose a JPG, PNG or WebP up to 250 KB.";
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return "Choose a JPG, PNG or WebP image.";
  return "";
}
