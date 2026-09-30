-- calorie-pass database setup.
-- Paste this whole file into Supabase > SQL Editor and click Run.
-- Safe to re-run: it won't duplicate players or overwrite your access code.

-- ---------- Tables ----------

create table if not exists players (
  id serial primary key,
  name text not null unique
);

create table if not exists calorie_logs (
  id bigserial primary key,
  player_id int not null references players(id) on delete cascade,
  log_date date not null,
  calories int not null check (calories between 0 and 20000),
  created_at timestamptz not null default now(),
  unique (player_id, log_date) -- one log per player per day
);

create table if not exists settings (
  key text primary key,
  value text not null
);

-- ---------- Lock everything down ----------
-- RLS on with no policies = the website can't touch these tables directly.
-- All access goes through the functions below, which check the access code.

alter table players enable row level security;
alter table calorie_logs enable row level security;
alter table settings enable row level security;

-- ---------- Functions ----------

create or replace function check_code(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from settings where key = 'access_code' and value = p_code) then
    raise exception 'Invalid code' using errcode = '28000';
  end if;
end;
$$;

-- Everything the page needs to draw itself.
-- p_today is the browser's local date, so "today" matches your timezone.
create or replace function get_state(p_code text, p_today date)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  perform check_code(p_code);
  return (
    select coalesce(json_agg(row_to_json(t) order by t.id), '[]'::json)
    from (
      select
        p.id,
        p.name,
        (select count(*) from calorie_logs l where l.player_id = p.id) as days_logged,
        (select l.calories from calorie_logs l
          where l.player_id = p.id and l.log_date = p_today) as today_calories
      from players p
    ) t
  );
end;
$$;

-- Log (or correct) a day's calories. Re-submitting the same day updates it
-- rather than adding progress twice.
create or replace function submit_log(p_code text, p_player_id int, p_calories int, p_date date)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  perform check_code(p_code);

  -- Allow +/- 1 day of server time to cover timezones, but no backfilling.
  if p_date not between current_date - 1 and current_date + 1 then
    raise exception 'Date out of range';
  end if;

  insert into calorie_logs (player_id, log_date, calories)
  values (p_player_id, p_date, p_calories)
  on conflict (player_id, log_date) do update set calories = excluded.calories;

  return get_state(p_code, p_date);
end;
$$;

-- Only the two public functions are callable from the website.
revoke execute on function check_code(text) from public, anon, authenticated;
grant execute on function get_state(text, date) to anon;
grant execute on function submit_log(text, int, int, date) to anon;

-- ---------- Seed data ----------
-- Rename players here (or later in Table Editor).

insert into players (name) values ('Michael'), ('Friend')
on conflict (name) do nothing;

insert into settings (key, value) values ('access_code', 'CHANGE-ME')
on conflict (key) do nothing;

-- To set your real shared code, run:
--   update settings set value = 'your-secret-code' where key = 'access_code';
