-- Extend search_events to ALSO match the top pick's outcome_label.
-- Previously the deployed function only matched event titles via FTS, so
-- searches like "France" couldn't find the World Cup event (France isn't
-- in the title).
--
-- Signature unchanged: keeps resolved_at via event_resolutions LEFT JOIN,
-- keeps FTS-based title matching with ts_rank ordering, keeps
-- v_predictions_public for the predictions join. Adds ILIKE on
-- outcome_label as an OR condition, plus a defensive moderation filter
-- and empty-query guard.

create or replace function public.search_events(
  _q text,
  _limit int default 30
)
returns table (
  event_id        uuid,
  domain          text,
  slug            text,
  title           text,
  status          text,
  starts_at       timestamptz,
  resolved_at     timestamptz,
  top_pick_label  text,
  top_pick_pct    numeric,
  confidence      public.confidence_tier
)
language sql
stable
set search_path = public
as $$
  select
    e.id, e.domain, e.slug, e.title, e.status, e.starts_at,
    er.resolved_at,
    (p.ranked_outcomes->0->>'outcome_label')          as top_pick_label,
    ((p.ranked_outcomes->0->>'probability')::numeric) as top_pick_pct,
    p.confidence
  from public.events e
  left join public.v_predictions_public p
    on p.event_id = e.id and p.is_current = true
  left join public.event_resolutions er
    on er.event_id = e.id
  where e.moderation_status = 'approved'
    and coalesce(_q, '') <> ''
    and (
      e.title_search @@ plainto_tsquery('english', _q)
      or (p.ranked_outcomes->0->>'outcome_label') ilike '%' || _q || '%'
    )
  order by
    ts_rank(e.title_search, plainto_tsquery('english', _q)) desc,
    e.starts_at desc
  limit greatest(_limit, 1);
$$;
