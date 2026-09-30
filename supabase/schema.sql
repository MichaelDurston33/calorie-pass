-- calorie-pass database setup.
-- Paste this whole file into Supabase > SQL Editor and click Run.
-- Safe to re-run, and re-run it whenever this file changes: it won't delete
-- logs, duplicate players, or overwrite your access code.

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

-- Bee Jim Hardcore Mode: who has opted in so far, and when it has been on.
create table if not exists hardcore_optins (
  player_id int primary key references players(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists hardcore_periods (
  id serial primary key,
  start_date date not null,
  end_date date not null
);

-- ---------- Lock everything down ----------
-- RLS on with no policies = the website can't touch these tables directly.
-- All access goes through the functions below, which check the access code.

alter table players enable row level security;
alter table calorie_logs enable row level security;
alter table settings enable row level security;
alter table hardcore_optins enable row level security;
alter table hardcore_periods enable row level security;

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

-- Replaced by get_state(text) below.
drop function if exists get_state(text, date);

-- Everything the page needs: every log (the page works out streaks from
-- them, see rules.js) and the Hardcore Mode state.
create or replace function get_state(p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  perform check_code(p_code);
  return json_build_object(
    'players', (
      select coalesce(json_agg(json_build_object(
        'id', p.id,
        'name', p.name,
        'logs', (
          select coalesce(json_agg(json_build_object('date', l.log_date, 'calories', l.calories)
                                   order by l.log_date), '[]'::json)
          from calorie_logs l
          where l.player_id = p.id
        )
      ) order by p.id), '[]'::json)
      from players p
    ),
    'hardcore', json_build_object(
      'periods', (
        select coalesce(json_agg(json_build_object('start', h.start_date, 'end', h.end_date)
                                 order by h.start_date), '[]'::json)
        from hardcore_periods h
      ),
      'optins', (
        select coalesce(json_agg(o.player_id order by o.player_id), '[]'::json)
        from hardcore_optins o
      )
    )
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

  return get_state(p_code);
end;
$$;

-- Opt in to (or back out of) Bee Jim Hardcore Mode. Once everyone is in, it
-- starts straight away and lasts 7 days, today included. It can't be stopped early.
create or replace function set_hardcore_optin(p_code text, p_player_id int, p_opt_in boolean, p_today date)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  perform check_code(p_code);

  if p_today not between current_date - 1 and current_date + 1 then
    raise exception 'Date out of range';
  end if;

  -- One change at a time, so two people opting in at once can't miss each other.
  lock table hardcore_optins in exclusive mode;

  if exists (select 1 from hardcore_periods where p_today between start_date and end_date) then
    raise exception 'Hardcore mode is already on';
  end if;

  if p_opt_in then
    insert into hardcore_optins (player_id) values (p_player_id)
    on conflict (player_id) do nothing;
  else
    delete from hardcore_optins where player_id = p_player_id;
  end if;

  if (select count(*) from hardcore_optins) = (select count(*) from players) then
    insert into hardcore_periods (start_date, end_date) values (p_today, p_today + 6);
    delete from hardcore_optins where true; -- "where true": some setups refuse a bare DELETE
  end if;

  return get_state(p_code);
end;
$$;

-- Only these functions are callable from the website.
revoke execute on function check_code(text) from public, anon, authenticated;
grant execute on function get_state(text) to anon;
grant execute on function submit_log(text, int, int, date) to anon;
grant execute on function set_hardcore_optin(text, int, boolean, date) to anon;

-- ---------- Seed data ----------
-- Names must match the keys in passes.js.

insert into players (name) values ('Michael'), ('Abbie')
on conflict (name) do nothing;

insert into settings (key, value) values ('access_code', 'CHANGE-ME')
on conflict (key) do nothing;

-- To set your real shared code, run:
--   update settings set value = 'your-secret-code' where key = 'access_code';
