import { splitForMiddleEllipsis, splitModelName } from "../ifc/modelLabel";

// A file name for a list: without the extension and the "(source, licence)"
// note, and when it is too long the middle is cut, not the end. The full name
// is the tooltip.
export default function ModelName({ name, className = "" }) {
  const { title } = splitModelName(name);
  const { head, tail } = splitForMiddleEllipsis(title);
  return (
    <span className={`model-name ${className}`.trim()} title={name}>
      <span className="model-name__head">{head}</span>
      {tail && <span className="model-name__tail">{tail}</span>}
    </span>
  );
}
