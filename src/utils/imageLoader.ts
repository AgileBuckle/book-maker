import Psd from "@webtoon/psd";
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
