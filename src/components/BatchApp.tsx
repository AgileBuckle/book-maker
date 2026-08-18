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
} from "@headlessui/react";
import FileSaver from "file-saver";
import { parse as pathParse } from "path-browserify";
import Psd from "@webtoon/psd";
import { CheckIcon, TrashIcon } from "@heroicons/react/16/solid";
import { BookType, ScalingMode } from "../enums.ts";
import BatchBookDisplay from "./BatchBookDisplay";
import {
  MatchResult,
  NamedFile,
  matchCoversAndSpines,
} from "../utils/fuzzyMatch";
import { createZipBlob } from "../utils/zip";
import { detectBackCoverColor } from "../utils/backColor";

/* Duplicated from App.tsx on purpose: batch mode is kept fully independent
 * so nothing here can change how the existing single-image flow behaves. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

async function psdToDataUrl(blob: Blob): Promise<string> {
  const psdFile = Psd.parse(await blob.arrayBuffer());
  const compositeBuffer = await psdFile.composite();
  const imageData = new ImageData(
    compositeBuffer,
    psdFile.width,
    psdFile.height,
  );

  const offscreen = new OffscreenCanvas(psdFile.width, psdFile.height);
  const context = offscreen.getContext("2d");

  context?.putImageData(imageData, 0, 0);
  return await blobToDataUrl(
    await offscreen.convertToBlob({ type: "image/png" }),
  );
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (blob !== null) resolve(blob);
      else throw new Error("Canvas failed blob conversion");
    }, "image/png");
  });
}

async function fileToNamedFile(file: File): Promise<NamedFile | null> {
  let url: string | null = null;
  if (file.type === "image/png") {
    url = await blobToDataUrl(file);
  } else if (
    ["image/vnd.adobe.photoshop", "application/x-photoshop"].includes(
      file.type,
    )
  ) {
    url = await psdToDataUrl(file);
  }
  if (url === null) return null;
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()
      .toString(36)
      .slice(2)}`,
    file,
    url,
  };
}

const defaultCover = "template-cover.png";
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
}

interface BatchResultEntry {
  name: string;
  blob: Blob;
}

export default function BatchApp({ onExit }: { onExit: () => void }) {
  const coverInputRef = useRef<HTMLInputElement>(null);
  const spineInputRef = useRef<HTMLInputElement>(null);

  const [covers, setCovers] = useState<NamedFile[]>([]);
  const [spines, setSpines] = useState<NamedFile[]>([]);
  const [rows, setRows] = useState<BatchRow[]>([]);

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
        if (!needsSpineForType(rowBookType)) {
          return {
            cover,
            bookType: rowBookType,
            spineId: null,
            score: null,
            backColor,
            backColorManual,
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
        };
      });
    });
  }, [covers, spines]);

  const {
    getRootProps: getCoverRootProps,
    getInputProps: getCoverInputProps,
    isDragActive: isCoverDragActive,
  } = useDropzone({
    onDrop: async (acceptedFiles) => {
      const converted = await Promise.all(acceptedFiles.map(fileToNamedFile));
      const valid = converted.filter((f): f is NamedFile => f !== null);
      setCovers((prev) => [...prev, ...valid]);
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
  } = useDropzone({
    onDrop: async (acceptedFiles) => {
      const converted = await Promise.all(acceptedFiles.map(fileToNamedFile));
      const valid = converted.filter((f): f is NamedFile => f !== null);
      setSpines((prev) => [...prev, ...valid]);
      if (spineInputRef.current !== null) spineInputRef.current.value = "";
    },
    accept: {
      "image/vnd.adobe.photoshop": [".psd"],
      "application/x-photoshop": [".psd"],
      "image/png": [".png"],
    },
    multiple: true,
  });

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
          ? { ...row, backColor: color, backColorManual: true }
          : row,
      ),
    );
  };

  const removeCover = (coverId: string) => {
    setCovers((prev) => prev.filter((c) => c.id !== coverId));
  };

  const removeSpine = (spineId: string) => {
    setSpines((prev) => prev.filter((s) => s.id !== spineId));
  };

  // Auto-detect the back cover color for any hardcover row that doesn't
  // have one yet (and hasn't been manually overridden). Tracks in-flight
  // detections by cover id so a row is never sampled twice concurrently.
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
      detectBackCoverColor(row.cover.url)
        .then((color) => {
          setRows((prev) =>
            prev.map((r) =>
              r.cover.id === coverId && !r.backColorManual
                ? { ...r, backColor: color }
                : r,
            ),
          );
        })
        .catch((error) => {
          console.error("Back cover color detection failed:", error);
        })
        .finally(() => {
          backColorDetectingRef.current.delete(coverId);
        });
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
  const skippedCount = rows.length - readyRows.length;

  const [isProcessing, setIsProcessing] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [statusText, setStatusText] = useState("");
  const resultsRef = useRef<BatchResultEntry[]>([]);
  const usedNamesRef = useRef<Set<string>>(new Set());
  const previewRef = useRef<HTMLDivElement>(null);

  const currentRow = isProcessing ? readyRows[currentIndex] : undefined;
  const currentSpine = currentRow?.spineId
    ? spines.find((s) => s.id === currentRow.spineId)
    : undefined;

  const handleStart = () => {
    if (readyRows.length === 0) return;
    resultsRef.current = [];
    usedNamesRef.current = new Set();
    setCurrentIndex(0);
    setStatusText(`Generating 1 of ${readyRows.length}…`);
    setIsProcessing(true);
  };

  const handleCancel = () => {
    setIsProcessing(false);
    resultsRef.current = [];
    setStatusText("");
  };

  const finishBatch = useCallback(async () => {
    const entries = await Promise.all(
      resultsRef.current.map(async (entry) => ({
        name: entry.name,
        data: new Uint8Array(await entry.blob.arrayBuffer()),
      })),
    );
    const zipBlob = await createZipBlob(entries);
    FileSaver.saveAs(zipBlob, "book-maker-batch.zip");
    setIsProcessing(false);
    setStatusText(
      `Done — downloaded ${entries.length} image${
        entries.length === 1 ? "" : "s"
      } as book-maker-batch.zip.`,
    );
  }, []);

  const handleSettled = useCallback(() => {
    if (!currentRow) return;
    const canvas: HTMLCanvasElement | null =
      previewRef.current?.querySelector("canvas") ?? null;
    if (canvas === null) return;

    canvasToBlob(canvas).then((blob) => {
      const baseName = pathParse(currentRow.cover.file.name).name;
      let outputName = `${baseName}.png`;
      let suffix = 2;
      while (usedNamesRef.current.has(outputName)) {
        outputName = `${baseName} (${suffix}).png`;
        suffix += 1;
      }
      usedNamesRef.current.add(outputName);
      resultsRef.current.push({ name: outputName, blob });

      const nextIndex = currentIndex + 1;
      if (nextIndex < readyRows.length) {
        setStatusText(
          `Generating ${nextIndex + 1} of ${readyRows.length}…`,
        );
        setCurrentIndex(nextIndex);
      } else {
        setStatusText(
          `Finishing up — zipping ${readyRows.length} images…`,
        );
        finishBatch();
      }
    });
  }, [currentRow, currentIndex, readyRows.length, finishBatch]);

  const coverExists = covers.length > 0;
  const spineExists = spines.length > 0;

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

  return (
    <div className="flex items-center justify-center w-screen min-h-screen p-8 pb-20">
      <section className="fixed left-4 top-4 flex flex-col items-stretch space-y-2 bg-gray-900 p-4 rounded-xl z-30">
        <Button
          onClick={onExit}
          className="text-white focus:ring-4 font-medium rounded-lg text-sm px-5 py-2.5 bg-gray-700 hover:bg-gray-600 focus:outline-none focus:ring-gray-800"
        >
          {"‹"} Back to single image
        </Button>
      </section>
      <section className="fixed right-4 top-4 flex flex-col items-stretch space-y-4 bg-gray-900 p-4 rounded-xl w-80 max-h-[92vh] overflow-y-auto z-30">
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
              <ListboxOptions className="absolute inset-x-0 top-0 border text-sm rounded-lg block overflow-clip w-full bg-gray-700 border-gray-600 placeholder-gray-400 text-white focus:ring-blue-500 focus:border-blue-500">
                {[...bookTypeLabels.entries()].map(([type, label]) => (
                  <ListboxOption
                    value={type}
                    key={type}
                    className="p-2.5 hover:bg-gray-800 cursor-pointer"
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
              <ListboxOptions className="absolute inset-x-0 top-0 border text-sm rounded-lg block overflow-clip w-full bg-gray-700 border-gray-600 placeholder-gray-400 text-white focus:ring-blue-500 focus:border-blue-500">
                {[...scalingModeLabels.entries()].map(([modeOption, label]) => (
                  <ListboxOption
                    value={modeOption}
                    key={modeOption}
                    className="p-2.5 hover:bg-gray-800 cursor-pointer"
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
                <ListboxOptions className="absolute inset-x-0 top-0 border text-sm rounded-r-lg block overflow-clip w-full bg-gray-700 border-gray-600 placeholder-gray-400 text-white focus:ring-blue-500 focus:border-blue-500">
                  {[...unitLabels.entries()].map(([unitOption, label]) => (
                    <ListboxOption
                      value={unitOption}
                      key={unitOption}
                      className="p-2.5 hover:bg-gray-800 cursor-pointer"
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
            className="text-white focus:ring-4 font-medium rounded-lg text-sm px-5 py-2.5 bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-blue-800 w-full disabled:opacity-40 disabled:cursor-not-allowed"
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
        {statusText ? (
          <div className="text-sm text-gray-200 text-center">{statusText}</div>
        ) : null}
      </section>

      <main className="flex flex-col gap-6 items-center w-full max-w-6xl mt-4">
        {isProcessing ? (
          <div ref={previewRef} className="flex flex-col items-center mt-12">
            <BatchBookDisplay
              coverUrl={currentRow?.cover.url ?? defaultCover}
              spineUrl={currentSpine?.url ?? defaultSpine}
              backColor={currentRow?.backColor ?? "#ffffff"}
              bookType={currentRow?.bookType ?? bookType}
              scalingMode={scalingMode}
              spineWidth={spineWidth}
              size={size}
              onSettled={handleSettled}
            />
            <div className="text-white mt-10 text-center">
              {currentRow ? (
                <div className="font-medium">{currentRow.cover.file.name}</div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="w-full mt-12 space-y-6">
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
                        {coverExists ? <CheckIcon className="size-6" /> : null}
                      </div>
                      {isCoverDragActive ? (
                        <p className="mb-2 text-sm">Drop Covers Here</p>
                      ) : (
                        <p className="mb-2 text-sm">
                          <span className="font-semibold">Click to upload</span>{" "}
                          or drag and drop multiple files
                        </p>
                      )}
                    </div>
                    <input {...getCoverInputProps()} ref={coverInputRef} />
                  </label>
                </div>
                {covers.length > 0 ? (
                  <ul className="mt-2 max-h-40 overflow-y-auto text-sm text-gray-300 space-y-1">
                    {covers.map((c) => (
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
                          {spineExists ? <CheckIcon className="size-6" /> : null}
                        </div>
                        {isSpineDragActive ? (
                          <p className="mb-2 text-sm">Drop Spines Here</p>
                        ) : (
                          <p className="mb-2 text-sm">
                            <span className="font-semibold">Click to upload</span>{" "}
                            or drag and drop multiple files
                          </p>
                        )}
                      </div>
                      <input {...getSpineInputProps()} ref={spineInputRef} />
                    </label>
                  </div>
                  {spines.length > 0 ? (
                    <ul className="mt-2 max-h-40 overflow-y-auto text-sm text-gray-300 space-y-1">
                      {spines.map((s) => (
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
                  ) : null}
                </div>
              ) : null}
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
                <div className="max-h-64 overflow-y-auto space-y-1">
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
                          <span className="shrink-0 text-gray-500">
                            {"↔"}
                          </span>
                          <select
                            className="flex-1 min-w-0 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                            value={row.spineId ?? ""}
                            onChange={(event) =>
                              setRowSpine(
                                row.cover.id,
                                event.target.value === ""
                                  ? null
                                  : event.target.value,
                              )
                            }
                          >
                            <option value="">{"— none —"}</option>
                            {spines.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.file.name}
                              </option>
                            ))}
                          </select>
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
                      <select
                        className="shrink-0 w-40 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                        value={row.bookType}
                        aria-label={`Book type for ${row.cover.file.name}`}
                        onChange={(event) =>
                          setRowBookType(
                            row.cover.id,
                            Number(event.target.value) as BookType,
                          )
                        }
                      >
                        {[...bookTypeLabels.entries()].map(([type, label]) => (
                          <option key={type} value={type}>
                            {label}
                          </option>
                        ))}
                      </select>
                      {row.bookType === BookType.Hardcover ? (
                        <input
                          type="color"
                          className="shrink-0 h-7 w-9 rounded border border-gray-600 bg-gray-700 p-0.5 disabled:cursor-wait disabled:opacity-60"
                          value={row.backColor ?? "#000000"}
                          disabled={row.backColor === null}
                          aria-label={`Back cover color for ${row.cover.file.name}`}
                          title={row.backColor ?? "Detecting color…"}
                          onChange={(event) =>
                            setRowBackColor(row.cover.id, event.target.value)
                          }
                        />
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
