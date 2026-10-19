import { useCallback, useState } from "react";
import { PALETTE } from "../cases/schema";
import AnnotationLayer from "./AnnotationLayer";
import AnnotationToolbar from "./AnnotationToolbar";
import { useAnnotations } from "./useAnnotations";

// Layer + toolbar wired together. Mount inside the viewport wrapper, above the canvas.
// Props: viewer, annotations (current snapshot's array), onChange(nextArray), author.
export default function Annotations({ viewer, annotations, onChange, author = "" }) {
  const a = useAnnotations(annotations, onChange);
  const [tool, setTool] = useState(null);
  const [color, setColor] = useState(PALETTE[0]);
  const [selectedId, setSelectedId] = useState(null);
  const onDelete = useCallback(() => { if (selectedId) { a.remove(selectedId); setSelectedId(null); } }, [a, selectedId]);
  const exists = a.items.some((x) => x.id === selectedId);
  return (
    <>
      <AnnotationLayer viewer={viewer} annotations={a.items} tool={tool} color={color} author={author}
        selectedId={exists ? selectedId : null} onSelect={setSelectedId}
        onCreate={(x) => { a.add(x); setSelectedId(null); }} onUpdate={a.update} onRemove={a.remove} />
      <AnnotationToolbar tool={tool} onTool={(t) => { setTool(t); setSelectedId(null); }} color={color} onColor={setColor}
        canUndo={a.canUndo} canRedo={a.canRedo} onUndo={a.undo} onRedo={a.redo}
        hasSelection={exists} onDelete={onDelete} onCancel={() => (tool ? setTool(null) : setSelectedId(null))} />
    </>
  );
}
