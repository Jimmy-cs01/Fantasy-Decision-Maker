export const RECONCILIATION_QUERY_BATCH_SIZE = 75;
export const RECONCILIATION_QUERY_TIMEOUT_MS = 12_000;
export const RECONCILIATION_RETRY_DELAYS_MS = [250, 750] as const;

export interface RemoteQueryError {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
  status?: number;
  cause?: unknown;
}

export interface RemoteQueryResult<T> {
  data: T[] | null;
  error: RemoteQueryError | null;
}

interface QueryAttempt<T> {
  data: T[];
  error: RemoteQueryError | null;
  attempts: number;
}

export interface BatchedQueryResult<T> {
  data: T[];
  queryFailures: number;
  requests: number;
}

export interface ReconciliationRequiredInputs {
  canonicalPlayersComplete: boolean;
  updatesComplete: boolean;
  depthQueryFailures: number;
  historyQueryFailures: number;
  scheduleQueryFailed: boolean;
  scheduleIsEmpty: boolean;
  vegasGamesQueryFailed: boolean;
  propsQueryFailures: number;
}

export function countRequiredInputFailures(input: ReconciliationRequiredInputs) {
  return [
    !input.canonicalPlayersComplete,
    !input.updatesComplete,
    input.depthQueryFailures > 0,
    input.historyQueryFailures > 0,
    input.scheduleQueryFailed || input.scheduleIsEmpty,
    input.vegasGamesQueryFailed,
    input.propsQueryFailures > 0,
  ].filter(Boolean).length;
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause == null ? "" : ` ${errorText(error.cause)}`;
    return `${error.name}: ${error.message}${cause}`;
  }
  if (typeof error === "object" && error !== null) {
    const value = error as RemoteQueryError;
    return [value.message, value.details, value.hint, value.code, value.status, value.cause && errorText(value.cause)]
      .filter(Boolean)
      .join(" ");
  }
  return String(error ?? "Unknown remote query error");
}

export function describeRemoteError(error: unknown) {
  return errorText(error).replace(/\s+/g, " ").trim();
}

export function isTransientRemoteError(error: unknown) {
  const description = describeRemoteError(error).toUpperCase();
  if (/UND_ERR_HEADERS_OVERFLOW|PGRST|42P\d\d|22P\d\d|235\d\d/.test(description)) return false;
  return /FETCH FAILED|ECONNRESET|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|TLS|ABORT|TIMEOUT|\b429\b|\b5\d\d\b/.test(description);
}

export async function runRemoteQuery<T>({
  label,
  query,
  timeoutMs = RECONCILIATION_QUERY_TIMEOUT_MS,
  retryDelaysMs = RECONCILIATION_RETRY_DELAYS_MS,
  wait = sleep,
}: {
  label: string;
  query: (signal: AbortSignal) => PromiseLike<RemoteQueryResult<T>>;
  timeoutMs?: number;
  retryDelaysMs?: readonly number[];
  wait?: (milliseconds: number) => Promise<unknown>;
}): Promise<QueryAttempt<T>> {
  const maximumAttempts = retryDelaysMs.length + 1;
  let lastError: RemoteQueryError | null = null;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const result = await query(AbortSignal.timeout(timeoutMs));
      if (!result.error) return { data: result.data ?? [], error: null, attempts: attempt };
      lastError = result.error;
    } catch (error) {
      lastError = error instanceof Error
        ? { message: error.message, cause: error.cause }
        : { message: String(error) };
    }

    const transient = isTransientRemoteError(lastError);
    console.warn(
      `${label} attempt ${attempt}/${maximumAttempts} failed (${transient ? "transient" : "permanent"}): ${describeRemoteError(lastError)}`,
    );
    if (!transient || attempt === maximumAttempts) break;
    await wait(retryDelaysMs[attempt - 1]);
  }

  return { data: [], error: lastError, attempts: maximumAttempts };
}

export async function runBatchedRemoteQuery<T>({
  label,
  values,
  query,
  batchSize = RECONCILIATION_QUERY_BATCH_SIZE,
  timeoutMs = RECONCILIATION_QUERY_TIMEOUT_MS,
  retryDelaysMs = RECONCILIATION_RETRY_DELAYS_MS,
  wait,
}: {
  label: string;
  values: string[];
  query: (batch: string[], signal: AbortSignal) => PromiseLike<RemoteQueryResult<T>>;
  batchSize?: number;
  timeoutMs?: number;
  retryDelaysMs?: readonly number[];
  wait?: (milliseconds: number) => Promise<unknown>;
}): Promise<BatchedQueryResult<T>> {
  const uniqueValues = [...new Set(values)];
  const data: T[] = [];
  let queryFailures = 0;
  let requests = 0;

  for (let start = 0; start < uniqueValues.length; start += batchSize) {
    const batch = uniqueValues.slice(start, start + batchSize);
    requests += 1;
    const result = await runRemoteQuery({
      label: `${label} batch ${requests} (${batch.length} IDs)`,
      query: (signal) => query(batch, signal),
      timeoutMs,
      retryDelaysMs,
      wait,
    });
    if (result.error) queryFailures += 1;
    else data.push(...result.data);
  }

  return { data, queryFailures, requests };
}
