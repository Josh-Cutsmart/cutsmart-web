type RetryOptions<T> = {
  attempts?: number;
  delayMs?: number;
  shouldRetryResult?: (value: T, attempt: number) => boolean;
};

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, Math.max(0, ms));
  });
}

export async function retryAsync<T>(
  task: () => Promise<T>,
  options?: RetryOptions<T>,
): Promise<T> {
  const attempts = Math.max(1, Number(options?.attempts ?? 2));
  const delayMs = Math.max(0, Number(options?.delayMs ?? 250));
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const value = await task();
      const shouldRetry = options?.shouldRetryResult?.(value, attempt) ?? false;
      if (!shouldRetry || attempt >= attempts) {
        return value;
      }
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) {
        throw error;
      }
    }
    await wait(delayMs);
  }

  if (lastError) {
    throw lastError;
  }

  return await task();
}

// retryAsync only re-tries on a REJECTION — it can't do anything about a promise that never
// settles at all (neither resolves nor rejects), which does happen in the wild: e.g. a Firestore
// read left in-flight when a mobile browser tab gets backgrounded can stall indefinitely and only
// resume once the tab is foregrounded again, if ever. Racing the real work against a timer turns
// that "hangs forever" case into an ordinary rejection too, so a caller's normal catch/finally
// (loading-state cleanup, fallback UI, etc.) still runs instead of leaving a loading screen stuck
// with no way to recover short of a full remount (e.g. navigating away and back).
export function withTimeout<T>(promise: Promise<T>, ms: number, message = "Operation timed out"): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      window.setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

type HedgedOptions<T> = {
  // Total attempts allowed (default 2).
  attempts?: number;
  // If an attempt hasn't answered by then, another is started alongside it (default 6s).
  hedgeAfterMs?: number;
  // Wait before retrying after an attempt fails (default 250ms).
  delayMs?: number;
  // Gives up after this long in total (default 20s), so a call that never answers can't hang a screen.
  timeoutMs?: number;
  message?: string;
  // Like retryAsync's: a result that should get one more try (e.g. an empty list on the first go).
  shouldRetryResult?: (value: T, attempt: number) => boolean;
};

// For loads that are sometimes just slow. retryAsync(withTimeout(...)) threw a slow attempt away at
// its deadline and started again from scratch — so a load needing 7s against a 6s deadline took 13s,
// or failed. Here a slow attempt keeps going: after `hedgeAfterMs` a second one starts alongside it,
// and whichever answers first wins. A failed attempt is retried straight away.
export function hedgedAsync<T>(task: () => Promise<T>, options?: HedgedOptions<T>): Promise<T> {
  const attempts = Math.max(1, Number(options?.attempts ?? 2));
  const hedgeAfterMs = Math.max(0, Number(options?.hedgeAfterMs ?? 6000));
  const delayMs = Math.max(0, Number(options?.delayMs ?? 250));
  const timeoutMs = Math.max(0, Number(options?.timeoutMs ?? 20000));

  return new Promise<T>((resolve, reject) => {
    let started = 0;
    let finishedAttempts = 0;
    let done = false;
    let lastError: unknown = null;
    let fallback: { value: T } | null = null;
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
      return id;
    };
    const finish = (settle: () => void) => {
      if (done) return;
      done = true;
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
      settle();
    };
    // An attempt ended without a usable answer: try again if every attempt so far has ended, or give up.
    const onAttemptEnded = () => {
      finishedAttempts += 1;
      if (done) return;
      if (finishedAttempts >= attempts) {
        finish(() => (fallback ? resolve(fallback.value) : reject(lastError)));
        return;
      }
      if (finishedAttempts === started) later(start, delayMs);
    };
    const start = () => {
      if (done || started >= attempts) return;
      started += 1;
      const attempt = started;
      const hedgeTimer = started < attempts ? later(start, hedgeAfterMs) : null;
      const stopHedge = () => {
        if (hedgeTimer === null) return;
        window.clearTimeout(hedgeTimer);
        timers.delete(hedgeTimer);
      };
      let pending: Promise<T>;
      try {
        pending = task();
      } catch (error) {
        pending = Promise.reject(error);
      }
      pending.then(
        (value) => {
          if (done) return;
          if (attempt < attempts && options?.shouldRetryResult?.(value, attempt)) {
            stopHedge();
            fallback = { value };
            onAttemptEnded();
            return;
          }
          finish(() => resolve(value));
        },
        (error) => {
          stopHedge();
          lastError = error;
          onAttemptEnded();
        },
      );
    };
    later(() => {
      finish(() => (fallback ? resolve(fallback.value) : reject(new Error(options?.message ?? "Operation timed out"))));
    }, timeoutMs);
    start();
  });
}
