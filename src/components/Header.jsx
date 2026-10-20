import LogoMark from "./LogoMark";
import { NAME } from "../brand";
import { AccountButton } from "../access/AccessUI";

export default function Header({ sidebarOpen, onToggleSidebar, sidebarCollapsed, onToggleCollapsed, crumbs = [] }) {
  return (
    <header className="header">
      <button
        type="button"
        className="menu-toggle"
        aria-label={sidebarOpen ? "Close menu" : "Open menu"}
        onClick={onToggleSidebar}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
          {sidebarOpen ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>

      {onToggleCollapsed && (
      <button
        type="button"
        className="sidebar-collapse"
        aria-label={sidebarCollapsed ? "Show model list" : "Hide model list"}
        aria-expanded={!sidebarCollapsed}
        title={sidebarCollapsed ? "Show model list" : "Hide model list"}
        onClick={onToggleCollapsed}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16" />
        </svg>
      </button>
      )}

      <div className="header__brand">
        <LogoMark />
        <span className="header__title">{NAME}</span>
      </div>

      {crumbs.length > 0 && (
        <nav className="header__crumbs" aria-label="Where you are">
          <ol>
            {crumbs.map((c, i) => (
              <li key={i}>
                {c.onClick ? (
                  <button type="button" className="header__crumb" onClick={c.onClick}>
                    {c.label}
                  </button>
                ) : (
                  <span className="header__crumb" aria-current={i === crumbs.length - 1 ? "page" : undefined}>
                    {c.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <AccountButton className="acc-account-btn--header" />
    </header>
  );
}
