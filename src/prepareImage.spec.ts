import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { toDataUrl } from "./prepareImage.ts";

async function size(dataUrl: string) {
  const meta = await sharp(
    Buffer.from(dataUrl.split(",")[1], "base64"),
  ).metadata();
  return { width: meta.width, height: meta.height, format: meta.format };
}

const image = async (width: number, height: number) =>
  new Uint8Array(
    await sharp({
      create: { width, height, channels: 3, background: "#808080" },
    })
      .png()
      .toBuffer(),
  );

describe("toDataUrl", () => {
  it("caps the long side at 1024px as JPEG", async () => {
    expect(await size(await toDataUrl(await image(3000, 1500)))).toEqual({
      width: 1024,
      height: 512,
      format: "jpeg",
    });
  });

  it("upscales small images to the model's minimum side", async () => {
    expect(
      await size(await toDataUrl(await image(100, 200), { minSide: 280 })),
    ).toEqual({ width: 280, height: 560, format: "jpeg" });
  });

  it("pads when upscaling would push the long side past 1024px", async () => {
    expect(
      await size(await toDataUrl(await image(1000, 100), { minSide: 280 })),
    ).toEqual({ width: 1024, height: 280, format: "jpeg" });
  });
});
