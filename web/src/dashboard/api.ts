// Thin client for /api/v1/*: JSON in and out, cookie session, 401 sends the user to sign in,
// any other error surfaces as a toast (unless the caller passes quiet).
import type { ChatEvent } from "./types.js";
import { toast } from "./ui.js";

/** This page's build (web/build.ts BUILD_ID), sent with every call; the server answers with its own. */
declare const __PAYLORYA_BUILD__: string;
const BUILD_HEADER = "x-paylorya-build";

let updateShown = false;
/** A deploy happened while this page was open: offer a reload once. */
function noticeBuild(serverBuild: string | null): void {
  if (!serverBuild || serverBuild === __PAYLORYA_BUILD__ || updateShown) return;
  updateShown = true;
  const bar = document.createElement("div");
  bar.className = "update-bar";
  bar.setAttribute("role", "alert");
  bar.innerHTML = `<span>PayLorya AI was updated. Reload to use the new version.</span><button type="button" class="btn primary xs">Reload</button>`;
  bar.querySelector("button")!.addEventListener("click", () => location.reload());
  document.body.append(bar);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function toLogin(): never {
  const next = location.pathname + location.search;
  location.href = `/login?next=${encodeURIComponent(next)}`;
  throw new ApiError("Signed out", 401);
}

interface Options {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  quiet?: boolean;
  signal?: AbortSignal;
}

async function errorFrom(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: unknown };
    if (typeof data?.error === "string" && data.error) return data.error;
  } catch {
    // not JSON
  }
  return `Request failed (${res.status})`;
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        [BUILD_HEADER]: __PAYLORYA_BUILD__,
        ...(opts.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    const msg = "Network error. Check your connection and try again.";
    if (!opts.quiet) toast(msg, "error");
    throw new ApiError(msg, 0);
  }
  noticeBuild(res.headers.get(BUILD_HEADER));
  if (res.status === 401) toLogin();
  if (!res.ok) {
    const msg = await errorFrom(res);
    if (!opts.quiet) toast(msg, "error");
    throw new ApiError(msg, res.status);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const get = <T>(path: string, quiet = false) => api<T>(path, { quiet });
export const post = <T>(path: string, body: unknown = {}) => api<T>(path, { method: "POST", body });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body });
export const del = (path: string) => api<unknown>(path, { method: "DELETE" });

/** POST with upload progress (XHR: fetch has no upload progress events). */
export function postWithProgress<T>(path: string, body: unknown, onProgress: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.withCredentials = true;
    xhr.setRequestHeader("content-type", "application/json");
    xhr.setRequestHeader("accept", "application/json");
    xhr.setRequestHeader(BUILD_HEADER, __PAYLORYA_BUILD__);
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new ApiError("Network error during upload.", 0));
    xhr.onload = () => {
      noticeBuild(xhr.getResponseHeader(BUILD_HEADER));
      if (xhr.status === 401) {
        try {
          toLogin();
        } catch (err) {
          reject(err);
        }
        return;
      }
      let data: unknown;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        data = undefined;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const msg = (data as { error?: string })?.error || `Upload failed (${xhr.status})`;
        reject(new ApiError(msg, xhr.status));
        return;
      }
      resolve(data as T);
    };
    xhr.send(JSON.stringify(body));
  });
}

/** POSTs and reads a text/event-stream response, calling onEvent for every SSE event. */
export async function stream(path: string, body: unknown, onEvent: (e: ChatEvent) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "text/event-stream", [BUILD_HEADER]: __PAYLORYA_BUILD__ },
    body: JSON.stringify(body),
    signal,
  });
  noticeBuild(res.headers.get(BUILD_HEADER));
  if (res.status === 401) toLogin();
  if (!res.ok || !res.body) throw new ApiError(await errorFrom(res), res.status);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (block: string) => {
    let name = "";
    const data: string[] = [];
    for (const raw of block.split("\n")) {
      const line = raw.replace(/\r$/, "");
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (!data.length) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data.join("\n")) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!parsed.type && name) parsed.type = name;
    onEvent(parsed as unknown as ChatEvent);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, "");
      flush(block);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) flush(buffer);
}
