import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { copyText } from "../components/copyText";
import {
  ALLOWED,
  MAX_BYTES,
  LibraryError,
  deleteModel,
  downloadModel,
  extensionOf,
  getModel,
  linkFor,
  listModels,
  renameModel,
  uploadModel,
} from "./api";

const PREF_KEY = "ifcViewer.alsoSaveToLibrary";
const readPref = () => {
  try {
    return localStorage.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
};

// Everything about the server model library in one place. The only link
// to the viewer is loadFiles(files); the library is optional, so a status
// of "hidden" (no API, signed out) leaves the app exactly as it was.
export function useLibrary({ loadFiles, models, onLoadSample, onOpened }) {
  const [status, setStatus] = useState("loading"); // loading | ready | error | hidden
  const [items, setItems] = useState([]);
  const [listError, setListError] = useState("");
  const [download, setDownload] = useState(null); // { name, percent|null }
  const [upload, setUpload] = useState(null); // { name, percent, more }
  const [notice, setNotice] = useState(null); // { id, tone, text }
  const [alsoSave, setAlsoSaveState] = useState(readPref);

  const abortDownloadRef = useRef(null);
  const abortUploadRef = useRef(null);
  const uploadQueueRef = useRef([]);
  const uploadingRef = useRef(false);
  const localFilesRef = useRef(new Map()); // name -> File opened from this device
  const noticeTimerRef = useRef(0);
  const lastRefreshRef = useRef(0);
  const refreshSeqRef = useRef(0);
  const loadFilesRef = useRef(loadFiles);
  loadFilesRef.current = loadFiles;
  const onOpenedRef = useRef(onOpened);
  onOpenedRef.current = onOpened;

  const say = useCallback((text, tone = "info") => {
    window.clearTimeout(noticeTimerRef.current);
    setNotice({ id: Date.now() + Math.random(), tone, text });
    if (tone !== "error") noticeTimerRef.current = window.setTimeout(() => setNotice(null), 4000);
  }, []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  const refresh = useCallback(async () => {
    const seq = ++refreshSeqRef.current;
    lastRefreshRef.current = Date.now();
    setListError("");
    try {
      const data = await listModels();
      if (seq !== refreshSeqRef.current) return;
      setItems(data);
      setStatus("ready");
    } catch (err) {
      if (seq !== refreshSeqRef.current) return;
      if (err instanceof LibraryError && err.hidden) {
        setStatus("hidden");
      } else {
        setListError(err?.message || "Your models are not available right now.");
        setStatus("error");
      }
    }
  }, []);

  useEffect(() => {
    refresh();
    // Models saved from another device show up when you come back to this tab.
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRefreshRef.current > 30000) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const setAlsoSave = useCallback((value) => {
    setAlsoSaveState(value);
    try {
      localStorage.setItem(PREF_KEY, value ? "1" : "0");
    } catch {
      // private mode: the choice just isn't remembered
    }
  }, []);

  const loadedNames = useMemo(() => new Set(models.map((m) => m.name)), [models]);

  // ---- open from the library ----
  const openRecord = useCallback(
    async (record) => {
      if (abortDownloadRef.current) return;
      const controller = new AbortController();
      abortDownloadRef.current = controller;
      onOpenedRef.current?.();
      setDownload({ name: record.name, percent: 0 });
      setNotice(null);
      let lastPct = -1;
      try {
        const file = await downloadModel(record, {
          signal: controller.signal,
          onProgress: (fraction) => {
            const pct = fraction == null ? null : Math.floor(fraction * 100);
            if (pct === lastPct) return;
            lastPct = pct;
            setDownload({ name: record.name, percent: pct });
          },
        });
        loadFilesRef.current([file]);
      } catch (err) {
        if (!err?.aborted) say(err?.message || "Could not open that model.", "error");
      } finally {
        abortDownloadRef.current = null;
        setDownload(null);
      }
    },
    [say],
  );

  const open = useCallback(
    (item) => {
      if (loadedNames.has(item.name)) {
        onOpenedRef.current?.();
        return;
      }
      openRecord(item);
    },
    [loadedNames, openRecord],
  );

  const cancelDownload = useCallback(() => abortDownloadRef.current?.abort(), []);

  // ?model=<id>: open once on load. loadFiles queues the file until the viewer is ready.
  const deepLinkRef = useRef(false);
  useEffect(() => {
    if (deepLinkRef.current) return;
    const id = new URLSearchParams(window.location.search).get("model");
    if (!id) return;
    deepLinkRef.current = true;
    getModel(id)
      .then((record) => openRecord(record))
      .catch((err) => say(err?.status === 404 ? "That model is not saved here any more." : err?.message || "Could not open that model.", "error"));
  }, [openRecord, say]);

  // ---- save to the library ----
  const runUploads = useCallback(async () => {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    let saved = 0;
    let dup = 0;
    try {
      while (uploadQueueRef.current.length) {
        const file = uploadQueueRef.current.shift();
        const more = uploadQueueRef.current.length;
        setUpload({ name: file.name, percent: 0, more });
        const job = uploadModel(file, (fraction) => setUpload((u) => (u ? { ...u, percent: Math.floor(fraction * 100) } : u)));
        abortUploadRef.current = job.abort;
        try {
          const { duplicate } = await job.promise;
          if (duplicate) dup += 1;
          else saved += 1;
        } catch (err) {
          if (err?.aborted) {
            uploadQueueRef.current = [];
            say("Upload cancelled.");
          } else {
            say(`${file.name}: ${err?.message || "Could not save that model."}`, "error");
          }
        }
        abortUploadRef.current = null;
      }
      if (saved || dup) {
        say(saved && dup ? "Saved to my models. Some were already there." : saved ? "Saved to my models." : "Already saved.", "ok");
        refresh();
      }
    } finally {
      uploadingRef.current = false;
      setUpload(null);
    }
  }, [refresh, say]);

  const saveFiles = useCallback(
    (files) => {
      const ok = [];
      for (const file of files) {
        if (!ALLOWED.includes(extensionOf(file.name))) {
          say(`${file.name}: only .ifc, .ifczip and .zip files can be saved.`, "error");
        } else if (file.size > MAX_BYTES) {
          say(`${file.name}: that file is too large. The limit is 250 MB.`, "error");
        } else if (file.size === 0) {
          say(`${file.name}: that file is empty.`, "error");
        } else {
          ok.push(file);
        }
      }
      if (!ok.length) return;
      uploadQueueRef.current.push(...ok);
      runUploads();
    },
    [runUploads, say],
  );

  const cancelUpload = useCallback(() => abortUploadRef.current?.(), []);

  // Local file picker / drop: open as before, optionally save too.
  const openLocal = useCallback(
    (fileList) => {
      const files = Array.from(fileList);
      for (const f of files) localFilesRef.current.set(f.name, f);
      loadFilesRef.current(files);
      if (alsoSave && status !== "hidden" && status !== "loading") saveFiles(files);
    },
    [alsoSave, status, saveFiles],
  );

  const savedNames = useMemo(() => new Set(items.map((i) => i.name)), [items]);
  const fileFor = useCallback((name) => localFilesRef.current.get(name) ?? null, []);
  const canSave = useCallback((name) => status === "ready" && localFilesRef.current.has(name), [status]);

  // ---- manage ----
  const rename = useCallback(async (item, raw) => {
    let name = raw.trim();
    if (!name) return "Enter a name.";
    if (!ALLOWED.includes(extensionOf(name))) name += extensionOf(item.name);
    if (name === item.name) return "";
    try {
      const updated = await renameModel(item.id, name);
      setItems((list) => list.map((m) => (m.id === item.id ? { ...m, ...updated } : m)));
      return "";
    } catch (err) {
      return err?.message || "Could not rename.";
    }
  }, []);

  const remove = useCallback(
    async (item) => {
      try {
        await deleteModel(item.id);
        setItems((list) => list.filter((m) => m.id !== item.id));
        say("Deleted.", "ok");
      } catch (err) {
        if (err?.status === 404) setItems((list) => list.filter((m) => m.id !== item.id));
        else say(err?.message || "Could not delete.", "error");
      }
    },
    [say],
  );

  const copyLink = useCallback(
    async (item) => {
      const ok = await copyText(linkFor(item.id));
      say(ok ? "Link copied." : "Could not copy the link.", ok ? "ok" : "error");
    },
    [say],
  );

  return {
    status,
    available: status !== "hidden",
    items,
    listError,
    download,
    upload,
    notice,
    alsoSave,
    setAlsoSave,
    loadedNames,
    savedNames,
    refresh,
    open,
    openSample: onLoadSample,
    cancelDownload,
    cancelUpload,
    dismissNotice,
    openLocal,
    saveFiles,
    fileFor,
    canSave,
    rename,
    remove,
    copyLink,
  };
}
