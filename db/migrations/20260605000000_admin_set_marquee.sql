-- Admin RPC: toggle is_marquee on events with shared-password gate.
-- Password is read from a Postgres setting (app.admin_password) that an
-- operator sets once via:
--   alter database postgres set app.admin_password = '<the password>';

create or replace function public.admin_set_marquee(
  _event_id uuid,
  _value boolean,
  _password text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
begin
  v_expected := current_setting('app.admin_password', true);

  if v_expected is null or v_expected = '' then
    raise exception 'Admin password not configured';
  end if;

  if _password is null or _password <> v_expected then
    raise exception 'Unauthorized';
  end if;

  if _value = true then
    update public.events
      set is_marquee = false
      where is_marquee = true
        and id <> _event_id;
  end if;

  update public.events
    set is_marquee = _value
    where id = _event_id;
end;
$$;

revoke execute on function public.admin_set_marquee(uuid, boolean, text) from public;
grant execute on function public.admin_set_marquee(uuid, boolean, text) to anon, authenticated;
