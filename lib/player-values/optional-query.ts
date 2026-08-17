export interface OptionalQueryOptions<T> {
  label: string;
  fallback: T;
  query: (signal: AbortSignal) => Promise<T>;
  timeoutMs?: number;
  retryDelayMs?: number;
  metadata?: Record<string, string | number | null | undefined>;
}

export function analyticsErrorDetails(error: unknown) {
  if (error instanceof Error)
    return { errorType: error.name, errorMessage: error.message };
  return { errorType: typeof error, errorMessage: String(error) };
}

export function isTransientAnalyticsError(error: unknown) {
  const message = analyticsErrorDetails(error).errorMessage;
  return /fetch failed|network|timeout|timed out|abort|econnreset|connection|\b408\b|\b429\b|\b500\b|\b502\b|\b503\b|\b504\b/i.test(
    message,
  );
}

/** Runs optional analytics with a short timeout, one transient retry, and a typed fallback. */
export async function optionalQuery<T>({
  label,
  fallback,
  query,
  timeoutMs = 4_000,
  retryDelayMs = 150,
  metadata = {},
}: OptionalQueryOptions<T>): Promise<T> {
  let failure: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await query(AbortSignal.timeout(timeoutMs));
    } catch (error) {
      failure = error;
      if (attempt === 1 && isTransientAnalyticsError(error)) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }
      break;
    }
  }
  const details = {
    ...metadata,
    ...analyticsErrorDetails(failure),
  };
  console.warn(
    `${label}; continuing with neutral analytics context. ${JSON.stringify(details)}`,
  );
  return fallback;
}
