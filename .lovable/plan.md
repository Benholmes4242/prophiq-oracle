# Feed-path unification: one sport grounding module

Goal: a discovered (cron) event and a typed (submit-question) event get the **same** feed-backed structured grounding from **one** module. Today the cron uses the old context fetchers; submit-question uses the new confirm functions. Unify on the confirm functions.

## Files

**New**
- `supabase/functions/_shared/dataSources/sportGrounding.ts`

**Edit**
- `supabase/functions/submit-question/index.ts` (sport branches call `groundSportEvent`)
- `supabase/functions/_shared/domains/sport.ts` (`gatherStructuredSources` calls `groundSportEvent` for football/golf/racing; theSportsDB stays as fallback for non-confirm sports / props)
- `supabase/functions/generate-prediction/index.ts` (drop the `extractRacingRunners` outcome-rewrite block; outcomes now come from grounding)

**Untouched**
- `resolver.ts` (submit-question only)
- `runConsensus`, calibration, trust tiers, placeholder gate
- Golf/racing confirm internals (`findGolfMatches`, `fetchRacePicker`)
- `theSportsDB` for non-confirm sports

## Shape

```ts
// sportGrounding.ts
export type SportKind = "football" | "golf" | "horse_racing" | "other";

export interface SportGroundingResult {
  feed_backed: boolean;
  outcomes?: string[];                 // when the confirm produced a real field
  sources: StructuredDataSource[];     // 0..N items shaped like sport.ts's existing sources
  metadata?: Record<string, unknown>;  // e.g. { football_confirm: {...} }
  picker?: unknown;                    // optional multi-candidate payload (typed flow only)
}

export async function groundSportEvent(input: {
  sport: SportKind;
  canonicalEvent: string;
  approxDate: string | null;
  competitors: string[] | null;
}): Promise<SportGroundingResult>;
```

Routing inside:
- `football` → `classifyFootballEvent` → `confirmFootballMatch` | `confirmFootballLeague`
- `golf` → `findGolfMatches`
- `horse_racing` → `fetchRacePicker`
- else → `{ feed_backed: false, sources: [] }`

## Migration order (each step verified before the next)

1. **Add** `sportGrounding.ts` wrapping the three existing confirm fns. No call sites change.
2. **submit-question**: replace the three inline sport branches' confirm calls with `groundSportEvent`. Behaviour-preserving — same confirm fns underneath. Picker payloads still surface via `picker` for the existing UI flow.
3. **cron / sport.ts**: in `gatherStructuredSources`, detect sport via existing `isFootballEvent` / `isHorseRacingEvent` / `isGolfEvent`, derive `canonicalEvent` from `event.title`, `approxDate` from `event.starts_at`, then call `groundSportEvent`. Emit the returned `sources` directly, merge `metadata` (e.g. `football_confirm`) onto the source payload as today, and stop calling `fetchFootballDataContext` / `fetchRacingContext` / `fetchGolfContext`. Keep `theSportsDB` for non-confirm sports / props.
4. **generate-prediction**: when the cron's grounding returned `outcomes`, persist them to `event_outcomes` once (replacing the current `extractRacingRunners` block; same bucket-after-N logic moves into `sportGrounding.ts` or stays as a thin caller). Remove `extractRacingRunners` import + block.

## Acceptance

1. Same football match discovered vs typed → identical `[Home, Draw, Away]` outcomes and `feed_backed=true` (coverage permitting).
2. Discovered golf tournament / racing card → real-field outcomes from the confirm path, same as typed.
3. Out-of-coverage events → `research_grounded` on **both** paths consistently.
4. Tennis / rugby / non-confirm sports → still served via theSportsDB + research, `domain=sport`.
5. No regression on calibration, runConsensus, placeholder gate, or typed-question feed_backed.
6. Only one place generates sport grounding. Old football/golf/racing context fetchers and the duplicate racing rewrite are gone.
7. `tsc` clean.

## Risks / call-outs

- The cron currently *reads* `event.metadata.football_confirm` left by submit-question. After step 3 the cron *generates* its own confirm — but I will keep the read-path as a fast-skip when a fresh-enough confirm is already on metadata, to avoid double feed hits on the immediate post-submit cron pass.
- `fetchFootballDataContext` / `fetchGolfContext` / `fetchRacingContext` modules stay on disk (still referenced by tests and possibly other places) but become unused by the sport adapter. I will leave the files; brief says "supersede", not delete.
- Racing/golf outcome rewrite logic moves out of `generate-prediction` into the grounding module so both paths share it. Submit-question already writes outcomes from the confirm; the cron will now do the same via the grounding result instead of a post-hoc rewrite.

Confirm and I'll implement in the migration order above.
