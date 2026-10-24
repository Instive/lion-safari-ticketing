/** Keep the deadline active until the response body is consumed, not just headers. */
export async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<{ response: Response; body: T }> {
  const controller = new AbortController();
  const abort = () => controller.abort(init.signal?.reason);
  const timer = setTimeout(() => controller.abort(new Error("Request timed out")), timeoutMs);
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    // Error bodies need not be JSON (e.g. a proxy timeout). Release their stream.
    if (!response.ok) {
      await response.body?.cancel();
      return { response, body: undefined as T };
    }
    return { response, body: await response.json() as T };
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}
