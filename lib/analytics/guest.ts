export const GUEST_BROWSER_ID_KEY = "jimmy-gm:anonymous-browser:v1";
export const GUEST_ANALYTICS_SESSION_KEY = "jimmy-gm:anonymous-session:v1";

export function validAnonymousId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function getOrCreateAnonymousId(storage: Pick<Storage, "getItem" | "setItem">, key: string, create = () => crypto.randomUUID()) {
  const current = storage.getItem(key);
  if (validAnonymousId(current)) return current;
  const next = create();
  storage.setItem(key, next);
  return next;
}
