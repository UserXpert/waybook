"use client";

import { useEffect, useState } from "react";

function isWhiteLogo(image: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  const scale = 64 / Math.max(image.naturalWidth, image.naturalHeight);
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return false;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let transparent = false;
  let visible = 0;
  let white = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3];
    if (alpha < 32) transparent = true;
    if (alpha < 128) continue;
    visible++;
    if (Math.min(data[offset], data[offset + 1], data[offset + 2]) >= 240) white++;
  }
  return transparent && visible > 0 && white / visible >= .99;
}

export function ClientLogo({ src, name }: { src: string; name: string }) {
  const [whiteSrc, setWhiteSrc] = useState<string>();
  const [failedSrc, setFailedSrc] = useState<string>();

  useEffect(() => {
    const image = new Image();
    if (/^https:/i.test(src)) image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        if (isWhiteLogo(image)) setWhiteSrc(src);
      } catch {
        // An unreadable image can still display in its original colors.
      }
    };
    image.src = src;
    return () => { image.onload = null; };
  }, [src]);

  if (failedSrc === src) return null;
  return (
    <img
      className="waybook-login-client-logo"
      src={src}
      alt={name}
      data-white={whiteSrc === src ? "true" : undefined}
      onError={() => setFailedSrc(src)}
    />
  );
}
