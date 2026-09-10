import SearchBar from "./SearchBar";
import ShortcutsHelp from "./ShortcutsHelp";
import LogoMark from "./LogoMark";

export default function Header({
  sidebarOpen,
  onToggleSidebar,
  searchQuery,
  onQueryChange,
  searchResults,
  isolatedKeys,
  onToggleIsolate,
  onClearIsolation,
}) {
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

      <SearchBar
        query={searchQuery}
        onQueryChange={onQueryChange}
        results={searchResults}
        isolatedKeys={isolatedKeys}
        onToggleIsolate={onToggleIsolate}
        onClearIsolation={onClearIsolation}
      />

      <ShortcutsHelp />
    </header>
  );
}
