import { createContext, useContext } from "react";

// The model-structure bundle from useModelBrowser (trees, names, select, hide).
// A context so the search bar can reach it without threading props through
// the toolbar.
export const BrowserContext = createContext(null);
export const useBrowser = () => useContext(BrowserContext);
