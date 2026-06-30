export type ApiMethod = "GET" | "POST" | "PATCH" | "DELETE";

// Release builds default to production; dev (expo start) defaults to localhost.
// EXPO_PUBLIC_API_BASE_URL overrides both (useful for staging).
declare const __DEV__: boolean;
const FALLBACK = typeof __DEV__ !== "undefined" && __DEV__
  ? "http://localhost:8080"
  : "https://app.aliasnest.com";
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || FALLBACK;

export async function apiRequest<T>(
  path: string,
  method: ApiMethod,
  token?: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let detail = "Request failed";
    try {
      const json = await res.json();
      detail = json?.detail || detail;
    } catch {
      // no-op
    }
    throw new Error(detail);
  }

  return (await res.json()) as T;
}

// Multipart upload for endpoints that accept file attachments.
// Content-Type is intentionally omitted so fetch sets the multipart boundary.
export async function apiUpload<T>(
  path: string,
  form: FormData,
  token?: string,
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: form,
  });

  if (!res.ok) {
    let detail = "Request failed";
    try {
      const json = await res.json();
      detail = json?.detail || detail;
    } catch {
      // no-op
    }
    throw new Error(detail);
  }

  return (await res.json()) as T;
}
