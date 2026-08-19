# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

A browser-based utility that renders flat book cover/spine images as 3D mockups (hardcover, perfect bound, saddlestitch, spiral bound). Users drop in PNG/JPEG/PSD cover art, the app composites it onto a 3D model, and they can download or copy the rendered PNG. There's also a batch mode for generating many books in one pass from bulk-uploaded covers/spines (see below). Live at the GitHub Pages URL in `vite.config.ts`'s `base`.

This is a fork of [kinetikeith/book-maker](https://github.com/kinetikeith/book-maker) (`upstream` remote); `origin` is `AgileBuckle/book-maker`.

## Stack

React 19 + TypeScript, Vite (SWC plugin), Tailwind CSS, `@react-three/fiber` / `three` / `@react-three/drei` for 3D rendering, Headless UI for form controls, `react-dropzone` for file input, `@webtoon/psd` for PSD parsing.

## Commands

- `npm run dev` — start the Vite dev server
- `npm run build` — type-check (`tsc -b`) then production build
- `npm run lint` — ESLint over the repo
- `npm run preview` — preview a production build locally

There are no automated tests in this repo.

## Structure

- `src/App.tsx` — all single-image UI state and controls (book type, cover/spine upload, scaling, hardcover back-color picker, download/copy). Large single-file component; new form controls typically get added here. Renders `BatchApp` instead when the user clicks into batch mode (`mode` state, around line 105).
- `src/components/BookDisplay.tsx` — the Three.js scene for single-image mode. One sub-component per book type (`HardcoverBook`, `PerfectBoundBook`, `SaddlestitchBook`, `SpiralBoundBook`), each building its own mesh geometry/materials. `BookType` and `ScalingMode` enums live in `src/enums.ts`.
- `src/components/BatchApp.tsx` — batch mode's UI and state: multi-file cover/spine dropzones, fuzzy cover↔spine pairing, optional CSV bulk book-type assignment, per-row book type/back-color overrides, and the sequential generate → screenshot → zip loop. Deliberately duplicated from `App.tsx`'s concepts rather than sharing state, by design (see the comment at the top of the file) — changes here should not be assumed to affect single-image mode, and vice versa.
- `src/components/BatchBookDisplay.tsx` — batch mode's Three.js scene. A deliberate copy of `BookDisplay.tsx` (same comment convention at the top), kept separate so batch rendering can never change single-image rendering. Its only real addition is an `onSettled` callback so `BatchApp` knows when the shadow pass has finished accumulating before it screenshots the canvas.
- `src/utils/` — batch-mode support code: `fuzzyMatch.ts` (filename similarity used for both cover↔spine pairing and CSV book-name matching; `MATCH_THRESHOLD` lives here), `csvBookTypeMatch.ts` (parses/matches the optional "Book Name, Spine Type" CSV and builds the CSV re-exported at the end of a batch), `imageLoader.ts` (lazy PNG/PSD decode + explicit release, so a batch doesn't hold every image in memory at once), `zip.ts` (builds the output `.zip`), `backColor.ts` (samples a cover image to auto-guess the hardcover back-wrap color).
- `public/` — normal maps, page-effect textures, the saddlestitch `.glb` model, and template placeholder images. Adding a book type generally means adding textures here plus a new component in `BookDisplay.tsx` (and its `BatchBookDisplay.tsx` counterpart, kept in sync by hand).
- `src/app/` — leftover Next.js-template files (`globals.css`, `favicon.ico`); not wired into the Vite build (`src/main.tsx` imports `src/index.css`, not this). Don't assume it's live.

## Conventions

- Path alias `@/*` → `src/*` (configured in both `tsconfig.app.json` and `vite.config.ts`).
- Formatting is Prettier defaults (empty `.prettierrc`); linting is the flat ESLint config in `eslint.config.js` (typescript-eslint recommended + react-hooks + react-refresh).
- Husky + lint-staged run on pre-commit: staged `.js/.jsx/.ts/.tsx` get `eslint --fix`, and `.js/.jsx/.ts/.tsx/.css/.md` get `prettier --write`. Don't bypass this with `--no-verify`.
- Deploy is automatic: the `build-and-deploy.yml` workflow builds and publishes `dist/` to GitHub Pages on every push to `main`.

## Working here

- Keep new components consistent with the existing style: functional components, hooks-based state, Tailwind utility classes inline (no CSS modules), enums for fixed option sets.
- Image size is clamped in `BookDisplay.tsx` (`MAX_PIXELS`) to keep the WebGL canvas from exceeding limits — respect that when changing scaling logic.
- This app runs entirely client-side (static GitHub Pages site); there's no backend/API to wire up.
- Single-image and batch mode intentionally don't share rendering/state code (`BatchApp.tsx` vs `App.tsx`, `BatchBookDisplay.tsx` vs `BookDisplay.tsx`) so a batch-mode change can't accidentally alter single-image output or vice versa. If you add a book type or change how a book type renders, update both `BookDisplay.tsx` and `BatchBookDisplay.tsx` — there's no automated check that they stay in sync.
- Batch mode processes one book at a time (load → render off-screen → screenshot → release) rather than decoding every uploaded image up front, to keep memory bounded for large batches. Keep that lazy-load/release pattern (`imageLoader.ts`) if you touch the batch loop.
