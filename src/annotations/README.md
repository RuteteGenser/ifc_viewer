# Annotations layer (standalone)

3D annotations (comment, pin, arrow, text, freehand) drawn as an overlay over the canvas. It knows nothing about
three or `useIfcViewer`: everything comes through the injected `viewer` object. Data format: `src/cases/schema.js`
(`newAnnotation`, `LIMITS`, `PALETTE`); the snapshot's `annotations` array goes in and out unchanged.

## Mounting (Cases lane)
Inside the viewport wrapper (a positioned element that covers the canvas), after the canvas, before dialogs/sheets:

```jsx
import Annotations from "../annotations/Annotations";
<Annotations viewer={viewer} annotations={snapshot.annotations} onChange={(next) => saveAnnotations(next)} author="Ada" />
```
- `annotations`: the current snapshot's array. Pass a NEW array when the snapshot changes: undo history resets then.
  Keep the same array identity between renders otherwise.
- `onChange(next)`: called with a fresh array after every add / edit / recolour / delete / undo / redo. Persist it.
- Mount only while annotating or presenting a snapshot. Unmounting removes all listeners.
- The root is `position:absolute; inset:0; pointer-events:none`. Only the small handles, the action bar, the editor and
  the dock take pointer events, plus a full-size capture surface while a tool is armed. Z-order inside the wrapper:
  canvas < marks (13-15) < dock (16) < action bar/editor (17-18) < the app's `.hud` (19).
- Parts, if you want your own layout: `AnnotationLayer` (props: viewer, annotations, tool, color, selectedId, onSelect,
  onCreate(a), onUpdate(id, patch), onRemove(id), author), `AnnotationToolbar` (tool, onTool, color, onColor, canUndo,
  canRedo, onUndo, onRedo, hasSelection, onDelete, onCancel) and `useAnnotations(annotations, onChange)`.
- The toolbar owns the shortcuts (C P A T F, Esc, Delete, Ctrl/Cmd+Z, Ctrl+Shift+Z or Ctrl+Y); they are ignored while typing.

## `viewer` interface
| member | contract |
| --- | --- |
| `project([x,y,z]) -> {x, y, visible, depth}` | px in the overlay's coordinate space; `visible=false` when behind the camera or off-screen |
| `pick(clientX, clientY) -> Promise<{point, guid\|null, storey\|null} \| null>` | raycast under a screen point (adapt `raycastVisible`); null = missed the model |
| `isOccluded([x,y,z]) -> boolean` | cheap, cached test (as the tag occlusion). Optional: missing = visible |
| `subscribeCamera(cb) -> unsubscribe` | call `cb` on every camera / model-pose change and canvas resize. The layer coalesces to one rAF per burst |
| `getSize() -> {width, height}` | overlay size in px |
| `unprojectOnPlane(clientX, clientY, [x,y,z]) -> [x,y,z]` | OPTIONAL: point under the pixel on the camera-facing plane through the given point. Without it an arrow cannot end off the model and freehand drops points that miss |

`project` and `getSize` use overlay-local px, `pick` and `unprojectOnPlane` take client px.

## Behaviour
Occluded marks fade to 25 percent with a dashed style, off-screen / behind-camera marks are hidden (an arrow needs both
ends visible; a freehand stroke is cut at hidden points). Cards are open on desktop and collapsed to the number on touch
(tap the badge: select + open + action bar). Arrow min length 24 px; freehand is simplified (Ramer-Douglas-Peucker,
at most 200 points). Limits come from `LIMITS` (100 per snapshot, 2000 chars).

## Tests
`tests/unit/annotations-*.test.mjs` (geometry, reducer). `tests/e2e/annotations.e2e.mjs` needs a `VITE_TEST_HOOK=1` build:
`mountForTests.js` is imported from App.jsx behind that flag only and exposes `window.__annotations.mountAnnotationLayer`.
