-- Bug 1 backfill: renormalise existing predictions whose ranked_outcomes /
-- alternates were stored before the consensus engine learned to clamp the
-- per-outcome probabilities. Without this, records like the Belmont Stakes
-- forecast keep displaying 100% + 70% + 2% = 172% and the headline pick is
-- whichever entity happened to land first by Borda rank, not the
-- highest-probability one.
--
-- The function scales each named outcome by (100 / rawSum) when rawSum > 100,
-- leaves probabilities untouched when rawSum <= 100 (preserves implicit
-- field share), re-sorts by probability descending (Borda score breaks ties
-- when present), and renumbers ranks 1..N.
--
-- Idempotent: running it a second time is a no-op for any row whose
-- probabilities already sum to <= 100.

create or replace function public._renormalise_ranked_outcomes(arr jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  raw_sum   numeric := 0;
  scale     numeric := 1;
  result    jsonb;
begin
  if arr is null or jsonb_typeof(arr) <> 'array' or jsonb_array_length(arr) = 0 then
    return arr;
  end if;

  select coalesce(sum( (coalesce((elem ->> 'probability')::numeric, 0)) ), 0)
    into raw_sum
    from jsonb_array_elements(arr) as elem;

  if raw_sum > 100 then
    scale := 100.0 / raw_sum;
  end if;

  -- Scale, then resort by probability desc (score desc as tiebreak),
  -- then renumber rank.
  with scaled as (
    select
      jsonb_set(
        elem,
        '{probability}',
        to_jsonb(round( (coalesce((elem ->> 'probability')::numeric, 0) * scale)::numeric, 1))
      ) as e,
      coalesce((elem ->> 'probability')::numeric, 0) * scale as p,
      coalesce((elem ->> 'score')::numeric, 0)              as s
      from jsonb_array_elements(arr) as elem
  ),
  ordered as (
    select e, row_number() over (order by p desc, s desc) as rn
      from scaled
  ),
  renumbered as (
    select jsonb_set(e, '{rank}', to_jsonb(rn)) as e
      from ordered
      order by rn
  )
  select coalesce(jsonb_agg(e), '[]'::jsonb) into result from renumbered;

  return result;
end;
$$;

update public.predictions
set
  ranked_outcomes = public._renormalise_ranked_outcomes(ranked_outcomes),
  alternates      = public._renormalise_ranked_outcomes(alternates)
where
  ranked_outcomes is not null
  and (
    (
      select coalesce(sum( coalesce((elem ->> 'probability')::numeric, 0) ), 0)
        from jsonb_array_elements(ranked_outcomes) as elem
    ) > 100.0001
    or (
      alternates is not null and jsonb_typeof(alternates) = 'array' and (
        select coalesce(sum( coalesce((elem ->> 'probability')::numeric, 0) ), 0)
          from jsonb_array_elements(alternates) as elem
      ) > 100.0001
    )
  );

drop function public._renormalise_ranked_outcomes(jsonb);
