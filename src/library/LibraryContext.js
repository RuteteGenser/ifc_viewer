import { createContext, useContext } from "react";

export const LibraryContext = createContext(null);
export const useLibraryContext = () => useContext(LibraryContext);
