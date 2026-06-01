-- Capture-only newsletter signups. No send pipeline yet.

create table if not exists public.newsletter_signups (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  created_at      timestamptz not null default now(),
  ip_hash         text,
  source          text default 'homepage',
  unsubscribed    boolean default false,
  unsubscribed_at timestamptz,
  constraint newsletter_signups_email_unique unique (email)
);

grant all on public.newsletter_signups to service_role;

alter table public.newsletter_signups enable row level security;
revoke select, insert, update, delete on public.newsletter_signups from anon, authenticated;

create or replace function public.signup_for_digest(
  _email text,
  _source text default 'homepage'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_email    text;
begin
  v_email := lower(trim(coalesce(_email, '')));

  if v_email = '' or v_email !~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;

  select id into v_existing from public.newsletter_signups where email = v_email;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'already_signed_up', true);
  end if;

  insert into public.newsletter_signups (email, source)
    values (v_email, coalesce(_source, 'homepage'));

  return jsonb_build_object('ok', true, 'already_signed_up', false);
end;
$$;

grant execute on function public.signup_for_digest(text, text) to anon, authenticated;
