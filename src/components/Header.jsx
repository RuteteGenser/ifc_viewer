import LogoMark from "./LogoMark";
import { NAME } from "../brand";
import { ModelsChip } from "./ModelsSheet";
import { AccountButton } from "../access/AccessUI";

export default function Header({ sidebarOpen, onToggleSidebar, sidebarCollapsed, onToggleCollapsed, modelCount = 0, showModelsChip = false, modelsOpen = false, onToggleModels }) {
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

      <button
        type="button"
        className="sidebar-collapse"
        aria-label={sidebarCollapsed ? "Show model list" : "Hide model list"}
        aria-expanded={!sidebarCollapsed}
        title={sidebarCollapsed ? "Show model list" : "Hide model list"}
        onClick={onToggleCollapsed}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16" />
        </svg>
      </button>

      <div className="header__brand">
        <LogoMark />
        <span className="header__title">{NAME}</span>
      </div>

      <AccountButton className="acc-account-btn--header" />
      {showModelsChip && modelCount > 0 && <ModelsChip count={modelCount} open={modelsOpen} onClick={onToggleModels} />}
    </header>
  );
}
