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
