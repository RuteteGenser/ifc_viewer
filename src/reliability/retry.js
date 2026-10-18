// Automatic retry with a short backoff. A load that fails for a momentary
// reason (a dropped connection, a 503, a worker that died) is simply done
// again; the user sees progress text, never a button.

export const BACKOFF_MS = [0, 1000, 3000]; // three attempts

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const defaultSleep = sleep;

/**
 * Runs `task(attempt)` (attempt counts from 1) until it succeeds, `shouldRetry`
 * says no, or the delays run out. The last error is thrown.
 * @param {(attempt:number)=>Promise<any>} task
 * @param {{ delays?:number[], shouldRetry?:(err:any, attempt:number)=>boolean|Promise<boolean>,
 *           onRetry?:(err:any, nextAttempt:number, total:number)=>void,
 *           sleep?:(ms:number)=>Promise<void>, wait?:(err:any)=>number }} opts
 *   wait(err): extra minimum delay for this error (e.g. a Retry-After header)
 */
export async function withBackoff(task, { delays = BACKOFF_MS, shouldRetry = () => true, onRetry, sleep = defaultSleep, wait } = {}) {
  const total = delays.length;
  for (let attempt = 1; ; attempt++) {
    try {
      return await task(attempt);
    } catch (err) {
      if (attempt >= total || !(await shouldRetry(err, attempt))) throw err;
      onRetry?.(err, attempt + 1, total);
      await sleep(Math.max(delays[attempt], wait?.(err) ?? 0));
    }
  }
}

export const attemptText = (verb, attempt, total) => `${verb} again, attempt ${attempt} of ${total}`;

// How long an import may go without a sign of life (progress, a message)
// before it is restarted in a fresh worker: more for bigger files.
export const stallLimitMs = (bytes) => Math.min(60_000 + (bytes / 1048576) * 3000, 300_000);
