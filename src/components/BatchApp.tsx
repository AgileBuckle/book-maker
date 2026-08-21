import { useDropzone } from "react-dropzone";
import {
  ChangeEvent,
  FocusEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Button,
  Field,
  Input,
  Label,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
  Popover,
  PopoverButton,
  PopoverPanel,
} from "@headlessui/react";
import { HexColorPicker } from "react-colorful";
import FileSaver from "file-saver";
import { parse as pathParse } from "path-browserify";
import {
  CheckIcon,
  ExclamationTriangleIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/16/solid";
import { BookType, ScalingMode } from "../enums.ts";
import BatchBookDisplay from "./BatchBookDisplay";
import {
  MatchResult,
  NamedFile,
  matchCoversAndSpines,
} from "../utils/fuzzyMatch";
import { buildSpineTypeCsv, matchCsvToCovers } from "../utils/csvBookTypeMatch";
import { createZipBlob } from "../utils/zip";
import { detectBackCoverColor } from "../utils/backColor";
import {
  ImageLoadError,
  detectFileKind,
  loadImageUrl,
  releaseImageUrl,
} from "../utils/imageLoader";

/* Duplicated from App.tsx on purpose: batch mode is kept fully independent
 * so nothing here can change how the existing single-image flow behaves. */
async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob !== null) resolve(blob);
      else reject(new Error("Canvas failed blob conversion"));
    }, "image/png");
  });
}

/**
 * Wraps freshly-dropped files into NamedFiles without decoding any image
 * data — just enough to know each file is a supported type so it can be
 * matched by name and (later, lazily) opened. Anything that isn't a
 * recognizable PNG or PSD is reported back instead of silently disappearing.
 */
