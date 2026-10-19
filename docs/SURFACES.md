# Surfaces: one thing at a time on a phone

Phone layout = `(max-width: 768px), (max-height: 500px) and (pointer: coarse)` (`PHONE_QUERY`). Desktop is unchanged.
Measured at iPhone 13 and 320x568 with everything opened (before): the Cases sheet stacked on the details sheet (2 dialogs),
Share menu over the details sheet plus the measure pill, toasts hidden behind Models/Cases, error banner and tool pill on the
same pixels, header + toolbar already 25 percent of a 568 px screen.

## Inventory (phone)
| Surface | Layer (z) | Size | Covers |
| --- | --- | --- | --- |
| Header + toolbar (+ access slim bar) | 41-42 | 52 + 2 rows | top 20-25 percent, persistent |
| Menu drawer (Sidebar) | 45, scrim 44 | 85 vw x full | left, whole height |
| Details sheet (Properties, Measurements, Tags) | 40 | half 42 dvh, full 85 dvh | bottom; canvas shrinks above it |
| Models sheet | 71, scrim 70 | up to 80 dvh | bottom, dims the rest |
| Cases sheet | 71 | up to 62 dvh | bottom |
| Gesture help sheet | 61 | up to 80 dvh | bottom |
| Views panel, Share menu | 17 | 230-340 px popovers | top right, under the zoom buttons |
| Search results | in toolbar | list | under toolbar |
| Context menu, measure popups, confirm dialogs | 50 / 60+ | small | modal, above everything |
| Tool pill (measure/tag/hide/section), camera-clip slider | 19 (HUD) | 1 row | under toolbar |
| Banners: error / update, multi-model notice, first-run card, toast | 20 / 44 | 1 row | top / bottom |
| Floating: zoom, undo/redo, compass, plane switch, details FAB | 15-17 | 44 px | corners |

## Rules
1. **One sheet.** `sheet` slot: menu, models, details, cases, views, share, help. Opening one replaces the open one (existing exit animation). Only `src/ui/surfaces.js` holds this state; `useSurfaceFlag(id)` is the only way a component opens one.
2. **One tool.** `tool` slot: measure, tag, hide-category, section-move, camera-clip (annotate joins by `useSurfaceMirror`). Arming one disarms the others, and closes any sheet. Opening a sheet disarms the tool. Stricter than "coexist at peek": the details sheet already has hidden/half/full plus a FAB, a third "peek" height would be one more state to keep and the tool pill is the one compact bar.
3. **Overlays** (context menu, measure popups, confirm dialogs) are modal and may sit above a sheet. They do not close it.
4. **Height budget.** Modal bottom sheets stop at 60 percent of the canvas (`--sheet-max`), content scrolls; details opens at half (at most ~60 percent of the canvas) and goes full only when asked. Full hides the floating controls instead of overlapping them. Drag the head down to dismiss; tap the scrim, the canvas or press Esc/Back to close.
5. **Transient.** One toast at a time (a new one replaces, never stacks; queueing delays and then shows stale news). It sits above the open sheet. First-run card and multi-model notice wait while a sheet is open. Error banner, update banner and tool pill share the one HUD column under the toolbar; a banner wins over the pill.
6. **Back and Esc.** Back closes the topmost surface (overlay, then sheet, then tool) and re-arms the leave guard; it asks "Leave the viewer?" only when nothing is open. Esc keeps its existing per-surface handlers (they never stack now).
7. **Desktop.** The manager runs non-exclusive (sheets keep their own dismissal; Views/Share stay mutually exclusive, as before), no new CSS applies.

Why not a global drawer stack or full 3-snap everywhere: a stack lets clutter come back one layer at a time; snaps for list-like sheets add gesture conflicts with their scroll. One slot per kind is the smallest rule that makes clutter impossible. Test builds log `console.error` if two sheets are mounted on a phone.
