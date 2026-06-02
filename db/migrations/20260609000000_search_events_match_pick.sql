-- Extend search_events to match against the top pick's outcome label too.
-- Searching "France" now finds the "Who will win the FIFA World Cup?" event
-- even though "France" isn't in the title.

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
language sql stable
security invoker
set search_path = public
as $$
  with q as (select '%' || coalesce(_q, '') || '%' as pat)
  select
    e.id, e.domain, e.slug, e.title, e.status, e.starts_at, e.resolved_at,
    (p.ranked_outcomes->0->>'label') as top_pick_label,
    ((p.ranked_outcomes->0->>'probability')::numeric) as top_pick_pct,
    p.confidence
  from public.events e
  left join public.v_predictions_public p
    on p.event_id = e.id and p.is_current = true
  where e.moderation_status = 'approved'
    and (
      e.title ilike (select pat from q)
      or (p.ranked_outcomes->0->>'label') ilike (select pat from q)
    )
  order by
    case when e.status = 'scheduled' then 0 else 1 end,
    e.starts_at asc nulls last
  limit greatest(_limit, 1);
$$;

grant execute on function public.search_events(text, int) to anon, authenticated;
