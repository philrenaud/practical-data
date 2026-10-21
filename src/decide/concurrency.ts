/**
 * Small promise helpers for the decision layer: an abortable sleep and a
 * bounded, fail-fast map.
 */

/** Resolves after `ms`. Rejects with the signal's reason if `signal` aborts first. */
export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/**
 * Calls `f` on each item, with at most `limit` calls running at once, and
 * returns the results in item order. On the first failure, it aborts the
 * signal that the running calls received, starts no more calls, and rejects
 * with that failure. Later failures are ignored. If `signal` aborts, the
 * calls' signal aborts too.
 */
export const mapConcurrent = <A, B>(
  items: readonly A[],
  limit: number,
  f: (item: A, signal: AbortSignal) => Promise<B>,
  signal?: AbortSignal,
): Promise<B[]> =>
  new Promise((resolve, reject) => {
    const results: B[] = Array.from({ length: items.length });
    if (items.length === 0) return resolve(results);
    const controller = new AbortController();
    const inner = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal]);
    let next = 0;
    let finished = 0;
    let failed = false;
    const start = () => {
      if (failed || next >= items.length) return;
      const i = next++;
      Promise.resolve()
        .then(() => f(items[i]!, inner))
        .then(
          (result) => {
            results[i] = result;
            finished++;
            if (finished === items.length) resolve(results);
            else start();
          },
          (error: unknown) => {
            if (failed) return;
            failed = true;
            controller.abort(error);
            reject(error);
          },
        );
    };
    for (let k = 0; k < Math.min(limit, items.length); k++) start();
  });
