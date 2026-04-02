export type ApiMethod = "GET" | "POST" | "PATCH" | "DELETE";

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || "http://localhost:8080";

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
