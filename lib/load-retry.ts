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
