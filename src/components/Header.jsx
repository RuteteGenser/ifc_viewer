import LogoMark from "./LogoMark";

const PAGES = [
  { id: "3d", label: "3D" },
  { id: "plans", label: "Plans" },
  { id: "photos", label: "Photos" },
];

export default function Header({ sidebarOpen, onToggleSidebar, page, onPageChange, photoCount }) {
  return (
    <header className="header">
      <button
        type="button"
        className="menu-toggle"
        aria-label={sidebarOpen ? "Close menu" : "Open menu"}
        onClick={onToggleSidebar}
      >
        {sidebarOpen ? "✕" : "☰"}
      </button>

      <div className="header__brand">
        <LogoMark />
        <span className="header__title">Martins IFC viewer</span>
      </div>

      <nav className="header__pages" aria-label="Pages">
        {PAGES.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`header__page${page === p.id ? " header__page--active" : ""}`}
            aria-current={page === p.id ? "page" : undefined}
            onClick={() => onPageChange(p.id)}
          >
            {p.label}
            {p.id === "photos" && photoCount > 0 ? <span className="header__badge">{photoCount}</span> : null}
          </button>
        ))}
      </nav>
    </header>
  );
}