function wrapDroppedFiles(files: File[]): {
  valid: NamedFile[];
  rejected: string[];
} {
  const valid: NamedFile[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    if (detectFileKind(file) === null) {
      rejected.push(file.name);
      continue;
    }
    valid.push({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()
        .toString(36)
        .slice(2)}`,
      file,
    });
  }
  return { valid, rejected };
}

function describeRejectedFiles(names: string[], label: string): string {
  const count = names.length;
  return `Skipped ${count} ${label} file${count === 1 ? "" : "s"} that ${
    count === 1 ? "isn't" : "aren't"
  } a supported PNG or PSD: ${names.join(", ")}.`;
}

const defaultSpine = "template-spine.png";

const bookTypeLabels = new Map<BookType, string>([
  [BookType.PerfectBound, "Perfect bound"],
  [BookType.Hardcover, "Hardcover"],
  [BookType.Saddlestitch, "Saddlestitch"],
  [BookType.SpiralBound, "Spiral bound (partial)"],
]);

const scalingModeLabels = new Map<ScalingMode, string>([
  [ScalingMode.FixedWidth, "Fixed Width"],
  [ScalingMode.FixedHeight, "Fixed Height"],
]);

enum Units {
  Pixel,
  Inch,
}

const unitLabels = new Map<Units, string>([
  [Units.Pixel, "px"],
  [Units.Inch, "in"],
]);

const unitFactors = new Map<Units, number>([
  [Units.Pixel, 1],
  [Units.Inch, 300],
]);

function needsSpineForType(type: BookType): boolean {
  return type === BookType.PerfectBound || type === BookType.Hardcover;
}

interface BatchRow {
  cover: NamedFile;
  bookType: BookType;
  spineId: string | null;
  score: number | null;
  // Hardcover back-cover wrap color. null until auto-detection resolves
  // (or the row isn't a hardcover, in which case it's simply unused).
  backColor: string | null;
  // True once the user has manually picked a color for this row, so the
  // auto-detect effect leaves it alone from then on.
  backColorManual: boolean;
  // Set if auto-detection couldn't open the cover image to sample a color;
  // backColor falls back to white so the row still becomes ready, but this
  // flags that the color is a guess-free default the user should check.
  backColorError: string | null;
}

interface BatchResultEntry {
  name: string;
  blob: Blob;
}

// One book that couldn't be generated during a batch run — collected as the
// batch goes so a failure doesn't stop the rest, then shown together in a
// summary popup once the batch finishes.
interface BatchFailure {
  fileName: string;
  message: string;
}

export default function BatchApp({ onExit }: { onExit: () => void }) {
  const coverInputRef = useRef<HTMLInputElement>(null);
  const spineInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const [covers, setCovers] = useState<NamedFile[]>([]);
  const [spines, setSpines] = useState<NamedFile[]>([]);
  const [rows, setRows] = useState<BatchRow[]>([]);
  // Raw text of each row's back-cover hex input, keyed by cover id — kept
  // separate from the committed `backColor` (same pattern as single mode's
  // backColorTemp) so a partial hex string like "#3d" isn't clobbered by
  // the committed color while the user is still typing.
  const [colorHexDrafts, setColorHexDrafts] = useState<Record<string, string>>(
    {},
  );
  const [dropError, setDropError] = useState<string | null>(null);
  // Optional CSV (book name, spine type) that bulk-sets each row's book
  // type. `csvFileName` is just a status label — re-running the same file
  // (or a fresh one) re-applies matches on top of whatever's there.
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvWarning, setCsvWarning] = useState<string | null>(null);

  const [bookType, setBookType] = useState<BookType>(BookType.PerfectBound);
  const [scalingMode, setScalingMode] = useState<ScalingMode>(
    ScalingMode.FixedWidth,
  );
  const [size, setSize] = useState<number>(1200);
  const [unit, setUnit] = useState<Units>(Units.Pixel);
  const [spineWidth, setSpineWidth] = useState<number>(0.25);

  let sizeInUnits = size.toFixed(0);
  if (unit !== Units.Pixel)
    sizeInUnits = (size / (unitFactors.get(unit) || 1)).toFixed(3);
  const [sizeInUnitsText, setSizeInUnitsText] = useState<string | null>(null);

  const setSizeInUnits = (value: number) => {
    let pixelSize = value * (unitFactors.get(unit) || 1);
    pixelSize = Math.round(pixelSize);
    pixelSize = Math.max(pixelSize, 600);
    pixelSize = Math.min(pixelSize, 3000);
    setSize(pixelSize);
    setSizeInUnitsText(null);
  };

  // `bookType` above is only the default applied to newly-added covers; each
  // row can override its own type individually (see setRowBookType). Read
  // the current default via a ref inside the rows effect so adding covers
  // always picks up the latest default without re-running the effect (and
  // re-scoring fuzzy spine matches) every time the default changes.
  const defaultBookTypeRef = useRef<BookType>(bookType);
  defaultBookTypeRef.current = bookType;

  const defaultNeedsSpine = needsSpineForType(bookType);

  useEffect(() => {
    const matchResult: MatchResult = matchCoversAndSpines(covers, spines);
    const matchByCover = new Map(
      matchResult.pairs.map((pair) => [pair.coverId, pair]),
    );
    setRows((prev) => {
      const prevByCover = new Map(prev.map((row) => [row.cover.id, row]));
      return covers.map((cover) => {
        const prevRow = prevByCover.get(cover.id);
        const rowBookType = prevRow?.bookType ?? defaultBookTypeRef.current;
        const backColor = prevRow?.backColor ?? null;
        const backColorManual = prevRow?.backColorManual ?? false;
        const backColorError = prevRow?.backColorError ?? null;
        if (!needsSpineForType(rowBookType)) {
          return {
            cover,
            bookType: rowBookType,
            spineId: null,
            score: null,
            backColor,
            backColorManual,
            backColorError,
          };
        }
        const match = matchByCover.get(cover.id);
        return {
          cover,
          bookType: rowBookType,
          spineId: match ? match.spineId : null,
          score: match ? match.score : null,
          backColor,
          backColorManual,
          backColorError,
        };
      });
    });
  }, [covers, spines]);

  const {
    getRootProps: getCoverRootProps,
    getInputProps: getCoverInputProps,
    isDragActive: isCoverDragActive,
    fileRejections: coverFileRejections,
  } = useDropzone({
    onDrop: (acceptedFiles) => {
      const { valid, rejected } = wrapDroppedFiles(acceptedFiles);
      setCovers((prev) => [...prev, ...valid]);
      setDropError(
        rejected.length > 0 ? describeRejectedFiles(rejected, "cover") : null,
      );
      if (coverInputRef.current !== null) coverInputRef.current.value = "";
    },
    accept: {
      "image/vnd.adobe.photoshop": [".psd"],
      "application/x-photoshop": [".psd"],
      "image/png": [".png"],
    },
    multiple: true,
  });

  const {
    getRootProps: getSpineRootProps,
    getInputProps: getSpineInputProps,
    isDragActive: isSpineDragActive,
    fileRejections: spineFileRejections,
  } = useDropzone({
    onDrop: (acceptedFiles) => {
      const { valid, rejected } = wrapDroppedFiles(acceptedFiles);
      setSpines((prev) => [...prev, ...valid]);
      setDropError(
        rejected.length > 0 ? describeRejectedFiles(rejected, "spine") : null,
      );
      if (spineInputRef.current !== null) spineInputRef.current.value = "";
    },
    accept: {
      "image/vnd.adobe.photoshop": [".psd"],
      "application/x-photoshop": [".psd"],
      "image/png": [".png"],
    },
    multiple: true,
  });

  // react-dropzone routes files that fail its own extension/MIME check
  // (e.g. a .jpg or .txt dropped by mistake) into fileRejections instead of
  // acceptedFiles, so they'd otherwise vanish with no feedback at all.
  useEffect(() => {
    if (coverFileRejections.length > 0) {
      setDropError(
        describeRejectedFiles(
          coverFileRejections.map((r) => r.file.name),
          "cover",
        ),
      );
    }
  }, [coverFileRejections]);

  useEffect(() => {
    if (spineFileRejections.length > 0) {
      setDropError(
        describeRejectedFiles(
          spineFileRejections.map((r) => r.file.name),
          "spine",
        ),
      );
    }
  }, [spineFileRejections]);

  const setRowSpine = (coverId: string, spineId: string | null) => {
    setRows((prev) =>
      prev.map((row) =>
        row.cover.id === coverId ? { ...row, spineId, score: null } : row,
      ),
    );
  };

  const setRowBookType = (coverId: string, newBookType: BookType) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.cover.id !== coverId) return row;
        if (!needsSpineForType(newBookType)) {
          return { ...row, bookType: newBookType, spineId: null, score: null };
        }
        // Keep an existing manual/matched spine if it's still valid for the
        // new type, otherwise try to find a fresh fuzzy match immediately
        // rather than leaving the row unmatched until covers/spines change.
        if (row.spineId && spines.some((s) => s.id === row.spineId)) {
          return { ...row, bookType: newBookType };
        }
        const [match] = matchCoversAndSpines([row.cover], spines).pairs;
        return {
          ...row,
          bookType: newBookType,
          spineId: match ? match.spineId : null,
          score: match ? match.score : null,
        };
      }),
    );
  };

  const setRowBackColor = (coverId: string, color: string) => {
    setRows((prev) =>
      prev.map((row) =>
        row.cover.id === coverId
          ? {
              ...row,
              backColor: color,
              backColorManual: true,
              backColorError: null,
            }
          : row,
      ),
    );
  };

  // Reads an optional CSV (column A: book name, column B: spine type) and
  // bulk-applies a book type to every row whose cover fuzzy-matches a CSV
  // book name, reusing setRowBookType so re-matching an existing spine and
  // clearing spineId for spine-less types stays in one place. Rows the CSV
  // doesn't mention are left exactly as they were.
  const applyCsvFile = async (file: File) => {
    let text: string;
    try {
      text = await file.text();
    } catch (error) {
      console.error("Failed to read CSV file:", error);
      setCsvWarning(
        `Couldn't read "${file.name}" — try re-exporting it as a plain CSV file.`,
      );
      return;
    }

    const result = matchCsvToCovers(text, covers);
    result.assignments.forEach(({ coverId, bookType }) => {
      setRowBookType(coverId, bookType);
    });

    const messages: string[] = [];
    if (result.unmatchedBookNames.length > 0) {
      messages.push(
        `${result.unmatchedBookNames.length} book name${
          result.unmatchedBookNames.length === 1 ? "" : "s"
        } in the CSV didn't match any uploaded cover: ${result.unmatchedBookNames.join(", ")}.`,
      );
    }
    if (result.unrecognizedSpineTypes.length > 0) {
      messages.push(
        `${result.unrecognizedSpineTypes.length} row${
          result.unrecognizedSpineTypes.length === 1 ? "" : "s"
        } had a spine type that wasn't recognized: ${result.unrecognizedSpineTypes.join("; ")}.`,
      );
    }
    if (result.assignments.length === 0 && messages.length === 0) {
      messages.push(`"${file.name}" didn't contain any rows to apply.`);
    }
    setCsvWarning(messages.length > 0 ? messages.join(" ") : null);
    setCsvFileName(file.name);
  };

  const clearCsvLabel = () => {
    setCsvFileName(null);
    setCsvWarning(null);
  };

  const {
    getRootProps: getCsvRootProps,
    getInputProps: getCsvInputProps,
    isDragActive: isCsvDragActive,
    fileRejections: csvFileRejections,
  } = useDropzone({
    onDrop: (acceptedFiles) => {
      const file = acceptedFiles[0];
      if (file) applyCsvFile(file);
      if (csvInputRef.current !== null) csvInputRef.current.value = "";
    },
    accept: {
      "text/csv": [".csv"],
      "application/vnd.ms-excel": [".csv"],
      "text/plain": [".csv"],
    },
    multiple: false,
  });

  useEffect(() => {
    if (csvFileRejections.length > 0) {
      const names = csvFileRejections.map((r) => r.file.name).join(", ");
      setCsvWarning(
        `Couldn't accept ${
          csvFileRejections.length === 1 ? "this file" : "these files"
        } for the spine type CSV — only a single .csv file is supported: ${names}.`,
      );
    }
  }, [csvFileRejections]);

  const removeCover = (coverId: string) => {
    setCovers((prev) => prev.filter((c) => c.id !== coverId));
    releaseImageUrl(coverId);
  };

  const removeSpine = (spineId: string) => {
    setSpines((prev) => prev.filter((s) => s.id !== spineId));
    releaseImageUrl(spineId);
  };

  const clearAllCovers = () => {
    covers.forEach((c) => releaseImageUrl(c.id));
    setCovers([]);
  };

  const clearAllSpines = () => {
    spines.forEach((s) => releaseImageUrl(s.id));
    setSpines([]);
  };

  // Auto-detect the back cover color for any hardcover row that doesn't
  // have one yet (and hasn't been manually overridden). Tracks in-flight
  // detections by cover id so a row is never sampled twice concurrently.
  // The cover image is opened just for this one sample and released again
  // right after, rather than staying decoded in memory until batch time.
  const backColorDetectingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const pending = rows.filter(
      (row) =>
        row.bookType === BookType.Hardcover &&
        row.backColor === null &&
        !row.backColorManual &&
        !backColorDetectingRef.current.has(row.cover.id),
    );
    pending.forEach((row) => {
      const coverId = row.cover.id;
      backColorDetectingRef.current.add(coverId);
      (async () => {
        try {
          const url = await loadImageUrl(row.cover);
          const color = await detectBackCoverColor(url);
          setRows((prev) =>
            prev.map((r) =>
              r.cover.id === coverId && !r.backColorManual
                ? { ...r, backColor: color, backColorError: null }
                : r,
            ),
          );
        } catch (error) {
          const message =
            error instanceof ImageLoadError
              ? error.message
              : `Couldn't sample a back-cover color for "${row.cover.file.name}" — pick one manually.`;
          console.error("Back cover color detection failed:", error);
          setRows((prev) =>
            prev.map((r) =>
              r.cover.id === coverId && !r.backColorManual
                ? { ...r, backColor: "#ffffff", backColorError: message }
                : r,
            ),
          );
        } finally {
          releaseImageUrl(coverId);
          backColorDetectingRef.current.delete(coverId);
        }
      })();
    });
  }, [rows]);

  const readyRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          (!needsSpineForType(row.bookType) || row.spineId !== null) &&
          (row.bookType !== BookType.Hardcover || row.backColor !== null),
      ),
    [rows],
  );

  // Display-only alphabetical ordering for the covers/spines lists and the
  // per-row spine picker. `covers`/`spines` themselves stay in upload order
  // since that order also feeds the auto-matching logic above.
  const sortedCovers = useMemo(
    () =>
      [...covers].sort((a, b) =>
        a.file.name.localeCompare(b.file.name, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      ),
    [covers],
  );
  const sortedSpines = useMemo(
    () =>
      [...spines].sort((a, b) =>
        a.file.name.localeCompare(b.file.name, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      ),
    [spines],
  );
  const skippedCount = rows.length - readyRows.length;

  const [isProcessing, setIsProcessing] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [isLoadingCurrent, setIsLoadingCurrent] = useState(false);
  const [currentUrls, setCurrentUrls] = useState<{
    cover: string;
    spine: string;
  } | null>(null);
  const [justFinished, setJustFinished] = useState(false);
  const justFinishedTimeoutRef = useRef<number | null>(null);
  const resultsRef = useRef<BatchResultEntry[]>([]);
  // Books that failed to load or render during the run just gone by, kept
  // off to the side so the rest of the batch can keep going instead of
  // stopping on the first problem. Surfaced all at once via failureSummary
  // once the batch finishes (or runs out of rows to try).
  const failuresRef = useRef<BatchFailure[]>([]);
  const [failureSummary, setFailureSummary] = useState<BatchFailure[] | null>(
    null,
  );
  const usedNamesRef = useRef<Set<string>>(new Set());
  const previewRef = useRef<HTMLDivElement>(null);
  // Id of the cover currently held open in memory for the in-progress row,
  // so it can be released as soon as we move past it.
  const loadedCoverIdRef = useRef<string | null>(null);

  const currentRow = isProcessing ? readyRows[currentIndex] : undefined;

  // Opens the current row's cover (and spine, if any) only when it's that
  // row's turn — "open images individually" rather than decoding every
  // image in the batch up front. The previous row's cover is released here
  // too, once we know we're done with it, to keep memory use bounded no
  // matter how large the batch is.
  useEffect(() => {
    if (!isProcessing) return;
    const row = readyRows[currentIndex];
    if (!row) return;

    let cancelled = false;
    setCurrentUrls(null);
    setIsLoadingCurrent(true);
    setStatusText(`Loading ${currentIndex + 1} of ${readyRows.length}…`);

    (async () => {
      try {
        const coverUrl = await loadImageUrl(row.cover);
        let spineUrl = defaultSpine;
        if (row.spineId) {
          const spine = spines.find((s) => s.id === row.spineId);
          if (spine) spineUrl = await loadImageUrl(spine);
        }
        if (cancelled) return;

        if (
          loadedCoverIdRef.current &&
          loadedCoverIdRef.current !== row.cover.id
        ) {
          releaseImageUrl(loadedCoverIdRef.current);
        }
        loadedCoverIdRef.current = row.cover.id;

        setCurrentUrls({ cover: coverUrl, spine: spineUrl });
        setIsLoadingCurrent(false);
        setStatusText(`Generating ${currentIndex + 1} of ${readyRows.length}…`);
      } catch (error) {
        if (cancelled) return;
        const fileName =
          error instanceof ImageLoadError
            ? error.fileName
            : row.cover.file.name;
        const message =
          error instanceof Error
            ? error.message
            : "Something went wrong loading this image.";
        console.error("Failed to load image for batch row:", error);
        failuresRef.current.push({ fileName, message });
        // Whatever of this row's images did open, close it back out again —
        // releaseImageUrl is a no-op for anything that never loaded — so a
        // partial failure (e.g. cover opened fine but the spine didn't)
        // can't leak memory across a long batch.
        releaseImageUrl(row.cover.id);
        if (row.spineId) releaseImageUrl(row.spineId);
        setCurrentUrls(null);
        setIsLoadingCurrent(false);

        // Skip this row rather than stopping the whole batch: move on to
        // the next one, or wrap up if this was the last row to try.
        const nextIndex = currentIndex + 1;
        if (nextIndex < readyRows.length) {
          setStatusText(`Generating ${nextIndex + 1} of ${readyRows.length}…`);
          setCurrentIndex(nextIndex);
        } else {
          setStatusText(
            `Finishing up — zipping ${resultsRef.current.length} image${
              resultsRef.current.length === 1 ? "" : "s"
            }…`,
          );
          finishBatch();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // finishBatch (defined below via useCallback) is intentionally omitted:
    // it's stable per readyRows, which is already a dependency here, and is
    // only invoked asynchronously after this render has committed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProcessing, currentIndex, readyRows, spines]);

  const handleStart = () => {
    if (readyRows.length === 0) return;
    resultsRef.current = [];
    failuresRef.current = [];
    usedNamesRef.current = new Set();
    loadedCoverIdRef.current = null;
    setFailureSummary(null);
    setCurrentUrls(null);
    setCurrentIndex(0);
    setStatusText(`Loading 1 of ${readyRows.length}…`);
    setIsProcessing(true);
    if (justFinishedTimeoutRef.current !== null) {
      window.clearTimeout(justFinishedTimeoutRef.current);
      justFinishedTimeoutRef.current = null;
    }
    setJustFinished(false);
  };

  const handleCancel = () => {
    setIsProcessing(false);
    if (justFinishedTimeoutRef.current !== null) {
      window.clearTimeout(justFinishedTimeoutRef.current);
      justFinishedTimeoutRef.current = null;
    }
    setJustFinished(false);
    resultsRef.current = [];
    failuresRef.current = [];
    setStatusText("");
    setCurrentUrls(null);
    setIsLoadingCurrent(false);
    if (loadedCoverIdRef.current) {
      releaseImageUrl(loadedCoverIdRef.current);
      loadedCoverIdRef.current = null;
    }
  };

  const finishBatch = useCallback(async () => {
    const entries = await Promise.all(
      resultsRef.current.map(async (entry) => ({
        name: entry.name,
        data: new Uint8Array(await entry.blob.arrayBuffer()),
      })),
    );
    const imageCount = entries.length;
    // Include the same "Book Name,Spine Type" CSV layout the optional
    // upload reads, populated with what this batch actually used, so the
    // batch can be redone later by re-uploading it instead of re-picking
    // every book's type again.
    const csvText = buildSpineTypeCsv(
      readyRows.map((row) => ({
        bookName: row.cover.file.name,
        bookType: row.bookType,
      })),
    );
    entries.push({
      name: "book-maker-batch.csv",
      data: new TextEncoder().encode(csvText),
    });
    const zipBlob = await createZipBlob(entries);
    // Only offer a zip once there's at least one image in it — an all-failed
    // batch would otherwise download a zip containing nothing but the CSV.
    if (imageCount > 0) {
      FileSaver.saveAs(zipBlob, "book-maker-batch.zip");
    }
    if (loadedCoverIdRef.current) {
      releaseImageUrl(loadedCoverIdRef.current);
      loadedCoverIdRef.current = null;
    }
    setIsProcessing(false);
    setCurrentUrls(null);
    const failures = failuresRef.current;
    setStatusText(
      imageCount > 0
        ? `Done — downloaded ${imageCount} image${
            imageCount === 1 ? "" : "s"
          } (plus a reusable spine-type CSV) as book-maker-batch.zip.${
            failures.length > 0
              ? ` ${failures.length} book${failures.length === 1 ? "" : "s"} couldn't be generated — see the popup for details.`
              : ""
          }`
        : `No books could be generated. See the popup for details.`,
    );
    if (failures.length > 0) {
      setFailureSummary(failures);
    }
    if (justFinishedTimeoutRef.current !== null) {
      window.clearTimeout(justFinishedTimeoutRef.current);
    }
    setJustFinished(true);
    justFinishedTimeoutRef.current = window.setTimeout(() => {
      setJustFinished(false);
      justFinishedTimeoutRef.current = null;
    }, 1000);
  }, [readyRows]);

  const handleSettled = useCallback(() => {
    if (!currentRow) return;
    const canvas: HTMLCanvasElement | null =
      previewRef.current?.querySelector("canvas") ?? null;
    if (canvas === null) return;

    const row = currentRow;
    canvasToBlob(canvas)
      .then((blob) => {
        const baseName = pathParse(row.cover.file.name).name;
        let outputName = `${baseName}.png`;
        let suffix = 2;
        while (usedNamesRef.current.has(outputName)) {
          outputName = `${baseName} (${suffix}).png`;
          suffix += 1;
        }
        usedNamesRef.current.add(outputName);
        resultsRef.current.push({ name: outputName, blob });
      })
      .catch((error) => {
        const message =
          error instanceof Error
            ? error.message
            : "Something went wrong generating this book.";
        console.error("Failed to capture rendered book:", error);
        failuresRef.current.push({ fileName: row.cover.file.name, message });
      })
      .finally(() => {
        // Move on regardless of whether this row succeeded, so one bad
        // render doesn't stall the rest of the batch.
        const nextIndex = currentIndex + 1;
        if (nextIndex < readyRows.length) {
          setStatusText(`Generating ${nextIndex + 1} of ${readyRows.length}…`);
          setCurrentIndex(nextIndex);
        } else {
          setStatusText(
            `Finishing up — zipping ${resultsRef.current.length} image${
              resultsRef.current.length === 1 ? "" : "s"
            }…`,
          );
          finishBatch();
        }
      });
  }, [currentRow, currentIndex, readyRows.length, finishBatch]);

  const coverExists = covers.length > 0;
  const spineExists = spines.length > 0;
  // Nothing uploaded yet: center the upload boxes in the available space
  // instead of pinning them near the top. Once anything's added, the
  // section reverts to normal top-down flow so it can grow downward.
  const nothingUploadedYet = !coverExists && !spineExists;

  // Spiral spine width is still a single, batch-wide setting (not per-row),
  // but the control should show up whenever it's relevant to any row — not
  // just when it matches the default type — since a row can be switched
  // away from the default. (Hardcover back cover color, by contrast, is
  // now automatic and per-row — see the color swatch in each row below.)
  const anyNeedsSpine =
    defaultNeedsSpine || rows.some((row) => needsSpineForType(row.bookType));
  const anySpiralBound =
    bookType === BookType.SpiralBound ||
    rows.some((row) => row.bookType === BookType.SpiralBound);

  const progressPercent = isProcessing
    ? Math.round((currentIndex / Math.max(readyRows.length, 1)) * 100)
    : 0;

  return (
    <div className="flex items-center justify-center w-full h-screen overflow-hidden p-8 pb-20">
      <Button
        onClick={onExit}
        className="fixed left-4 top-4 z-30 text-white focus:ring-4 font-medium rounded-lg text-sm px-5 py-2.5 bg-gray-700 hover:bg-gray-600 focus:outline-none focus:ring-gray-800"
      >
        {"‹"} Back to single image
      </Button>
      <section className="themed-scrollbar fixed right-4 top-4 flex flex-col items-stretch space-y-4 bg-gray-900 p-4 rounded-xl w-80 max-h-[92vh] overflow-y-auto z-30">
        <div className="text-lg font-bold text-white">Batch Mode</div>
        <Field>
          <Label className="block mb-2 text-sm font-medium text-white">
            Default Book Type
          </Label>
          <div className="relative z-10">
            <Listbox
              value={bookType}
              onChange={setBookType}
              disabled={isProcessing}
            >
              <ListboxButton className="border text-sm rounded-lg block w-full text-left p-2.5 bg-gray-700 border-gray-600 placeholder-gray-400 text-white focus:ring-blue-500 focus:border-blue-500">
                {bookTypeLabels.get(bookType)}
              </ListboxButton>
              <ListboxOptions
                anchor="bottom start"
                className="z-50 [--anchor-gap:4px] border text-sm rounded-lg block overflow-clip w-[var(--button-width)] bg-gray-700 border-gray-600 placeholder-gray-400 text-white focus:ring-blue-500 focus:border-blue-500"
              >
                {[...bookTypeLabels.entries()].map(([type, label]) => (
                  <ListboxOption
                    value={type}
                    key={type}
                    className="p-2.5 hover:bg-gray-800 data-[active]:bg-gray-800 cursor-pointer"
                  >
                    {label}
                  </ListboxOption>
                ))}
              </ListboxOptions>
            </Listbox>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Applied to newly added covers. Each book's type can be overridden
            individually in the list below.
          </p>
        </Field>
        {anySpiralBound ? (
          <Field className="space-y-4">
            <Label className="block mb-2 text-sm font-medium text-white">
              Spine Width
            </Label>
            <Input
              type="number"
              className="border text-sm w-full rounded-lg block p-2.5 bg-gray-800 border-gray-600 placeholder-gray-300 text-white focus:ring-blue-500 focus:border-blue-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              placeholder="Width"
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                setSpineWidth(parseFloat(event.target.value));
              }}
              required
            />
          </Field>
        ) : null}
        <Field>
          <Label className="block mb-2 text-sm font-medium text-white">
            Scaling
          </Label>
          <div className="relative z-10">
            <Listbox
              value={scalingMode}
              onChange={setScalingMode}
              disabled={isProcessing}
            >
              <ListboxButton className="border text-sm rounded-lg block w-full text-left p-2.5 bg-gray-700 border-gray-600 placeholder-gray-400 text-white focus:ring-blue-500 focus:border-blue-500">
                {scalingModeLabels.get(scalingMode)}
              </ListboxButton>
              <ListboxOptions
                anchor="bottom start"
                className="z-50 [--anchor-gap:4px] border text-sm rounded-lg block overflow-clip w-[var(--button-width)] bg-gray-700 border-gray-600 placeholder-gray-400 text-white focus:ring-blue-500 focus:border-blue-500"
              >
                {[...scalingModeLabels.entries()].map(([modeOption, label]) => (
                  <ListboxOption
                    value={modeOption}
                    key={modeOption}
                    className="p-2.5 hover:bg-gray-800 data-[active]:bg-gray-800 cursor-pointer"
                  >
                    {label}
                  </ListboxOption>
                ))}
              </ListboxOptions>
            </Listbox>
          </div>
        </Field>
        <Field>
          <Label className="block mb-2 text-sm font-medium text-white sr-only">
            Scale
          </Label>
          <div className="relative w-full flex">
            <Input
              type="number"
              className="border text-sm w-full rounded-l-lg block p-2.5 bg-gray-800 border-gray-600 border-r-0 placeholder-gray-300 text-white focus:ring-blue-500 focus:border-blue-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              placeholder={
                scalingMode === ScalingMode.FixedWidth ? "Width" : "Height"
              }
              value={sizeInUnitsText || sizeInUnits}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                setSizeInUnitsText(event.target.value);
              }}
              onBlur={(event: FocusEvent<HTMLInputElement>) => {
                setSizeInUnits(parseFloat(event.target.value));
              }}
              required
            />
            <div className="relative">
              <Listbox value={unit} onChange={setUnit}>
                <ListboxButton className="shrink-0 inline-flex items-center py-2.5 px-4 text-sm font-medium text-center text-gray-900 bg-gray-100 border border-gray-300 rounded-e-lg hover:bg-gray-200 focus:ring-4 focus:outline-none focus:ring-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 dark:focus:ring-gray-700 dark:text-white dark:border-gray-600">
                  {unitLabels.get(unit)}
                </ListboxButton>
                <ListboxOptions
                  anchor="bottom end"
                  className="z-50 [--anchor-gap:4px] border text-sm rounded-lg block overflow-clip w-[var(--button-width)] bg-gray-700 border-gray-600 placeholder-gray-400 text-white focus:ring-blue-500 focus:border-blue-500"
                >
                  {[...unitLabels.entries()].map(([unitOption, label]) => (
                    <ListboxOption
                      value={unitOption}
                      key={unitOption}
                      className="p-2.5 hover:bg-gray-800 data-[active]:bg-gray-800 cursor-pointer"
                    >
                      {label}
                    </ListboxOption>
                  ))}
                </ListboxOptions>
              </Listbox>
            </div>
          </div>
        </Field>
        {!isProcessing ? (
          <Button
            onClick={handleStart}
            disabled={readyRows.length === 0}
            data-finished={justFinished ? true : undefined}
            className="text-white focus:ring-4 font-medium rounded-lg text-sm px-5 py-2.5 bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-blue-800 w-full disabled:opacity-40 disabled:cursor-not-allowed data-[finished=true]:animate-pulse-green"
          >
            Start Batch ({readyRows.length})
          </Button>
        ) : (
          <Button
            onClick={handleCancel}
            className="text-white focus:ring-4 font-medium rounded-lg text-sm px-5 py-2.5 bg-red-700 hover:bg-red-600 focus:outline-none focus:ring-red-800 w-full"
          >
            Cancel
          </Button>
        )}
        {isProcessing ? (
          <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-300 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        ) : null}
        {statusText ? (
          <div className="text-sm text-gray-200 text-center">{statusText}</div>
        ) : null}
      </section>

      <main className="themed-scrollbar flex flex-col gap-6 items-center w-full max-w-6xl h-full overflow-y-auto">
        {dropError ? (
          <div className="w-full shrink-0 bg-yellow-950 border border-yellow-700 rounded-xl p-4 text-yellow-100">
            <div className="flex items-start justify-between gap-4">
              <p className="text-sm">{dropError}</p>
              <button
                onClick={() => setDropError(null)}
                className="text-yellow-300 hover:text-white shrink-0"
                aria-label="Dismiss warning"
              >
                <XMarkIcon className="size-5" />
              </button>
            </div>
          </div>
        ) : null}
        {csvWarning ? (
          <div className="w-full shrink-0 bg-yellow-950 border border-yellow-700 rounded-xl p-4 text-yellow-100">
            <div className="flex items-start justify-between gap-4">
              <p className="text-sm">{csvWarning}</p>
              <button
                onClick={() => setCsvWarning(null)}
                className="text-yellow-300 hover:text-white shrink-0"
                aria-label="Dismiss warning"
              >
                <XMarkIcon className="size-5" />
              </button>
            </div>
          </div>
        ) : null}
        {isProcessing ? (
          <div
            ref={previewRef}
            className="flex flex-col items-center shrink-0 mt-12"
          >
            {currentUrls ? (
              <BatchBookDisplay
                coverUrl={currentUrls.cover}
                spineUrl={currentUrls.spine}
                backColor={currentRow?.backColor ?? "#ffffff"}
                bookType={currentRow?.bookType ?? bookType}
                scalingMode={scalingMode}
                spineWidth={spineWidth}
                size={size}
                onSettled={handleSettled}
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 h-64 w-64">
                <div className="size-10 border-4 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
                <div className="text-gray-300 text-sm">
                  {isLoadingCurrent ? "Loading image…" : ""}
                </div>
              </div>
            )}
            <div className="text-white mt-10 text-center">
              {currentRow ? (
                <div className="font-medium">{currentRow.cover.file.name}</div>
              ) : null}
            </div>
          </div>
        ) : (
          <div
            className={
              nothingUploadedYet
                ? "flex-1 min-h-0 w-full flex flex-col justify-center space-y-6"
                : "w-full shrink-0 mt-12 space-y-6"
            }
          >
            <div className="space-y-3">
              {/* Shown whenever anything's uploaded (covers or spines), not
                  just covers — so this box is always the topmost thing and
                  the covers/spines row below it never shifts any higher,
                  even when only spines have been added so far. */}
              {!nothingUploadedYet ? (
                <div>
                  <div
                    data-success={csvFileName ? true : undefined}
                    className="text-gray-500 data-[success]:text-green-400"
                  >
                    <label
                      {...getCsvRootProps({
                        className:
                          "flex flex-col items-center justify-center transition-colors border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-800 bg-gray-900 hover:bg-gray-100 border-gray-600 hover:border-gray-500 w-full h-28",
                      })}
                    >
                      <div className="flex flex-col items-center justify-center py-4 px-6">
                        <div className="text-lg font-bold flex flex-row items-center gap-1">
                          Spine Type CSV (optional){" "}
                          {csvFileName ? (
                            <CheckIcon className="size-6" />
                          ) : null}
                        </div>
                        {isCsvDragActive ? (
                          <p className="mb-2 text-sm">Drop CSV Here</p>
                        ) : (
                          <p className="mb-2 text-sm">
                            <span className="font-semibold">
                              Click to upload
                            </span>{" "}
                            or drag and drop a CSV file
                          </p>
                        )}
                      </div>
                      <input {...getCsvInputProps()} ref={csvInputRef} />
                    </label>
                  </div>
                  <p className="mt-2 text-xs text-gray-400">
                    Column A: book name, column B: spine type (Perfect bound,
                    Hardcover, Saddlestitch, or Spiral bound). Book names are
                    matched to your uploaded covers with the same fuzzy matching
                    used for cover/spine pairing, so exact filenames aren't
                    required.
                  </p>
                  {csvFileName ? (
                    <div className="mt-2 flex items-center justify-between bg-gray-800 rounded px-2 py-1 text-sm text-gray-300">
                      <span className="truncate">Applied: {csvFileName}</span>
                      <button
                        onClick={clearCsvLabel}
                        className="text-gray-400 hover:text-red-400 ml-2"
                        aria-label="Clear CSV status"
                        title="Clears this label only — spine types already applied stay as set"
                      >
                        <TrashIcon className="size-4" />
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
                <div>
                  <div
                    data-success={coverExists ? true : undefined}
                    className="text-gray-500 data-[success]:text-green-400"
                  >
                    <label
                      {...getCoverRootProps({
                        className:
                          "flex flex-col items-center justify-center transition-colors border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-800 bg-gray-900 hover:bg-gray-100 border-gray-600 hover:border-gray-500 w-full h-28",
                      })}
                    >
                      <div className="flex flex-col items-center justify-center py-4 px-6">
                        <div className="text-lg font-bold flex flex-row items-center gap-1">
                          Covers ({covers.length}){" "}
                          {coverExists ? (
                            <CheckIcon className="size-6" />
                          ) : null}
                        </div>
                        {isCoverDragActive ? (
                          <p className="mb-2 text-sm">Drop Covers Here</p>
                        ) : (
                          <p className="mb-2 text-sm">
                            <span className="font-semibold">
                              Click to upload
                            </span>{" "}
                            or drag and drop multiple files
                          </p>
                        )}
                      </div>
                      <input {...getCoverInputProps()} ref={coverInputRef} />
                    </label>
                  </div>
                  {covers.length > 0 ? (
                    <>
                      <ul className="themed-scrollbar mt-2 mx-3 max-h-40 overflow-y-auto text-sm text-gray-300 space-y-1">
                        {sortedCovers.map((c) => (
                          <li
                            key={c.id}
                            className="flex items-center justify-between bg-gray-800 rounded px-2 py-1"
                          >
                            <span className="truncate">{c.file.name}</span>
                            <button
                              onClick={() => removeCover(c.id)}
                              className="text-gray-400 hover:text-red-400 ml-2"
                              aria-label={`Remove ${c.file.name}`}
                            >
                              <TrashIcon className="size-4" />
                            </button>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2 mx-3 flex justify-end">
                        <button
                          onClick={clearAllCovers}
                          className="text-sm font-medium text-gray-200 bg-gray-700 hover:bg-red-800 hover:text-white rounded-lg px-3 py-1.5"
                        >
                          Clear all covers
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
                {anyNeedsSpine ? (
                  <div>
                    <div
                      data-success={spineExists ? true : undefined}
                      className="text-gray-500 data-[success]:text-green-400"
                    >
                      <label
                        {...getSpineRootProps({
                          className:
                            "flex flex-col items-center justify-center transition-colors border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-800 bg-gray-900 hover:bg-gray-100 border-gray-600 hover:border-gray-500 w-full h-28",
                        })}
                      >
                        <div className="flex flex-col items-center justify-center py-4 px-6">
                          <div className="text-lg font-bold flex flex-row items-center gap-1">
                            Spines ({spines.length}){" "}
                            {spineExists ? (
                              <CheckIcon className="size-6" />
                            ) : null}
                          </div>
                          {isSpineDragActive ? (
                            <p className="mb-2 text-sm">Drop Spines Here</p>
                          ) : (
                            <p className="mb-2 text-sm">
                              <span className="font-semibold">
                                Click to upload
                              </span>{" "}
                              or drag and drop multiple files
                            </p>
                          )}
                        </div>
                        <input {...getSpineInputProps()} ref={spineInputRef} />
                      </label>
                    </div>
                    {spines.length > 0 ? (
                      <>
                        <ul className="themed-scrollbar mt-2 mx-3 max-h-40 overflow-y-auto text-sm text-gray-300 space-y-1">
                          {sortedSpines.map((s) => (
                            <li
                              key={s.id}
                              className="flex items-center justify-between bg-gray-800 rounded px-2 py-1"
                            >
                              <span className="truncate">{s.file.name}</span>
                              <button
                                onClick={() => removeSpine(s.id)}
                                className="text-gray-400 hover:text-red-400 ml-2"
                                aria-label={`Remove ${s.file.name}`}
                              >
                                <TrashIcon className="size-4" />
                              </button>
                            </li>
                          ))}
                        </ul>
                        <div className="mt-2 mx-3 flex justify-end">
                          <button
                            onClick={clearAllSpines}
                            className="text-sm font-medium text-gray-200 bg-gray-700 hover:bg-red-800 hover:text-white rounded-lg px-3 py-1.5"
                          >
                            Clear all spines
                          </button>
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            {rows.length > 0 ? (
              <div className="w-full bg-gray-900 rounded-xl p-4 text-white">
                <div className="flex items-center justify-between mb-2 gap-4">
                  <div className="font-bold">
                    {readyRows.length} of {rows.length} ready
                  </div>
                  {skippedCount > 0 ? (
                    <div className="text-sm text-yellow-400">
                      {skippedCount} cover{skippedCount === 1 ? "" : "s"} with
                      no spine assigned will be skipped
                    </div>
                  ) : null}
                </div>
                <div className="themed-scrollbar max-h-64 overflow-y-auto space-y-1">
                  {rows.map((row) => (
                    <div
                      key={row.cover.id}
                      className="flex items-center gap-2 text-sm bg-gray-800 rounded px-2 py-1.5"
                    >
                      <span className="flex-1 min-w-0 truncate">
                        {row.cover.file.name}
                      </span>
                      {needsSpineForType(row.bookType) ? (
                        <>
                          <span className="shrink-0 text-gray-500">{"↔"}</span>
                          <div className="relative flex-1 min-w-0">
                            <Listbox
                              value={row.spineId}
                              onChange={(value) =>
                                setRowSpine(row.cover.id, value)
                              }
                            >
                              <ListboxButton
                                aria-label={`Spine for ${row.cover.file.name}`}
                                className="border text-sm rounded-lg block w-full truncate text-left px-2 py-1 bg-gray-700 border-gray-600 placeholder-gray-400 text-white focus:ring-blue-500 focus:border-blue-500"
                              >
                                {row.spineId === null
                                  ? "— none —"
                                  : (spines.find((s) => s.id === row.spineId)
                                      ?.file.name ?? "— none —")}
                              </ListboxButton>
                              <ListboxOptions
                                anchor="bottom start"
                                className="z-50 [--anchor-gap:4px] themed-scrollbar border text-sm rounded-lg block max-h-60 overflow-y-auto w-[var(--button-width)] bg-gray-700 border-gray-600 placeholder-gray-400 text-white focus:ring-blue-500 focus:border-blue-500"
                              >
                                <ListboxOption
                                  value={null}
                                  className="px-2 py-1 truncate hover:bg-gray-800 data-[active]:bg-gray-800 cursor-pointer"
                                >
                                  {"— none —"}
                                </ListboxOption>
                                {sortedSpines.map((s) => (
                                  <ListboxOption
                                    value={s.id}
                                    key={s.id}
                                    className="px-2 py-1 truncate hover:bg-gray-800 data-[active]:bg-gray-800 cursor-pointer"
                                  >
                                    {s.file.name}
                                  </ListboxOption>
                                ))}
                              </ListboxOptions>
                            </Listbox>
                          </div>
                          {row.spineId !== null ? (
                            <span
                              className={
                                row.score === null
                                  ? "shrink-0 text-blue-400 text-xs w-16 text-right"
                                  : row.score >= 0.8
                                    ? "shrink-0 text-green-400 text-xs w-16 text-right"
                                    : "shrink-0 text-yellow-400 text-xs w-16 text-right"
                              }
                            >
                              {row.score === null
                                ? "manual"
                                : `${Math.round(row.score * 100)}%`}
                            </span>
                          ) : (
                            <span className="shrink-0 text-red-400 text-xs w-16 text-right">
                              no match
                            </span>
                          )}
                        </>
                      ) : null}
                      <div className="relative shrink-0 w-40">
                        <Listbox
                          value={row.bookType}
                          onChange={(value) =>
                            setRowBookType(row.cover.id, value)
                          }
                        >
                          <ListboxButton
                            aria-label={`Book type for ${row.cover.file.name}`}
                            className="border text-sm rounded-lg block w-full truncate text-left px-2 py-1 bg-gray-700 border-gray-600 placeholder-gray-400 text-white focus:ring-blue-500 focus:border-blue-500"
                          >
                            {bookTypeLabels.get(row.bookType)}
                          </ListboxButton>
                          <ListboxOptions
                            anchor="bottom end"
                            className="z-50 [--anchor-gap:4px] border text-sm rounded-lg block overflow-clip w-[var(--button-width)] bg-gray-700 border-gray-600 placeholder-gray-400 text-white focus:ring-blue-500 focus:border-blue-500"
                          >
                            {[...bookTypeLabels.entries()].map(
                              ([type, label]) => (
                                <ListboxOption
                                  value={type}
                                  key={type}
                                  className="px-2 py-1 hover:bg-gray-800 data-[active]:bg-gray-800 cursor-pointer"
                                >
                                  {label}
                                </ListboxOption>
                              ),
                            )}
                          </ListboxOptions>
                        </Listbox>
                      </div>
                      {row.bookType === BookType.Hardcover ? (
                        <div className="shrink-0 flex items-center gap-1">
                          <Popover>
                            <PopoverButton
                              disabled={row.backColor === null}
                              aria-label={`Back cover color for ${row.cover.file.name}`}
                              title={row.backColor ?? "Detecting color…"}
                              onClick={() =>
                                setColorHexDrafts((prev) => ({
                                  ...prev,
                                  [row.cover.id]: row.backColor ?? "",
                                }))
                              }
                              style={{
                                backgroundColor: row.backColor ?? "#000000",
                              }}
                              className="h-7 w-9 rounded border border-gray-600 disabled:cursor-wait disabled:opacity-60"
                            />
                            <PopoverPanel
                              anchor="bottom end"
                              className="z-50 [--anchor-gap:4px] flex flex-col gap-3 rounded-lg border border-gray-600 bg-gray-900 p-3 shadow-xl"
                            >
                              <HexColorPicker
                                color={row.backColor ?? "#000000"}
                                onChange={(color) => {
                                  setRowBackColor(row.cover.id, color);
                                  setColorHexDrafts((prev) => ({
                                    ...prev,
                                    [row.cover.id]: color,
                                  }));
                                }}
                              />
                              <Input
                                type="text"
                                className="border text-sm rounded-lg block w-full p-2.5 bg-gray-800 border-gray-600 placeholder-gray-300 text-white focus:ring-blue-500 focus:border-blue-500 focus:outline-none"
                                placeholder="#ffffff"
                                value={
                                  colorHexDrafts[row.cover.id] ??
                                  row.backColor ??
                                  ""
                                }
                                onChange={(
                                  event: ChangeEvent<HTMLInputElement>,
                                ) => {
                                  const value = event.target.value;
                                  if (value.length > 7) return;
                                  if (/^#([0-9A-F]{3}){1,2}$/i.test(value)) {
                                    setRowBackColor(row.cover.id, value);
                                  }
                                  setColorHexDrafts((prev) => ({
                                    ...prev,
                                    [row.cover.id]: value,
                                  }));
                                }}
                              />
                            </PopoverPanel>
                          </Popover>
                          {row.backColorError ? (
                            <span title={row.backColorError}>
                              <ExclamationTriangleIcon className="size-4 text-yellow-400" />
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </main>
      {failureSummary ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
          <div className="themed-scrollbar w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-xl border border-red-700 bg-gray-900 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="font-bold text-white">
                {failureSummary.length} book
                {failureSummary.length === 1 ? "" : "s"} couldn't be generated
              </div>
              <button
                onClick={() => setFailureSummary(null)}
                className="text-gray-400 hover:text-white shrink-0"
                aria-label="Close"
              >
                <XMarkIcon className="size-5" />
              </button>
            </div>
            <p className="mt-2 text-sm text-gray-300">
              The rest of the batch finished and downloaded normally. Fix these
              and run them again separately:
            </p>
            <ul className="mt-3 space-y-2">
              {failureSummary.map((failure, index) => (
                <li
                  key={`${failure.fileName}-${index}`}
                  className="rounded-lg border border-red-800 bg-red-950 p-3"
                >
                  <div className="truncate font-medium text-red-100">
                    {failure.fileName}
                  </div>
                  <div className="mt-1 text-sm text-red-200">
                    {failure.message}
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end">
              <Button
                onClick={() => setFailureSummary(null)}
                className="text-white focus:ring-4 font-medium rounded-lg text-sm px-5 py-2.5 bg-gray-700 hover:bg-gray-600 focus:outline-none focus:ring-gray-800"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
