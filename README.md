# IFC Viewer

A local, client-side web app for viewing IFC (Industry Foundation Classes) 3D
building models. No backend, no uploads — files are parsed and rendered
entirely in the browser using WebAssembly.

## Stack

- [Vite](https://vitejs.dev/) + React
- [Three.js](https://threejs.org/) for 3D rendering
- [`@thatopen/components`](https://docs.thatopen.com/) + [`web-ifc`](https://github.com/ThatOpen/engine_web-ifc) for IFC parsing (WASM)

## Features

- Full-screen 3D viewport with orbit/pan/zoom camera controls, lighting, and a reference grid.
- Load one or more local `.ifc` files via a file picker or drag-and-drop — nothing leaves your machine.
- Load multiple models into the same scene (e.g. architectural + structural) without clearing previous ones.
- Sidebar listing every loaded model with a visibility toggle and a remove button.
- Loading indicator while a file is being parsed, and error handling for invalid IFC files.

## Plans & cases

Three pages in the header: **3D**, **Plans**, **Photos**.

- **Plans** — a 2D section plan for every building storey (cut height adjustable), built from the loaded IFC. Pan/zoom with mouse or touch. `+ Case` then tap the plan to create a case (title, discipline RIB/RIV/RIR/RIE, summary, photos). The case stores its floor, plan position and, when calibrated, GPS coordinates.
- **GPS** — turn GPS on, stand somewhere you can identify on the plan, press *Set my position* and tap that spot. Your blue dot then follows your phone's GPS; `+ Case here` creates a case at your position. A second calibration point improves the rotation; otherwise the plan's north comes from the IFC (editable).
- **Photos** — every photo from every case, filterable by discipline, with a viewer and *Show on plan*.

Cases and photos are stored locally in the browser (IndexedDB); nothing is uploaded. GPS needs HTTPS or localhost.

## Getting started

```bash
npm install
npm run dev
```

Then open the printed local URL and pick (or drop) an `.ifc` file.

## Build

```bash
npm run build
npm run preview
```
