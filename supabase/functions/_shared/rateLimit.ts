// Rate-limit + audit ledger for submit-question and chat-message. All writes
// go through this module so the audit trail stays consistent.

export type Endpoint = "submit_question" | "chat_message";
export type Outcome = "accepted" | "rejected_moderation" | "rejected_rate_limit" | "failed";

export interface RateLimitConfig {
  endpoint: Endpoint;
  fingerprint: string;
  ipHash: string;
  /** Question/content for the audit row. Truncated to 500 chars. */
  question: string;
}

export interface RateLimitWindow {
  endpoint: Endpoint;
  /** Max accepted submissions per fingerprint inside windowMs. */
  perFingerprint: number;
  /** Max accepted submissions per ip_hash inside windowMs. */
  perIp: number;
  /** Sliding window in ms. */
  windowMs: number;
}

export const DEFAULT_WINDOWS: Record<Endpoint, RateLimitWindow> = {
  submit_question: { endpoint: "submit_question", perFingerprint: 3, perIp: 10, windowMs: 24 * 60 * 60 * 1000 }, // 24h
  chat_message:    { endpoint: "chat_message",    perFingerprint: 30, perIp: 100, windowMs: 60 * 60 * 1000 },    // 1h
};

export interface RateLimitChecker {
  countAccepted(opts: { fingerprint?: string; ipHash?: string; endpoint: Endpoint; sinceIso: string }): Promise<number>;
  record(row: { fingerprint: string; ip_hash: string; endpoint: Endpoint; question: string; outcome: Outcome }): Promise<void>;
}

export interface RateLimitDecision {
  ok: boolean;
  reason?: "fingerprint_quota" | "ip_quota";
  fingerprintCount: number;
  ipCount: number;
  window: RateLimitWindow;
}

/** Pure decision logic — given counts, decide whether to accept. Testable. */
export function decide(opts: { fingerprintCount: number; ipCount: number; window: RateLimitWindow }): RateLimitDecision {
  const { fingerprintCount, ipCount, window } = opts;
  if (fingerprintCount >= window.perFingerprint) {
    return { ok: false, reason: "fingerprint_quota", fingerprintCount, ipCount, window };
  }
  if (ipCount >= window.perIp) {
    return { ok: false, reason: "ip_quota", fingerprintCount, ipCount, window };
  }
  return { ok: true, fingerprintCount, ipCount, window };
}

/** Check + return a decision. Caller is responsible for `record()` afterwards. */
export async function check(checker: RateLimitChecker, cfg: RateLimitConfig, window?: RateLimitWindow): Promise<RateLimitDecision> {
  const w = window ?? DEFAULT_WINDOWS[cfg.endpoint];
  const sinceIso = new Date(Date.now() - w.windowMs).toISOString();
  const [fpCount, ipCount] = await Promise.all([
    checker.countAccepted({ fingerprint: cfg.fingerprint, endpoint: cfg.endpoint, sinceIso }),
    checker.countAccepted({ ipHash: cfg.ipHash, endpoint: cfg.endpoint, sinceIso }),
  ]);
  return decide({ fingerprintCount: fpCount, ipCount, window: w });
}

/** Truncate question for audit storage (column is text; cap defensively). */
export function truncateQuestion(q: string, max = 500): string {
  if (!q) return "";
  return q.length > max ? `${q.slice(0, max - 1)}…` : q;
}
