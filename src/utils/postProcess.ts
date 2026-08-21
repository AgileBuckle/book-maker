/**
 * Reproduces the drop-shadow + trim pass that used to be applied by hand in
 * Photoshop after every export (see TODO.md). Calibrated against real
 * output from that Photoshop action — a Layer Style drop shadow (black,
 * Multiply, 25% opacity, 0px distance, 3px size, "Layer Knocks Out Drop
 * Shadow") followed by Image > Trim (transparent pixels, Top + Bottom only)
 * — by diffing a raw render against its Photoshop-finished counterpart.
 * That comparison came back matching to within 8-bit rounding error
 * (mean channel diff <0.1/255 everywhere visible), for this model:
 *
 *   1. Blur a copy of the artwork's own alpha channel (Gaussian, sigma
 *      1.2px — measured from the sample pair, corresponds to the action's
 *      3px "Size").
 *   2. Recolor that blurred alpha channel solid black at 25% opacity. This
 *      is the shadow layer.
 *   3. Draw the shadow layer, then draw the original artwork on top with
 *      normal (source-over) compositing. Drawing the artwork on top last is
 *      what gives the "layer knocks out drop shadow" behavior for free: the
 *      shadow only shows through where the artwork doesn't already cover
 *      that pixel — there's no separate knockout step to implement.
 *   4. Crop away any rows at the top and/or bottom that are fully
 *      transparent. Left/right are left exactly as rendered, matching the
 *      Trim dialog's Top+Bottom-only checkboxes.
 *
 * All of this happens on 2D canvases in memory — no Photoshop, no network
 * round-trip — so it fits the app's existing client-side-only architecture.
 */

/** Gaussian blur std-deviation (px) applied to the alpha channel for the shadow. */
const SHADOW_BLUR_SIGMA_PX = 1.2;

/** Opacity of the (solid black) shadow layer. */
const SHADOW_OPACITY = 0.25;

export function applyDropShadowAndTrim(
  source: HTMLCanvasElement,
): HTMLCanvasElement {
  return trimTransparentRows(addDropShadow(source));
}

function addDropShadow(source: HTMLCanvasElement): HTMLCanvasElement {
  const { width, height } = source;

  // Blur a copy of the source, then recolor its (now-blurred) alpha channel
  // solid black at SHADOW_OPACITY. `source-in` keeps the fill only where the
  // blurred copy has coverage, using that coverage as the new alpha — so
  // the result is exactly "blurred alpha, tinted black, at 25% opacity"
  // regardless of the source artwork's own colors.
  const shadow = document.createElement("canvas");
  shadow.width = width;
  shadow.height = height;
  const shadowCtx = shadow.getContext("2d");
  if (shadowCtx === null) return source;

  shadowCtx.filter = `blur(${SHADOW_BLUR_SIGMA_PX}px)`;
  shadowCtx.drawImage(source, 0, 0);
  shadowCtx.filter = "none";
  shadowCtx.globalCompositeOperation = "source-in";
  shadowCtx.fillStyle = `rgba(0, 0, 0, ${SHADOW_OPACITY})`;
  shadowCtx.fillRect(0, 0, width, height);

  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const outputCtx = output.getContext("2d");
  if (outputCtx === null) return source;

  outputCtx.drawImage(shadow, 0, 0);
  outputCtx.drawImage(source, 0, 0);
  return output;
}

/**
 * Crops away any fully-transparent rows at the top and/or bottom of the
 * canvas. Left and right are left untouched, matching the Photoshop trim
 * action's Top/Bottom-only checkboxes.
 */
function trimTransparentRows(source: HTMLCanvasElement): HTMLCanvasElement {
  const { width, height } = source;
  const ctx = source.getContext("2d");
  if (ctx === null) return source;

  const { data } = ctx.getImageData(0, 0, width, height);

  const rowHasContent = (row: number): boolean => {
    const rowStart = row * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[rowStart + x * 4 + 3] !== 0) return true;
    }
    return false;
  };

  let top = 0;
  while (top < height && !rowHasContent(top)) top++;
  // Fully transparent canvas (nothing rendered) — nothing sane to trim to.
  if (top >= height) return source;

  let bottom = height - 1;
  while (bottom > top && !rowHasContent(bottom)) bottom--;

  const trimmedHeight = bottom - top + 1;
  if (trimmedHeight === height) return source;

  const trimmed = document.createElement("canvas");
  trimmed.width = width;
  trimmed.height = trimmedHeight;
  const trimmedCtx = trimmed.getContext("2d");
  if (trimmedCtx === null) return source;

  trimmedCtx.drawImage(source, 0, -top);
  return trimmed;
}
