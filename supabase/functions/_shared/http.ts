// HTTP helpers used by edge functions: CORS, JSON responses, SSE streaming,
// fingerprint/IP extraction.

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return null;
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", ...(init.headers as Record<string, string> | undefined) },
  });
}

export function errorResponse(message: string, status = 400, extra?: Record<string, unknown>): Response {
  return jsonResponse({ error: message, ...(extra ?? {}) }, { status });
}

/** Extract a stable browser fingerprint from request body or header. */
export function getFingerprint(body: { fingerprint?: unknown } | null, req: Request): string | null {
  const fromBody = body && typeof body.fingerprint === "string" && body.fingerprint.trim().length > 0 ? body.fingerprint.trim() : null;
  if (fromBody) return fromBody.slice(0, 128);
  const fromHeader = req.headers.get("x-fingerprint");
  return fromHeader ? fromHeader.slice(0, 128) : null;
}

/** Best-effort caller IP from edge proxy headers. */
export function getClientIp(req: Request): string {
  const candidates = [
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    req.headers.get("cf-connecting-ip"),
    req.headers.get("x-real-ip"),
  ].filter(Boolean) as string[];
  return candidates[0] ?? "unknown";
}

/** Hash an IP with IP_HASH_SALT. Never log the raw IP. */
export async function hashIp(ip: string): Promise<string> {
  const salt = readEnv("IP_HASH_SALT") ?? "no-salt-configured";
  const data = new TextEncoder().encode(`${salt}|${ip}`);
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;
  if (subtle) {
    const buf = await subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // deno-lint-ignore no-explicit-any
  const nc = await import("node:crypto" as any);
  return nc.createHash("sha256").update(`${salt}|${ip}`).digest("hex");
}

function readEnv(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  if (deno) return deno.env.get(name);
  const proc = (globalThis as { process?: { env: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

// ============================================================
// Server-Sent Events helpers (used by submit-question)
// ============================================================

export interface SseStage<T = unknown> {
  stage: string;
  status: "start" | "progress" | "done" | "error";
  data?: T;
  message?: string;
}

export class SseStream {
  private encoder = new TextEncoder();
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  readonly stream: ReadableStream<Uint8Array>;

  constructor() {
    // deno-lint-ignore no-this-alias
    const self = this;
    this.stream = new ReadableStream({
      start(controller) { self.controller = controller; },
      cancel() { self.controller = null; },
    });
  }

  send(event: SseStage): void {
    if (!this.controller) return;
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    this.controller.enqueue(this.encoder.encode(payload));
  }

  close(): void {
    try { this.controller?.close(); } catch { /* already closed */ }
    this.controller = null;
  }

  response(): Response {
    return new Response(this.stream, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }
}
