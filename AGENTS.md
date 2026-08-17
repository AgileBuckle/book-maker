# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

A browser-based utility that renders flat book cover/spine images as 3D mockups (hardcover, perfect bound, saddlestitch, spiral bound). Users drop in PNG/JPEG/PSD cover art, the app composites it onto a 3D model, and they can download or copy the rendered PNG. Live at the GitHub Pages URL in `vite.config.ts`'s `base`.

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

- `src/App.tsx` — all UI state and controls (book type, cover/spine upload, scaling, hardcover back-color picker, download/copy). Large single-file component; new form controls typically get added here.
- `src/components/BookDisplay.tsx` — the Three.js scene. One sub-component per book type (`HardcoverBook`, `PerfectBoundBook`, `SaddlestitchBook`, `SpiralBoundBook`), each building its own mesh geometry/materials. `BookType` and `ScalingMode` enums live in `src/enums.ts`.
- `public/` — normal maps, page-effect textures, the saddlestitch `.glb` model, and template placeholder images. Adding a book type generally means adding textures here plus a new component in `BookDisplay.tsx`.
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
