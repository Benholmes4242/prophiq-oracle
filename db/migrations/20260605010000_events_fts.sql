-- Full-text search over event titles.

alter table public.events
  add column if not exists title_search tsvector
  generated always as (to_tsvector('english', coalesce(title, ''))) stored;

create index if not exists idx_events_title_search
  on public.events using gin (title_search);

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
  select
    e.id, e.domain, e.slug, e.title, e.status, e.starts_at, e.resolved_at,
    (p.ranked_outcomes->0->>'label') as top_pick_label,
    ((p.ranked_outcomes->0->>'probability')::numeric) as top_pick_pct,
    p.confidence
  from public.events e
  left join public.v_predictions_public p
    on p.event_id = e.id and p.is_current = true
  where e.title_search @@ plainto_tsquery('english', _q)
  order by
    ts_rank(e.title_search, plainto_tsquery('english', _q)) desc,
    e.starts_at desc nulls last
  limit greatest(_limit, 1);
$$;

grant execute on function public.search_events(text, int) to anon, authenticated;
