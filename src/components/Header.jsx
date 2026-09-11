import LogoMark from "./LogoMark";

export default function Header({ sidebarOpen, onToggleSidebar }) {
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
    </header>
  );
}
