// Backend client: JSON over /api (proxied by Vite to FastAPI) and a WebSocket event stream.

export class ApiError extends Error {}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j);
    } catch {
      /* plain text */
    }
    throw new ApiError(msg || `${res.status} ${res.statusText}`);
  }
  const ct = res.headers.get("content-type") || "";
  return (ct.includes("application/json") ? JSON.parse(text) : text) as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>("GET", p),
  post: <T = any>(p: string, b: unknown = {}) => request<T>("POST", p, b),
  put: <T = any>(p: string, b: unknown) => request<T>("PUT", p, b),
  patch: <T = any>(p: string, b: unknown) => request<T>("PATCH", p, b),
  del: <T = any>(p: string) => request<T>("DELETE", p),
};

type Handler = (payload: any) => void;
const handlers = new Map<string, Set<Handler>>();
let ws: WebSocket | null = null;
let wsState: "connecting" | "open" | "closed" = "closed";
const stateListeners = new Set<(s: string) => void>();

export function on(event: string, fn: Handler): () => void {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event)!.add(fn);
  return () => handlers.get(event)?.delete(fn);
}

export function onConnection(fn: (s: string) => void): () => void {
  stateListeners.add(fn);
  fn(wsState);
  return () => stateListeners.delete(fn);
}

function setState(s: typeof wsState) {
  wsState = s;
  stateListeners.forEach((f) => f(s));
}

function dispatch(event: string, payload: any) {
  handlers.get(event)?.forEach((f) => {
    try {
      f(payload);
    } catch (e) {
      console.error(e);
    }
  });
  handlers.get("*")?.forEach((f) => f({ event, payload }));
}

export function connectEvents() {
  if (ws && wsState !== "closed") return;
  setState("connecting");
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/api/events`);
  ws.onopen = () => setState("open");
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.event === "batch") msg.payload.forEach((m: any) => dispatch(m.event, m.payload));
    else dispatch(msg.event, msg.payload);
  };
  ws.onclose = () => {
    setState("closed");
    ws = null;
    setTimeout(connectEvents, 1500);
  };
}
