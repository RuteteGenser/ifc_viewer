// Test-only mount point; compiled in only when VITE_TEST_HOOK is set (see App.jsx). Never in production.
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import Annotations from "./Annotations";

function mountAnnotationLayer(el, viewer, props = {}) {
  const root = createRoot(el);
  let items = props.annotations || [];
  const render = () => root.render(createElement(Annotations, { ...props, viewer, annotations: items, onChange: (next) => { items = next; props.onChange?.(next); render(); } }));
  render();
  return {
    getAnnotations: () => items,
    setAnnotations: (next) => { items = next; render(); },
    unmount: () => root.unmount(),
  };
}

window.__annotations = { mountAnnotationLayer };
