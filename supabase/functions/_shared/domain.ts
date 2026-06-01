// Domain types shared across edge functions.
// A "domain" is a vertical (e.g. football, oscars, elections) with its own
// event-discovery adapter, prompt template, and scoring nuances.

export type DomainId = string;

export type EventMode = "prediction" | "odds" | "both";
export type EventStatus = "scheduled" | "live" | "resolved" | "cancelled";
export type EventSource = "discovered" | "user_submitted";
export type ModerationStatus = "pending" | "approved" | "rejected";

export interface DomainEvent {
  id: string;
  domain: DomainId;
  external_id: string | null;
  slug: string;
  title: string;
  description: string | null;
  question: string;
  starts_at: string;
  resolves_at: string;
  status: EventStatus;
  mode: EventMode;
  source: EventSource;
  moderation_status: ModerationStatus;
  metadata: Record<string, unknown> | null;
}

export interface EventOutcome {
  id: string;
  event_id: string;
  external_id: string | null;
  label: string;
  metadata: Record<string, unknown> | null;
}

export interface DiscoveredEvent {
  external_id: string;
  slug: string;
  title: string;
  description?: string;
  question: string;
  starts_at: string;
  resolves_at: string;
  mode: EventMode;
  outcomes: Array<{ external_id?: string; label: string; metadata?: Record<string, unknown> }>;
  metadata?: Record<string, unknown>;
}

export interface DomainAdapter {
  id: DomainId;
  displayName: string;
  /** Discover upcoming events for this domain. Idempotent on (domain, external_id). */
  discover(now: Date): Promise<DiscoveredEvent[]>;
  /** Resolve a finished event into final rankings. Return null if not yet resolvable. */
  resolve(event: DomainEvent, outcomes: EventOutcome[]): Promise<ResolutionResult | null>;
  /** Build the per-domain research prompt for the AI consensus engine.
   * `mode` selects "prediction" framing (default) or "odds" framing (only
   * supported by adapters whose events have mode === "odds" | "both"). */
  buildPrompt(event: DomainEvent, outcomes: EventOutcome[], mode?: "prediction" | "odds"): string;
}

export interface ResolutionResult {
  outcome_rankings: Array<{ outcome_id: string; rank: number }>;
  source: string;
  resolution_context?: string;
}
