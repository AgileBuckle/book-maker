import { useDropzone } from "react-dropzone";
import BookDisplay from "./components/BookDisplay";
import BatchApp from "./components/BatchApp";
import { BookType, ScalingMode } from "./enums.ts";
import {
  ChangeEvent,
  ClipboardEvent,
  FocusEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { HexColorPicker } from "react-colorful";
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
import { CheckIcon } from "@heroicons/react/16/solid";
import { EyeDropperIcon } from "@heroicons/react/20/solid";

/* https://stackoverflow.com/questions/18650168/convert-blob-to-base64 */
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

// https://stackoverflow.com/a/6736135/16691788
function rgbToHex(r: number, g: number, b: number) {
  if (r > 255 || g > 255 || b > 255) throw "Invalid color component";
  return "#" + ("000000" + ((r << 16) | (g << 8) | b).toString(16)).slice(-6);
}

export default function App() {
  const [mode, setMode] = useState<"single" | "batch">("single");
  const coverInputRef = useRef<HTMLInputElement>(null);
  const spineInputRef = useRef<HTMLInputElement>(null);
  const [coverUrl, setCoverUrl] = useState(defaultCover);
  const [spineUrl, setSpineUrl] = useState(defaultSpine);
  const [unknownUrl, setUnknownUrl] = useState<string | null>(null);
  const [backColor, setBackColor] = useState("#3db999");
  const [backColorTemp, setBackColorTemp] = useState("#3db999");
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

  const setSizeInUnits = (sizeInUnits: number) => {
    let pixelSize = sizeInUnits * (unitFactors.get(unit) || 1);
    pixelSize = Math.round(pixelSize);
    pixelSize = Math.max(pixelSize, 600);
    pixelSize = Math.min(pixelSize, 3000);
    setSize(pixelSize);
    setSizeInUnitsText(null);
  };

  const [fileName, setFileName] = useState("Untitled");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setBackColorTemp(backColor);
  }, [backColor]);

  const {
    getRootProps: getCoverRootProps,
    getInputProps: getCoverInputProps,
    isDragActive: isCoverDragActive,
  } = useDropzone({
    onDrop: async (acceptedFiles) => {
      const file = acceptedFiles[0];

      if (file?.type === "image/png") {
        setCoverUrl(await blobToDataUrl(file));
      } else if (
        ["image/vnd.adobe.photoshop", "application/x-photoshop"].includes(
          file?.type,
        )
      ) {
        setCoverUrl(await psdToDataUrl(file));
      }

      setFileName(pathParse(file.name).name);

      if (coverInputRef.current !== null) coverInputRef.current.value = "";
    },
    accept: {
      "image/vnd.adobe.photoshop": [".psd"],
      "application/x-photoshop": [".psd"],
      "image/png": [".png"],
    },
    noClick: true,
    noKeyboard: true,
  });

  const {
    getRootProps: getSpineRootProps,
    getInputProps: getSpineInputProps,
    isDragActive: isSpineDragActive,
  } = useDropzone({
    onDrop: async (acceptedFiles) => {
      const file = acceptedFiles[0];

      if (file?.type === "image/png") {
        setSpineUrl(await blobToDataUrl(file));
      } else if (
        ["image/vnd.adobe.photoshop", "application/x-photoshop"].includes(
          file?.type,
        )
      ) {
        setSpineUrl(await psdToDataUrl(file));
      }

      if (spineInputRef.current !== null) spineInputRef.current.value = "";
    },
    accept: {
      "image/vnd.adobe.photoshop": [".psd"],
      "application/x-photoshop": [".psd"],
      "image/png": [".png"],
    },
    noClick: true,
    noKeyboard: true,
  });

  const isDragActive = isCoverDragActive || isSpineDragActive;

  const triggerDownload = useCallback(async () => {
    const canvas: HTMLCanvasElement | null = document.querySelector("canvas");
    if (canvas !== null)
      FileSaver.saveAs(await canvasToBlob(canvas), `${fileName}.png`);
  }, [fileName]);

  const triggerCopy = useCallback(async () => {
    const canvas: HTMLCanvasElement | null = document.querySelector("canvas");
    if (canvas !== null) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "image/png": canvasToBlob(canvas),
          }),
        ]);
        setCopied(true);
      } catch (error) {
        console.error(error);
      }
    }
  }, []);

  const triggerColorPick = useCallback((event: MouseEvent) => {
    const canvas: HTMLCanvasElement | null = event.target as HTMLCanvasElement;
    if (canvas !== null) {
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) * canvas.width) / rect.width;
      const y = ((rect.bottom - event.clientY) * canvas.height) / rect.height;
      //console.log(rect.width / canvas.width, rect.height / canvas.height);
      const context = canvas.getContext("webgl2");
      if (context === null) return;
      const pixels = new Uint8Array(4);
      context.readPixels(
        x,
        y,
        1,
        1,
        context.RGBA,
        context.UNSIGNED_BYTE,
        pixels,
      );
      setBackColor(rgbToHex(pixels[0], pixels[1], pixels[2]));
    }
  }, []);

  const triggerColorPickStart = useCallback(() => {
    const canvas: HTMLCanvasElement | null = document.querySelector("canvas");
    if (canvas !== null) {
      canvas.addEventListener("click", triggerColorPick, { once: true });
    }
  }, [triggerColorPick]);

  const coverExists = coverUrl !== defaultCover;
  const spineExists = spineUrl !== defaultSpine;

  const handlePaste = async (event: ClipboardEvent<HTMLDivElement>) => {
    const file = event.clipboardData?.files[0];

    if (file === undefined) return;
    if (file === null) return;
    if (file.type !== "image/png") return;

    console.debug(`Pasted ${file.type}!`);
    const imageUrl = await blobToDataUrl(file);
    if (bookType === BookType.Saddlestitch) {
      setCoverUrl(imageUrl);
    } else {
      setUnknownUrl(imageUrl);
    }
  };

  const affirmCover = () => {
    if (unknownUrl !== null) setCoverUrl(unknownUrl);
    setUnknownUrl(null);
  };

  const affirmSpine = () => {
    if (unknownUrl !== null) setSpineUrl(unknownUrl);
    setUnknownUrl(null);
  };

  if (mode === "batch") {
    return <BatchApp onExit={() => setMode("single")} />;
  }

  return (
    <div
      onPaste={handlePaste}
      autoFocus
      tabIndex={0}
      className="flex items-center justify-center w-screen h-screen p-8 pb-20"
    >
      <section className="fixed right-4 top-4 flex flex-col items-stetch space-y-4 bg-gray-900 p-4 rounded-xl w-80">
        <Button
          onClick={() => setMode("batch")}
          className="text-white focus:ring-4 font-medium rounded-lg text-sm px-5 py-2.5 bg-gray-700 hover:bg-gray-600 focus:outline-none focus:ring-gray-800 w-full"
        >
          Batch Mode
        </Button>
        <Field>
          <Label className="block mb-2 text-sm font-medium text-white">
            Book Type
          </Label>
          <div className="relative z-10">
            <Listbox value={bookType} onChange={setBookType}>
              <ListboxButton className="border text-sm rounded-lg block w-full text-left p-2.5 bg-gray-700 border-gray-600 placeholder-gray-400 text-white focus:ring-blue-500 focus:border-blue-500">
                {bookTypeLabels.get(bookType)}
              </ListboxButton>
              <ListboxOptions className="absolute inset-x-0 top-0 border text-sm rounded-lg block overflow-clip w-full bg-gray-700 border-gray-600 placeholder-gray-400 text-white focus:ring-blue-500 focus:border-blue-500">
                {[...bookTypeLabels.entries()].map(([bookType, label]) => (
                  <ListboxOption
                    value={bookType}
                    key={bookType}
                    className="p-2.5 hover:bg-gray-800 cursor-pointer"
                  >
                    {label}
                  </ListboxOption>
                ))}
              </ListboxOptions>
            </Listbox>
          </div>
        </Field>
        <div
          data-success={coverExists ? true : undefined}
          className="flex items-center justify-center h-full text-gray-500 data-[success]:text-green-400"
        >
          <label
            {...getCoverRootProps({
              className:
                "flex flex-col items-center justify-center transition-colors border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-800 bg-gray-900 hover:bg-gray-100 border-gray-600 hover:border-gray-500 w-full",
            })}
          >
            <div className="flex flex-col items-center justify-center py-4 px-6">
              <div
                data-success={coverExists ? true : undefined}
                className="text-lg font-bold flex flex-row items-center gap-1"
              >
                Cover {coverExists ? <CheckIcon className="size-6" /> : null}
              </div>
              {isDragActive ? (
                <p className="mb-2 text-sm">Drop Cover Here</p>
              ) : (
                <p
                  data-success={coverExists ? true : undefined}
                  className="mb-2 text-sm data-[success]:hidden"
                >
                  <span className="font-semibold">Click to upload</span> or drag
                  and drop
                </p>
              )}
            </div>
            <input {...getCoverInputProps()} ref={coverInputRef} />
          </label>
        </div>
        {[BookType.PerfectBound, BookType.Hardcover].includes(bookType) ? (
          <div
            data-success={spineExists ? true : undefined}
            className="flex items-center justify-center h-full text-gray-500 data-[success]:text-green-400"
          >
            <label
              {...getSpineRootProps({
                className:
                  "flex flex-col items-center justify-center transition-colors border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-800 bg-gray-900 hover:bg-gray-100 border-gray-600 hover:border-gray-500 w-full",
              })}
            >
              <div className="flex flex-col items-center justify-center py-4 px-6 data-[success]">
                <div className="text-lg font-bold flex flex-row items-center gap-1">
                  Spine {spineExists ? <CheckIcon className="size-6" /> : null}
                </div>
                {isDragActive ? (
                  <p className="mb-2 text-sm">Drop spine Here</p>
                ) : (
                  <p
                    data-success={spineExists ? true : undefined}
                    className="mb-2 text-sm data-[success]:hidden"
                  >
                    <span className="font-semibold">Click to upload</span> or
                    drag and drop
                  </p>
                )}
              </div>
              <input {...getSpineInputProps()} ref={spineInputRef} />
            </label>
          </div>
        ) : null}
        {bookType === BookType.Hardcover ? (
          <div className="space-y-4">
            <label
              htmlFor="color_hex"
              className="block mb-2 text-sm font-medium text-white"
            >
              Back Cover
            </label>
            <HexColorPicker color={backColor} onChange={setBackColor} />
            <div className="relative w-full flex">
              <Input
                type="text"
                id="color_hex"
                className="border text-sm border-r-0 rounded-l-lg block w-full p-2.5 bg-gray-800 border-gray-600 placeholder-gray-300 text-white focus:ring-blue-500 focus:border-blue-500 focus:outline-none"
                placeholder="#ffffff"
                value={backColorTemp}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  const value = event.target.value;
                  if (value.length > 7) return;
                  if (/^#([0-9A-F]{3}){1,2}$/i.test(value)) setBackColor(value);
                  setBackColorTemp(value);
                }}
              />
              <Button
                onClick={triggerColorPickStart}
                className="border text-sm rounded-r-lg block text-left p-2.5 bg-gray-700 border-gray-600 placeholder-gray-400 text-white focus:ring-blue-500 focus:border-blue-500"
              >
                <EyeDropperIcon className="size-4" />
              </Button>
            </div>
          </div>
        ) : null}
        {bookType === BookType.SpiralBound ? (
          <Field className="space-y-4">
            <Label className="block mb-2 text-sm font-medium text-white">
              Spine Width
            </Label>
            <Input
              type="number"
              id="size-input"
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
            <Listbox value={scalingMode} onChange={setScalingMode}>
              <ListboxButton className="border text-sm rounded-lg block w-full text-left p-2.5 bg-gray-700 border-gray-600 placeholder-gray-400 text-white focus:ring-blue-500 focus:border-blue-500">
                {scalingModeLabels.get(scalingMode)}
              </ListboxButton>
              <ListboxOptions className="absolute inset-x-0 top-0 border text-sm rounded-lg block overflow-clip w-full bg-gray-700 border-gray-600 placeholder-gray-400 text-white focus:ring-blue-500 focus:border-blue-500">
                {[...scalingModeLabels.entries()].map(
                  ([scalingMode, label]) => (
                    <ListboxOption
                      value={scalingMode}
                      key={scalingMode}
                      className="p-2.5 hover:bg-gray-800 cursor-pointer"
                    >
                      {label}
                    </ListboxOption>
                  ),
                )}
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
              id="size-input"
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
                  {[...unitLabels.entries()].map(([unit, label]) => (
                    <ListboxOption
                      value={unit}
                      key={unit}
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
        <Button
          onClick={triggerDownload}
          className="text-white focus:ring-4 font-medium rounded-lg text-sm px-5 py-2.5 me-2 mb-2 bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-blue-800 w-full"
        >
          Download Image
        </Button>
        <Button
          onClick={triggerCopy}
          data-copied={copied ? true : undefined}
          className="text-blue-500 focus:ring-4 font-medium rounded-lg text-sm px-5 py-2.5 me-2 mb-2 border bg-green-600/0 border-1 border-blue-500 hover:border-blue-300 hover:text-blue-300 focus:outline-none focus:ring-blue-800 w-full data-[copied=true]:border-transparent data-[copied=true]:text-white data-[copied=true]:bg-green-600 transition-colors duration-500"
        >
          Copy Image
        </Button>
      </section>
      <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start">
        <BookDisplay
          coverUrl={coverUrl}
          spineUrl={spineUrl}
          backColor={backColor}
          bookType={bookType}
          scalingMode={scalingMode}
          spineWidth={spineWidth}
          size={size}
        />
      </main>
      <footer className="row-start-3 flex gap-6 flex-wrap items-center justify-center"></footer>
      <div
        className="fixed inset-0 flex flex-col items-center justify-center backdrop-blur-lg z-20 bg-gray-500/50 data-[hidden=true]:hidden"
        data-hidden={unknownUrl === null}
      >
        <section className="flex flex-col items-stetch space-y-4 bg-gray-900 p-4 rounded-xl w-80 text-white">
          <div>
            <h2 className="block mb-2 text-lg font-medium">
              Pasted From Clipboard
            </h2>
            <div className="text-sm font-light pt-0">
              What type of image was just pasted from the clipboard?
            </div>
          </div>
          <Button
            onClick={affirmCover}
            className="text-white focus:ring-4 font-medium rounded-lg text-sm px-5 py-2.5 me-2 mb-2 bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-blue-800 w-full"
          >
            Cover
          </Button>
          <Button
            onClick={affirmSpine}
            className="text-white focus:ring-4 font-medium rounded-lg text-sm px-5 py-2.5 me-2 mb-2 bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-blue-800 w-full"
          >
            Spine
          </Button>
        </section>
      </div>
    </div>
  );
}
