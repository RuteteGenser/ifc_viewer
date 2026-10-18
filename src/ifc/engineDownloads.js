// Orders the downloads behind the first model. They are bandwidth-bound on a
// slow link, and started all at once they finish together, leaving the CPU
// work (parse the engine code, compile the wasm, convert the IFC, boot the
// worker) to run only after the last byte. In this order each file's CPU work
// hides behind the next file's download instead:
//
//   engine code        -> parsed while the rest downloads
//   IFC schema code    -> (if the first file's schema is known) likewise
//   wasm               -> the IFC conversion starts the moment it lands, and
//                         needs only the three files above
//   fragments worker   -> needed only once the conversion has produced
//                         something, so it downloads during the conversion
//
// `engineImport` is the dynamic import that fetches the engine chunk;
// `startSchema`, if given, starts the import of the schema chunk. Returns a
// promise that resolves once all of it has been downloaded.
export function startEngineDownloads({ engineImport, startSchema, wasmUrl, workerUrl }) {
  return (async () => {
    await Promise.race([downloaded(/\/ifc-engine-[^/]*\.js(\?|$)/), settled(engineImport)]);
    if (startSchema) {
      await Promise.race([downloaded(/\/_virtual_web-ifc-schema-[^/]*\.js(\?|$)/), settled(startSchema())]);
    }
    await preload(wasmUrl);
    await preload(workerUrl);
  })();
}

const settled = (promise) => Promise.resolve(promise).then(() => {}, () => {});

// Resolves when the browser has finished downloading a file whose URL matches
// (before it has finished parsing it), which is when the link is free for the
// next file. Never resolves if there is no such file (the dev server); callers
// race it against the import settling.
function downloaded(pattern) {
  const matches = (entry) => pattern.test(entry.name);
  return new Promise((resolve) => {
    if (typeof PerformanceObserver === 'undefined') return;
    if (performance.getEntriesByType('resource').some(matches)) return resolve();
    const observer = new PerformanceObserver((list) => {
      if (list.getEntries().some(matches)) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe({ type: 'resource', buffered: true });
  });
}

// Resolves when the preload has finished (or failed: the real request will
// then simply happen later, on demand).
function preload(href) {
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'fetch';
    link.crossOrigin = '';
    link.href = href;
    link.onload = link.onerror = () => resolve();
    document.head.append(link);
  });
}
