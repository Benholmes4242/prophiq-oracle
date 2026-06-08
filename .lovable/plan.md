
# Prophiq conversational rebuild — Step 1

You uploaded a 4-step rebuild brief. The brief itself says *do NOT big-bang it* and that **Step 1 alone kills the "couldn't categorise" / Scottish Open error** and most fallbacks. This plan ships Step 1 only. Steps 2–4 are queued and will follow once Step 1 is verified.

## Goal of Step 1

Eliminate every "we couldn't answer that / couldn't categorise / try a more specific public-event question" error for in-policy, future-resolvable questions. Uncertainty must always be routed to either:
- a research-grounded forecast (the floor), or
- an open conversational clarifying question.

Policy declines (unsafe / sexual / fraud / private individual / already resolved) remain the **only** hard stop.

## Changes

### 1. `supabase/functions/_shared/moderation.ts`

Split the moderation contract into **CLASSIFY + POLICY**:

- Extend `ModerationDecision` with:
  - `policy_breach: boolean` — the only field that can hard-stop.
  - `policy_reason: string | null` — kind, conversational decline text.
  - `confidence: "high" | "low"` — classifier's self-reported confidence.
- Rewrite `MODERATION_SYSTEM` + `buildModerationPrompt` so the model:
  - Returns `policy_breach=true` **only** for: unsafe/harmful, sexual, fraudulent/illegal, private (non-public) individual, or already-resolved.
  - Treats niche/specialist/regional/minor-tour real public events as **valid** (never reject for niche-ness).
  - Returns `confidence: "low"` when it cannot identify the event/intent — never reject for uncertainty.
  - Still returns best-guess `domain`, `normalized_question`, `outcomes`, dates.
- `coerceModerationResult` **fails open**: unparseable / empty model output → `decision: "accept"`, `confidence: "low"`, `policy_breach: false`. (Today it defaults to reject — this is the single biggest source of the Scottish Open–style errors.)
- `runModeration` catch block: on network/service failure, return a low-confidence accept with `policy_breach: false` instead of a reject.
- Keep `decision` field for back-compat but route on `policy_breach` + `confidence` going forward.

### 2. `supabase/functions/submit-question/index.ts` — MODERATION stage

Replace the current hard-reject branch:

- **If `mod.policy_breach`** → emit a single conversational SSE `clarification` of `type: "policy_decline"` (kind, plain-English message from `mod.policy_reason`), record `rejected_moderation`, close. This is the only terminal that is not a forecast or a clarification.
- **If `!policy_breach` and unknown `domainId`** → already emits a conversational clarification today; keep that path but no longer record it as `rejected_moderation` (use a neutral "clarification" outcome / search-log entry).
- **If `!policy_breach` and `confidence === "low"` and `domainId` known** → still proceed to the research-grounded forecast (the floor). Do not hard-stop.
- **Remove** the `mod.decision === "reject"` hard exit entirely (it now only fires on policy breach, handled above).
- Pre-filter regex stays as-is (it's already pure policy/safety).

### 3. Frontend (`src/components/site/AskInlinePanel.tsx` + `src/lib/forecast.ts`)

Minimal additions:
- Add `policy_decline` as a clarification `type` in `ClarificationPayload` (renders the message, no reply input, no suggestion chips — terminal, conversational).
- `forecast.ts` `normaliseClarification` handles the new type.
- No other UI changes — existing conversational clarification rendering covers everything else.

## Out of scope for Step 1 (queued for Steps 2–4)

- Generalised cross-domain clarification loop with structured hint bag (Step 2).
- Formal confidence routing helper + removing remaining hard-exit strings (Step 3).
- Folding the racing / golf / sport disambiguation into one unified loop (Step 4).

## Acceptance for Step 1

- "who wins the genesis scottish open" never returns a `Couldn't complete the forecast` error — it either forecasts or asks an open conversational question.
- Any obscure real public event with no feed → research-grounded forecast, never an error.
- Pre-existing flows untouched: racing picker, golf tour picker, conversational sport disambiguation, structured-resubmit canonicalisation all continue to work.
- Only a true policy breach produces a non-forecast, non-clarification terminal.

## Verification

- Manual sanity: send "who wins the genesis scottish open", "who wins the Memorial", and an obscure niche event through the preview's ask box; confirm no `pre_filter`/`moderation` `error` SSE for any of them.
- Confirm policy-breach phrasing (e.g. an unsafe prompt) still terminates conversationally.

Reply with **go** to ship Step 1, or tell me what to adjust.
