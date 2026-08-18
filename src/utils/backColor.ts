/**
 * Guesses a hardcover book's back-cover wrap color by sampling the top edge
 * of the cover art and averaging it. Book covers very often have a solid
 * (or near-solid) background color running behind the title art, and that
 * color is usually what the back cover / inside wrap should match, so the
 * top few pixel rows — least likely to be covered by title text or artwork
 * that starts lower down — are a reasonable, cheap proxy for "the cover's
 * background color".
 *
 * This is a guess, not a guarantee: a cover with a full-bleed photo or
 * pattern reaching the very top edge will produce a less useful average.
 * Callers should let the result be manually overridden.
 */

/** How many rows from the top edge to sample and average. */
const SAMPLE_ROWS = 3;

export async function detectBackCoverColor(url: string): Promise<string> {
  const bitmap = await loadImageBitmap(url);
  try {
    const width = bitmap.width;
    const rows = Math.min(SAMPLE_ROWS, bitmap.height);
    if (width === 0 || rows === 0) return "#ffffff";

    const canvas = new OffscreenCanvas(width, rows);
    const context = canvas.getContext("2d");
    if (context === null) return "#ffffff";

    // Draw just the top `rows` source pixels, stretched to fill the
    // (identically sized) destination — i.e. a 1:1 copy of the top strip —
    // so getImageData only ever has to read `width * rows` pixels no
    // matter how large the source cover image is.
    context.drawImage(bitmap, 0, 0, width, rows, 0, 0, width, rows);
    const { data } = context.getImageData(0, 0, width, rows);

    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;
    let sampleCount = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha === 0) continue; // skip fully transparent pixels
      redSum += data[i];
      greenSum += data[i + 1];
      blueSum += data[i + 2];
      sampleCount += 1;
    }
    if (sampleCount === 0) return "#ffffff";

    return rgbToHex(
      Math.round(redSum / sampleCount),
      Math.round(greenSum / sampleCount),
      Math.round(blueSum / sampleCount),
    );
  } finally {
    bitmap.close();
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

async function loadImageBitmap(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  const blob = await response.blob();
  return await createImageBitmap(blob);
}
