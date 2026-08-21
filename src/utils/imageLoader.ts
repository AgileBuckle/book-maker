import Psd, { ColorMode, Depth } from "@webtoon/psd";
import { NamedFile } from "./fuzzyMatch";

/**
 * Lazily decodes dropped cover/spine files into a URL the 3D renderer or the
 * back-cover-color sampler can use, and caches the result per file id so a
 * given image is only ever decoded once.
 *
 * Nothing is decoded — and no memory is spent holding pixel data — until
 * something actually asks for a file's image via `loadImageUrl`. Dropping in
 * hundreds of covers/spines just stores the `File` handles (cheap: the
 * browser doesn't read file contents until asked), so batch mode can accept
 * high volumes without decoding everything up front. Call `releaseImageUrl`
 * once a file's image is no longer needed (e.g. after its batch row has been
 * captured) to free that memory before the next image is opened.
 */

export type FileKind = "png" | "psd";

const PSD_MIME_TYPES = new Set([
  "image/vnd.adobe.photoshop",
  "application/x-photoshop",
  "image/x-photoshop",
  "application/photoshop",
  "application/psd",
]);

/**
 * Figures out whether a dropped file is a PNG or PSD. Falls back to the file
 * extension when the browser didn't supply a MIME type (or supplied one we
 * don't recognize) — which happens for .psd files on some platforms —
 * instead of silently discarding the file the way a MIME-only check would.
 */
export function detectFileKind(file: File): FileKind | null {
  if (file.type === "image/png") return "png";
  if (PSD_MIME_TYPES.has(file.type)) return "psd";
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".psd")) return "psd";
  return null;
}

/** Thrown when a file's image data can't be opened, with enough detail to
 * show the person a specific, actionable error message. */
export class ImageLoadError extends Error {
  fileName: string;
  constructor(fileName: string, message: string) {
    super(message);
    this.name = "ImageLoadError";
    this.fileName = fileName;
  }
}

async function decodePsdToBlob(file: File): Promise<Blob> {
  const psdFile = Psd.parse(await file.arrayBuffer());
  const compositeBuffer = await psdFile.composite();
  const imageData = new ImageData(
    compositeBuffer,
    psdFile.width,
    psdFile.height,
  );

  const offscreen = new OffscreenCanvas(psdFile.width, psdFile.height);
  const context = offscreen.getContext("2d");
  if (context === null) {
    throw new Error("This browser can't create an offscreen canvas.");
  }
  context.putImageData(imageData, 0, 0);
  return await offscreen.convertToBlob({ type: "image/png" });
}

const urlCache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();

/**
 * Resolves a NamedFile to a URL usable by an <img>/texture loader, decoding
 * it only the first time it's asked for and reusing the cached result after
 * that (concurrent calls for the same file share one decode). PNGs are
 * essentially free — just an object URL over the original bytes, no eager
 * decode. PSDs are parsed and composited into a PNG blob on demand.
 */
export function loadImageUrl(namedFile: NamedFile): Promise<string> {
  const cached = urlCache.get(namedFile.id);
  if (cached) return Promise.resolve(cached);

  const pending = inFlight.get(namedFile.id);
  if (pending) return pending;

  const { file } = namedFile;
  const kind = detectFileKind(file);

  const promise = (async () => {
    try {
      let url: string;
      if (kind === "png") {
        url = URL.createObjectURL(file);
      } else if (kind === "psd") {
        const blob = await decodePsdToBlob(file);
        url = URL.createObjectURL(blob);
      } else {
        throw new Error(
          "Not a supported image type — only PNG and PSD files can be used.",
        );
      }
      urlCache.set(namedFile.id, url);
      return url;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ImageLoadError(
        file.name,
        kind === "psd"
          ? `Couldn't read "${file.name}" as a PSD (${reason}). The file may be corrupted, saved in an unsupported PSD variant, or not actually a Photoshop file — try re-exporting it and dropping it in again.`
          : `Couldn't read "${file.name}" (${reason}). The file may be corrupted or not actually a valid PNG — try re-exporting it and dropping it in again.`,
      );
    } finally {
      inFlight.delete(namedFile.id);
    }
  })();

  inFlight.set(namedFile.id, promise);
  return promise;
}

