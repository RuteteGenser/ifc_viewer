import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { copyText } from "../components/copyText";
import { startupIntent } from "../reliability/recovery";
import { attemptText } from "../reliability/retry";
import {
  ALLOWED,
  MAX_BYTES,
  LibraryError,
  deleteModel,
  downloadModel,
  extensionOf,
  getModel,
  linkFor,
  listFolders,
  createFolder as apiCreateFolder,
  renameFolder as apiRenameFolder,
  moveFolder as apiMoveFolder,
  deleteFolder as apiDeleteFolder,
  moveModel as apiMoveModel,
  listModels,
  renameModel,
  uploadModel,
} from "./api";
import { whenSessionSettled } from "../access/api";
import { folderMessage, loadFolder, saveFolder, pathOf } from "./folders";
import { isRealProject } from "./projects";

// Everything about the server model library in one place. The only link
// to the viewer is loadFiles(files); the library is optional, so a status
// of "hidden" (no API, signed out) leaves the app exactly as it was.
export function useLibrary({ loadFiles, models, onLoadSample, onOpened, onRenamed, canSave: serverSavingAllowed }) {
  const [status, setStatus] = useState("loading"); // loading | ready | error | hidden
  const [items, setItems] = useState([]);
  const [listError, setListError] = useState("");
  const [download, setDownload] = useState(null); // { name, percent|null }
  const [upload, setUpload] = useState(null); // { name, percent, more }
  const [notice, setNotice] = useState(null); // { id, tone, text }
  const [folderData, setFolderData] = useState(null); // null = this backend has no folders: no folder UI at all
  const [folderId, setFolderIdState] = useState(loadFolder); // the folder being looked at, null = top level
  const [projectId, setProjectId] = useState(null); // the open project: a folder id, UNSORTED_ID, DUMMY_ID or null (the project browser)

  const abortDownloadRef = useRef(null);
  const waitingRecordsRef = useRef([]); // library models clicked while another downloads
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
  const onRenamedRef = useRef(onRenamed);
  onRenamedRef.current = onRenamed;

  const say = useCallback((text, tone = "info", retry) => {
    window.clearTimeout(noticeTimerRef.current);
    setNotice({ id: Date.now() + Math.random(), tone, text, retry });
    if (tone !== "error") noticeTimerRef.current = window.setTimeout(() => setNotice(null), 4000);
  }, []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  const refresh = useCallback(async () => {
    const seq = ++refreshSeqRef.current;
    lastRefreshRef.current = Date.now();
    setListError("");
    try {
      // The first visit waits for the session call so the device cookie exists (no 401 in the console).
      await whenSessionSettled();
      if (seq !== refreshSeqRef.current) return;
      const [fol, data] = await Promise.all([listFolders(), listModels()]);
      if (seq !== refreshSeqRef.current) return;
      setFolderData(fol);
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
    window.addEventListener("argus:library-refresh", refresh); // sent when the signed-in account changes
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("argus:library-refresh", refresh);
    };
  }, [refresh]);

  const loadedNames = useMemo(() => new Set(models.map((m) => m.name)), [models]);

  // ---- open from the library ----
  const openRecord = useCallback(
    async (record, { add = false } = {}) => {
      // Another download is running: this one waits its turn (never dropped silently).
      if (abortDownloadRef.current) {
        if (!waitingRecordsRef.current.some((r) => r.record.id === record.id)) waitingRecordsRef.current.push({ record, add });
        say(`Added to the queue: ${record.name}`);
        return;
      }
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
            setDownload((d) => ({ name: record.name, percent: pct, note: d?.note }));
          },
          // A failed download starts over by itself: say so instead of showing an error.
          onAttempt: (attempt, total) => {
            lastPct = -1;
            setDownload({ name: record.name, percent: 0, note: attemptText("Downloading", attempt, total) });
          },
        });
        loadFilesRef.current([file], { add, fromLibrary: true });
      } catch (err) {
        if (!err?.aborted) {
          if (err?.detail) console.error(`Download of ${record.name} failed: ${err.detail}`);
          say(err?.message || "Could not open that model.", "error", err?.retryable ? () => openRecord(record, { add }) : undefined);
        }
      } finally {
        abortDownloadRef.current = null;
        setDownload(null);
        // Cancel drops the waiting ones too; otherwise the next one starts.
        const next = controller.signal.aborted ? null : waitingRecordsRef.current.shift();
        if (controller.signal.aborted) waitingRecordsRef.current = [];
        if (next) openRecordRef.current?.(next.record, { add: next.add });
      }
    },
    [say],
  );
  const openRecordRef = useRef(null);
  openRecordRef.current = openRecord;

  const open = useCallback(
    (item, options) => {
      if (loadedNames.has(item.name)) {
        onOpenedRef.current?.();
        return;
      }
      openRecord(item, options);
    },
    [loadedNames, openRecord],
  );
  // "Add to view": opens next to what is loaded instead of replacing it.
  const addToView = useCallback((item) => open(item, { add: true }), [open]);

  const cancelDownload = useCallback(() => abortDownloadRef.current?.abort(), []);

  // ?model=<id>: open once on load. loadFiles queues the file until the viewer is ready.
  const deepLinkRef = useRef(false);
  useEffect(() => {
    if (deepLinkRef.current) return;
    // ?model=<id>, or the model that was being opened when Argus reloaded itself after an update.
    const resumed = startupIntent();
    const id = new URLSearchParams(window.location.search).get("model") || (resumed?.type === "library" ? resumed.id : null);
    if (!id) return;
    deepLinkRef.current = true;
    getModel(id)
      .then((record) => openRecord(record))
      .catch((err) => {
        say(err?.status === 404 ? "That model is no longer saved." : "Could not open that model.", "error");
        // Drop the link from the address bar so a reload does not repeat this.
        try {
          const url = new URL(window.location.href);
          url.searchParams.delete("model");
          window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
        } catch {
          // history is not available: the notice just shows again on reload
        }
      });
  }, [openRecord, say]);

  // ---- save to the library ----
  const runUploads = useCallback(async () => {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    let saved = 0;
    let dup = 0;
    let savedTo = null;
    try {
      while (uploadQueueRef.current.length) {
        const { file, target } = uploadQueueRef.current.shift();
        const more = uploadQueueRef.current.length;
        setUpload({ name: file.name, percent: 0, more });
        const job = uploadModel(file, (fraction) => setUpload((u) => (u ? { ...u, percent: Math.floor(fraction * 100) } : u)));
        abortUploadRef.current = job.abort;
        try {
          const { record, duplicate } = await job.promise;
          // The server stores a model first and files it second: into the project, unless it already sits in one.
          if (target && record?.id && !record.folderId) {
            try {
              await apiMoveModel(record.id, target);
            } catch (err) {
              say(`${file.name} was saved but could not be put in the project: ${folderMessage(err)}`, "error");
            }
          }
          if (duplicate) dup += 1;
          else saved += 1;
          savedTo = target || savedTo;
        } catch (err) {
          if (err?.aborted) {
            uploadQueueRef.current = [];
            say("Upload cancelled.");
          } else if (!err?.handled) {
            say(`${file.name}: ${err?.message || "Could not save that model."}`, "error");
          }
        }
        abortUploadRef.current = null;
      }
      if (saved || dup) {
        const where = foldersRef.current?.find((f) => f.id === savedTo)?.name;
        const to = where ? `Saved to ${where}.` : "Saved to my models.";
        say(saved && dup ? `${to} Some were already there.` : saved ? to : "Already saved.", "ok");
        refresh();
      }
    } finally {
      uploadingRef.current = false;
      setUpload(null);
    }
  }, [refresh, say]);

  const saveFiles = useCallback(
    (files, target = null) => {
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
      uploadQueueRef.current.push(...ok.map((file) => ({ file, target })));
      runUploads();
    },
    [runUploads, say],
  );

  const cancelUpload = useCallback(() => abortUploadRef.current?.(), []);

  // Local file picker / drop: opens the file; inside a project it is saved into that project, anywhere else it is only viewed.
  const openLocal = useCallback(
    (fileList, { add = false } = {}) => {
      const files = Array.from(fileList);
      for (const f of files) localFilesRef.current.set(f.name, f);
      loadFilesRef.current(files, { add });
      // Without an active plan the server would refuse; the file still opens, it just is not saved.
      if (isRealProject(projectId) && folderData && status === "ready" && serverSavingAllowed?.() !== false) saveFiles(files, projectId);
    },
    [projectId, folderData, status, saveFiles, serverSavingAllowed],
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
      onRenamedRef.current?.(item.name, updated?.name ?? name);
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

  // ---- folders: each returns "" on success or a sentence about what went wrong ----
  const folders = folderData?.folders ?? null;
  const foldersRef = useRef(null);
  foldersRef.current = folders;
  const folderLimit = folderData?.limit ?? 0;
  const setFolder = useCallback((id) => {
    setFolderIdState(id || null);
    saveFolder(id || null);
  }, []);
  // A folder that is gone (deleted on another device) sends the view back to the top.
  useEffect(() => {
    if (folders && folderId && !folders.some((f) => f.id === folderId)) setFolder(null);
  }, [folders, folderId, setFolder]);
  const reloadFolders = useCallback(async () => {
    const fol = await listFolders();
    if (fol) setFolderData(fol);
  }, []);
  const folderAction = useCallback(
    async (run, after) => {
      try {
        const result = await run();
        await reloadFolders();
        await after?.(result);
        return "";
      } catch (err) {
        return folderMessage(err, folderData?.limit);
      }
    },
    [folderData?.limit, reloadFolders],
  );
  const createFolder = useCallback((name, parentId) => folderAction(() => apiCreateFolder(name.trim(), parentId)), [folderAction]);
  const renameFolder = useCallback((id, name) => folderAction(() => apiRenameFolder(id, name.trim())), [folderAction]);
  const moveFolder = useCallback((id, parentId) => folderAction(() => apiMoveFolder(id, parentId)), [folderAction]);
  const deleteFolder = useCallback(
    (id) =>
      folderAction(
        () => apiDeleteFolder(id),
        async () => {
          if (pathOf(folders || [], folderId).some((f) => f.id === id)) setFolder(pathOf(folders, id).at(-2)?.id ?? null);
          await refresh();
        },
      ),
    [folderAction, folders, folderId, refresh, setFolder],
  );
  const moveModel = useCallback(
    (item, target) =>
      folderAction(
        () => apiMoveModel(item.id, target),
        () => setItems((list) => list.map((m) => (m.id === item.id ? { ...m, folderId: target } : m))),
      ),
    [folderAction],
  );

  // ---- projects: a project is a top level folder ----
  const openProject = useCallback((id) => setProjectId(id || null), []);
  // A project deleted on another device sends the view back to the browser.
  useEffect(() => {
    if (folders && isRealProject(projectId) && !folders.some((f) => f.id === projectId)) setProjectId(null);
  }, [folders, projectId]);
  // { folder, error }: the new folder, or a sentence about what went wrong.
  const createProject = useCallback(
    async (name) => {
      try {
        const folder = await apiCreateFolder(name.trim(), null);
        await reloadFolders();
        return { folder, error: "" };
      } catch (err) {
        return { folder: null, error: folderMessage(err, folderData?.limit) };
      }
    },
    [folderData?.limit, reloadFolders],
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
    projectId,
    openProject,
    createProject,
    loadedNames,
    hasModels: models.length > 0,
    savedNames,
    refresh,
    open,
    addToView,
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
    folders,
    folderLimit,
    folderId,
    setFolder,
    createFolder,
    renameFolder,
    moveFolder,
    deleteFolder,
    moveModel,
  };
}
