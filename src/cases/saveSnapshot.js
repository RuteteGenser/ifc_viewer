// "Save snapshot": captures the current view and picture and adds them to the open case (or a new one named after the model).
import { store } from "./store";
import { addSnapshot, updateSnapshot } from "./caseOps";
import { COPY } from "./copy";

// viewer: the cases adapter from useIfcViewer. controller: actions of useCases(). Returns { caseId, snapshotId } or null.
export async function saveSnapshot({ viewer, controller, currentId, title = "", showToast, annotations = [] }) {
  try {
    const [view, image, thumb, info] = await Promise.all([
      viewer.captureView(),
      viewer.captureImage({ maxWidth: 1280, quality: 0.82 }),
      viewer.captureImage({ maxWidth: 320, quality: 0.7 }),
      viewer.getModelInfo(),
    ]);
    if (!view || !info) { showToast(COPY.needModel); return null; }
    let c = currentId ? await store.getCase(currentId) : null;
    if (!c) {
      const made = await controller.create(`${info.name} case`, info);
      c = await store.getCase(made.id);
    }
    let { case: next, snapshot } = addSnapshot(c, { title: title.trim().slice(0, 200), view, image, thumb });
    if (annotations.length) next = updateSnapshot(next, snapshot.id, { annotations }); // saved while annotating: the marks come along
    await store.saveCase(next);
    controller.setCurrent(next.id);
    showToast(COPY.savedTo(next.name));
    return { caseId: next.id, snapshotId: snapshot.id };
  } catch (err) {
    showToast(err?.name === "CaseLimitError" ? err.message : COPY.saveFailed);
    return null;
  }
}
