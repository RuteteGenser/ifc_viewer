import LogoMark from "./LogoMark";

const PAGES = [
  {
    id: "3d",
    label: "3D",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
        <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
      </svg>
    ),
  },
  {
    id: "plans",
    label: "Plans",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="1.5" />
        <path d="M3 10h8M15 3v7M11 10v11M15 15h6" />
      </svg>
    ),
  },
  {
    id: "photos",
    label: "Photos",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="9" cy="10.5" r="1.6" />
        <path d="M21 16l-5-5-8 8" />
      </svg>
    ),
  },
];

// Top tabs on desktop (inside the header)...
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

// ...and a thumb-reachable bottom tab bar on phones (CSS shows one or the other).
export function BottomNav({ page, onPageChange, photoCount }) {
  return (
    <nav className="bottom-nav" aria-label="Pages">
      {PAGES.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`bottom-nav__item${page === p.id ? " bottom-nav__item--active" : ""}`}
          aria-current={page === p.id ? "page" : undefined}
          onClick={() => onPageChange(p.id)}
        >
          <span className="bottom-nav__icon">
            {p.icon}
            {p.id === "photos" && photoCount > 0 ? <span className="bottom-nav__badge">{photoCount}</span> : null}
          </span>
          {p.label}
        </button>
      ))}
    </nav>
  );
}
