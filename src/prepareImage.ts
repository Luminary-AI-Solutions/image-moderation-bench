import sharp from "sharp";

/**
 * Clef scales anything over ~1 MP down and caps an image at 1,024 tokens, so
 * sending a 1024px JPEG costs the same tokens and stays under the 4 MiB limit.
 * Jev rejects sides under 280px instead of scaling, so `minSide` upscales
 * small images (and pads extreme aspect ratios) for models that need it.
 */
export async function toDataUrl(
  image: Uint8Array,
  { minSide = 0 }: { minSide?: number } = {},
): Promise<string> {
  const capped = await sharp(image)
    .rotate()
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  // Raw pixels between steps, so the image is JPEG-encoded exactly once.
  const raw = { raw: capped.info };
  let pipeline = sharp(capped.data, raw);
  const { width, height } = capped.info;
  const short = Math.min(width, height);
  if (short < minSide) {
    const scale = Math.min(minSide / short, 1024 / Math.max(width, height));
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    const resized = await pipeline
      .resize(w, h)
      .raw()
      .toBuffer({ resolveWithObject: true });
    pipeline = sharp(resized.data, { raw: resized.info }).extend({
      top: Math.floor(Math.max(0, minSide - h) / 2),
      bottom: Math.ceil(Math.max(0, minSide - h) / 2),
      left: Math.floor(Math.max(0, minSide - w) / 2),
      right: Math.ceil(Math.max(0, minSide - w) / 2),
      background: "#ffffff",
    });
  }
  const jpeg = await pipeline.jpeg({ quality: 85 }).toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}
