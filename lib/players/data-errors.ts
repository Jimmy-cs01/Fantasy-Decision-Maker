export type PublicPlayerDataErrorKind =
  | "missing_schema"
  | "permission_denied"
  | "backend_unavailable"
  | "query_failed";

export class PublicPlayerDataError extends Error {
  constructor(
    public readonly kind: PublicPlayerDataErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "PublicPlayerDataError";
  }
}

export function classifyPublicDataError(error: unknown): PublicPlayerDataErrorKind {
  const candidate = error as { code?: string; message?: string; cause?: unknown } | null;
  const code = candidate?.code ?? "";
  const message = candidate?.message?.toLowerCase() ?? "";
  if (["42P01", "PGRST205"].includes(code) || message.includes("does not exist") || message.includes("schema cache")) return "missing_schema";
  if (code === "42501" || message.includes("permission denied") || message.includes("row-level security")) return "permission_denied";
  if (error instanceof TypeError || message.includes("fetch failed") || message.includes("network") || candidate?.cause) return "backend_unavailable";
  return "query_failed";
}

export function publicPlayerDataMessage(error: unknown) {
  const kind = error instanceof PublicPlayerDataError ? error.kind : classifyPublicDataError(error);
  switch (kind) {
    case "missing_schema":
      return "Player statistics are not installed on this environment yet.";
    case "permission_denied":
      return "Public player statistics are temporarily unavailable because read access is not configured.";
    case "backend_unavailable":
      return "Player statistics could not reach the data service. Please try again shortly.";
    default:
      return "Player statistics could not be loaded. Please try again.";
  }
}

export function publicDataError(operation: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return new PublicPlayerDataError(
    classifyPublicDataError(error),
    `${operation}: ${message}`,
    { cause: error },
  );
}