/** Frees a previously-loaded image's memory. Safe to call even if the file
 * was never loaded, or was already released. */
export function releaseImageUrl(id: string): void {
  const url = urlCache.get(id);
  if (url !== undefined) {
    URL.revokeObjectURL(url);
    urlCache.delete(id);
  }
}

/**
 * Best-effort check for a color mode this app doesn't render correctly:
 * CMYK, or any color channel wider than 8 bits (16-bit). Both come out
 * wrong (or fail outright) once actually composited/rendered, so this lets
 * a batch flag the file before generation rather than after. Only reads a
 * small header up front (PNG's IHDR chunk, or a PSD parse without the
 * expensive `composite()` step) — nothing is fully decoded here.
 *
 * Returns null when the file looks fine, or when it can't be inspected
 * this way at all (an unrecognized/corrupt file still gets a proper error
 * from `loadImageUrl` when it's actually opened) — this never throws.
 */
export async function detectColorModeWarning(
  file: File,
): Promise<string | null> {
  try {
    const kind = detectFileKind(file);
    if (kind === "png") return await detectPngColorWarning(file);
    if (kind === "psd") return await detectPsdColorWarning(file);
  } catch (error) {
    console.error(`Color mode check failed for "${file.name}":`, error);
  }
  return null;
}

async function detectPngColorWarning(file: File): Promise<string | null> {
  // Only the fixed-size signature + IHDR chunk header is needed (29 bytes),
  // so this reads a handful of bytes rather than the whole file.
  const header = new DataView(await file.slice(0, 33).arrayBuffer());
  const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (header.getUint8(i) !== PNG_SIGNATURE[i]) return null;
  }
  // Bytes 12-15 should read "IHDR" for a standard PNG layout; bail out
  // rather than guess if they don't.
  const chunkType = String.fromCharCode(
    header.getUint8(12),
    header.getUint8(13),
    header.getUint8(14),
    header.getUint8(15),
  );
  if (chunkType !== "IHDR") return null;
  const bitDepth = header.getUint8(24);
  // PNG has no CMYK variant, so bit depth is the only thing to check here.
  if (bitDepth === 16) {
    return `"${file.name}" is a 16-bit PNG. This app expects 8-bit color, so it may render with incorrect colors — consider converting it to 8-bit first.`;
  }
  return null;
}

async function detectPsdColorWarning(file: File): Promise<string | null> {
  let psdFile: Psd;
  try {
    psdFile = Psd.parse(await file.arrayBuffer());
  } catch (error) {
    // @webtoon/psd can't even parse a 16-bit (or higher) PSD — it throws
    // "Unsupported image bit depth: N" immediately, before colorMode/depth
    // are ever readable. That throw IS the signal to warn about here;
    // otherwise it would just bubble up to the try/catch in
    // detectColorModeWarning, which logs it and swallows it as "can't be
    // inspected" — silently skipping the warning entirely for exactly the
    // 16-bit files this check exists to catch.
    const message = error instanceof Error ? error.message : String(error);
    const bitDepthMatch = /unsupported image bit depth:\s*(\d+)/i.exec(message);
    if (bitDepthMatch) {
      return `"${file.name}" is a ${bitDepthMatch[1]}-bit PSD. This app's PSD parser can only read 8-bit files, so it will fail to open during generation — convert it to 8-bit in Photoshop first (Image > Mode > 8 Bits/Channel).`;
    }
    throw error;
  }
  const issues: string[] = [];
  if (psdFile.colorMode === ColorMode.Cmyk) issues.push("CMYK color mode");
  // Kept as a fallback in case a future library version parses a 16-bit
  // file instead of throwing (unreachable today — see the catch above).
  if (psdFile.depth === Depth.Sixteen) issues.push("16-bit color");
  if (issues.length === 0) return null;
  return `"${file.name}" uses ${issues.join(" and ")}. This app expects 8-bit RGB, so it may render with incorrect colors — consider converting it in Photoshop first (Image > Mode).`;
}
