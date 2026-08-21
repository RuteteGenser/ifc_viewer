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
