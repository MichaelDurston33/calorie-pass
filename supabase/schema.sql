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

-- Optional, added later: steps walked that day.
alter table calorie_logs add column if not exists steps int check (steps between 0 and 200000);

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

-- Timed study sessions, e.g. the e-reader's 25-minute reading timer or an HSK
-- pomodoro. They move study passes on (see `study` in passes.js). It's called
-- reading_sessions because the e-reader came first.
create table if not exists reading_sessions (
  id bigserial primary key,
  player_id int not null references players(id) on delete cascade,
  session_date date not null,
  minutes int not null check (minutes between 1 and 600),
  created_at timestamptz not null default now()
);

-- Added later: which tool sent the session (STUDY_TOOLS in passes.js). Every
-- session from before then came from the e-reader.
alter table reading_sessions add column if not exists source text not null default 'ereader'
  check (length(source) between 1 and 20);

-- Prize tokens that have been used, e.g. Abbie's Plushie token. Tokens are
-- earned on the pass (the page works them out, see passes.js); this records
-- each one spent, so tokens left = earned - spent.
create table if not exists token_spends (
  id bigserial primary key,
  player_id int not null references players(id) on delete cascade,
  prize text not null check (length(prize) between 1 and 40), -- the prize's name in passes.js
  spent_on date not null,
  created_at timestamptz not null default now()
);

-- The Plushie Journal: one polaroid per plushie. The photo is a small JPEG
-- (resized in the browser to 800x800, roughly 100 KB) kept as text so it goes
-- through the same code-checked functions as everything else. `style` holds the
-- ids of the frame, backdrop, tape and font chosen (see journal-palette.js).
create table if not exists journal_entries (
  id bigserial primary key,
  player_id int not null references players(id) on delete cascade,
  spend_id bigint references token_spends(id) on delete set null, -- the token it was bought with
  name text not null check (length(name) between 1 and 40),
  entry_date date not null,
  photo text not null check (length(photo) <= 1500000 and photo ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$'),
  style jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Added later: what animal each plushie is, for the group photo (a photo
-- doesn't always make that clear).
alter table journal_entries add column if not exists species text check (length(species) <= 40);

-- Group photos: a picture of the journal's plushies together, drawn by
-- OpenAI's image model from their photos (see supabase/functions/group-photo).
-- It's 'pending' while being drawn, then 'done' with the photo, or 'failed'.
-- The token is only used once it's done. The one shown at the top of the
-- journal is the done one with the latest shown_at.
create table if not exists group_photos (
  id bigserial primary key,
  player_id int not null references players(id) on delete cascade,
  prize text not null check (length(prize) between 1 and 40), -- the token it uses, from passes.js
  spend_id bigint references token_spends(id) on delete set null,
  prompt text not null check (length(prompt) between 1 and 200), -- what they're doing
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  error text check (length(error) <= 300),
  photo text check (photo is null or (length(photo) <= 6000000 and photo ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$')),
  caption text not null default '' check (length(caption) <= 40),
  photo_date date not null default current_date,
  style jsonb not null default '{}'::jsonb,
  shown_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- Lock everything down ----------
-- RLS on with no policies = the website can't touch these tables directly.
-- All access goes through the functions below, which check the access code.

alter table players enable row level security;
alter table calorie_logs enable row level security;
alter table settings enable row level security;
alter table hardcore_optins enable row level security;
alter table hardcore_periods enable row level security;
alter table reading_sessions enable row level security;
alter table token_spends enable row level security;
alter table journal_entries enable row level security;
alter table group_photos enable row level security;

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
          select coalesce(json_agg(json_build_object('date', l.log_date, 'calories', l.calories, 'steps', l.steps)
                                   order by l.log_date), '[]'::json)
          from calorie_logs l
          where l.player_id = p.id
        ),
        -- Study sessions: one entry per day per tool, with that day's longest
        -- session from it.
        'reading', (
          select coalesce(json_agg(json_build_object('date', r.session_date, 'source', r.source, 'minutes', r.minutes)
                                   order by r.session_date, r.source), '[]'::json)
          from (
            select session_date, source, max(minutes) as minutes
            from reading_sessions
            where player_id = p.id
            group by session_date, source
          ) r
        ),
        'spends', (
          select coalesce(json_agg(json_build_object('id', s.id, 'prize', s.prize, 'date', s.spent_on)
                                   order by s.spent_on, s.id), '[]'::json)
          from token_spends s
          where s.player_id = p.id
        ),
        -- Journal entries without their photos, which are fetched one at a
        -- time by get_journal_photo so this stays small.
        'journal', (
          select coalesce(json_agg(json_build_object('id', j.id, 'name', j.name, 'species', j.species,
                                                     'date', j.entry_date, 'style', j.style, 'spendId', j.spend_id)
                                   order by j.entry_date, j.id), '[]'::json)
          from journal_entries j
          where j.player_id = p.id
        ),
        -- Group photos without their pictures (get_group_photo fetches those).
        -- Failed attempts are only kept for a day, so the page can say what went wrong.
        'groupPhotos', (
          select coalesce(json_agg(json_build_object('id', g.id, 'status', g.status, 'error', g.error,
                                                     'prompt', g.prompt, 'caption', g.caption,
                                                     'date', g.photo_date, 'style', g.style,
                                                     'spendId', g.spend_id, 'shownAt', g.shown_at,
                                                     'createdAt', g.created_at)
                                   order by g.created_at, g.id), '[]'::json)
          from group_photos g
          where g.player_id = p.id
            and (g.status <> 'failed' or g.created_at > now() - interval '1 day')
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

-- Replaced by submit_log with p_steps below.
drop function if exists submit_log(text, int, int, date);

-- Log (or correct) a day's calories, and optionally steps. Re-submitting the
-- same day updates it rather than adding progress twice; leaving steps blank
-- keeps any steps already logged that day.
create or replace function submit_log(p_code text, p_player_id int, p_calories int, p_date date, p_steps int default null)
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

  insert into calorie_logs (player_id, log_date, calories, steps)
  values (p_player_id, p_date, p_calories, p_steps)
  on conflict (player_id, log_date) do update
    set calories = excluded.calories,
        steps = coalesce(excluded.steps, calorie_logs.steps);

  return get_state(p_code);
end;
$$;

-- Called by the e-reader when its reading timer finishes. p_date is the
-- e-reader's own local date. Returns how many minutes that day's longest
-- e-reader session was, so the e-reader can show it was saved.
create or replace function submit_reading(p_code text, p_player_id int, p_date date, p_minutes int default 25)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  perform check_code(p_code);

  if p_date not between current_date - 1 and current_date + 1 then
    raise exception 'Date out of range';
  end if;
  if not exists (select 1 from players where id = p_player_id) then
    raise exception 'Unknown player';
  end if;

  insert into reading_sessions (player_id, session_date, minutes, source)
  values (p_player_id, p_date, p_minutes, 'ereader');

  return json_build_object(
    'date', p_date,
    'minutes', (select max(minutes) from reading_sessions
                where player_id = p_player_id and session_date = p_date and source = 'ereader')
  );
end;
$$;

-- Called by any other study tool when its timer finishes, e.g. the HSK app's
-- pomodoro. p_source is the tool's name, one of the list below (the names in
-- STUDY_TOOLS in passes.js). A misspelt name is turned away, so a tool can't
-- quietly send sessions that never count. p_date is the tool's own local date.
-- Returns that day's longest session from that tool, so it can show it was saved.
create or replace function submit_study(p_code text, p_player_id int, p_source text, p_date date, p_minutes int default 25)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text := lower(trim(p_source));
begin
  perform check_code(p_code);

  if v_source is null or v_source not in ('ereader', 'hsk') then
    raise exception 'Unknown study tool: %', coalesce(p_source, '(none given)');
  end if;
  if p_date not between current_date - 1 and current_date + 1 then
    raise exception 'Date out of range';
  end if;
  if not exists (select 1 from players where id = p_player_id) then
    raise exception 'Unknown player';
  end if;

  insert into reading_sessions (player_id, session_date, minutes, source)
  values (p_player_id, p_date, p_minutes, v_source);

  return json_build_object(
    'date', p_date,
    'source', v_source,
    'minutes', (select max(minutes) from reading_sessions
                where player_id = p_player_id and session_date = p_date and source = v_source)
  );
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

-- Use one of a player's prize tokens (e.g. 'Plushie'). The page only offers
-- this when there's a token left to spend.
create or replace function spend_token(p_code text, p_player_id int, p_prize text, p_date date)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  perform check_code(p_code);

  if p_date not between current_date - 1 and current_date + 1 then
    raise exception 'Date out of range';
  end if;

  insert into token_spends (player_id, prize, spent_on) values (p_player_id, p_prize, p_date);

  return get_state(p_code);
end;
$$;

-- Undo a token spent by mistake. A journal entry bought with it stays, just
-- no longer linked to a token.
create or replace function unspend_token(p_code text, p_player_id int, p_spend_id bigint)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  perform check_code(p_code);
  delete from token_spends where id = p_spend_id and player_id = p_player_id;
  return get_state(p_code);
end;
$$;

-- Replaced by save_journal_entry with p_species below.
drop function if exists save_journal_entry(text, int, bigint, text, date, text, jsonb, bigint, text);

-- Add a journal entry (p_entry_id null) or change one. When changing, a null
-- photo keeps the existing one. For a new entry, p_new_token spends a token
-- of that prize for it, or p_spend_id links a token already spent.
create or replace function save_journal_entry(
  p_code text, p_player_id int, p_entry_id bigint, p_name text, p_date date,
  p_photo text, p_style jsonb, p_spend_id bigint default null, p_new_token text default null,
  p_species text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spend_id bigint := p_spend_id;
begin
  perform check_code(p_code);

  if p_date > current_date + 1 then
    raise exception 'Date out of range';
  end if;

  if p_entry_id is null then
    if p_photo is null then
      raise exception 'A photo is needed';
    end if;
    if p_new_token is not null then
      insert into token_spends (player_id, prize, spent_on)
      values (p_player_id, p_new_token, p_date)
      returning id into v_spend_id;
    end if;
    insert into journal_entries (player_id, spend_id, name, species, entry_date, photo, style)
    values (p_player_id, v_spend_id, trim(p_name), nullif(trim(p_species), ''), p_date, p_photo,
            coalesce(p_style, '{}'::jsonb));
  else
    update journal_entries
    set name = trim(p_name),
        species = nullif(trim(p_species), ''),
        entry_date = p_date,
        photo = coalesce(p_photo, photo),
        style = coalesce(p_style, style)
    where id = p_entry_id and player_id = p_player_id;
  end if;

  return get_state(p_code);
end;
$$;

-- Remove a journal entry. The token it was bought with stays spent.
create or replace function delete_journal_entry(p_code text, p_player_id int, p_entry_id bigint)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  perform check_code(p_code);
  delete from journal_entries where id = p_entry_id and player_id = p_player_id;
  return get_state(p_code);
end;
$$;

-- One journal photo, as a data: URL the page can show directly.
create or replace function get_journal_photo(p_code text, p_entry_id bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  perform check_code(p_code);
  return (select photo from journal_entries where id = p_entry_id);
end;
$$;

-- ---------- Group photos ----------
-- The group-photo Edge Function calls begin_group_photo, then finish_ or
-- fail_group_photo when OpenAI is done. The page calls the rest.

-- Starts a group photo of the chosen journal entries: records it as pending and
-- returns its id with the plushies' names, species and photos to draw from.
create or replace function begin_group_photo(
  p_code text, p_player_id int, p_prize text, p_prompt text, p_entry_ids bigint[], p_date date
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  perform check_code(p_code);

  if p_date not between current_date - 1 and current_date + 1 then
    raise exception 'Date out of range';
  end if;
  if length(trim(coalesce(p_prompt, ''))) = 0 then
    raise exception 'Say what they''re doing first';
  end if;
  if coalesce(array_length(p_entry_ids, 1), 0) = 0 then
    raise exception 'Pick at least one plushie';
  end if;

  -- One at a time, so two taps can't start two.
  lock table group_photos in exclusive mode;

  -- Anything still pending after 5 minutes has stalled.
  update group_photos set status = 'failed', error = 'It took too long'
  where player_id = p_player_id and status = 'pending' and created_at < now() - interval '5 minutes';

  if exists (select 1 from group_photos where player_id = p_player_id and status = 'pending') then
    raise exception 'A group photo is already developing';
  end if;

  -- A cap on attempts, so nothing can run up the OpenAI bill.
  if (select count(*) from group_photos
      where player_id = p_player_id and created_at > now() - interval '1 day') >= 4 then
    raise exception 'That''s enough group photos for one day. Try again tomorrow!';
  end if;

  -- The caption starts as what they're doing, cut at a whole word if it's long.
  insert into group_photos (player_id, prize, prompt, caption, photo_date)
  values (
    p_player_id, p_prize, left(trim(p_prompt), 200),
    case when length(trim(p_prompt)) <= 40 then trim(p_prompt)
         else regexp_replace(left(trim(p_prompt), 39), '\s+\S*$', '') || '…' end,
    p_date
  )
  returning id into v_id;

  return json_build_object(
    'id', v_id,
    'plushies', (
      select coalesce(json_agg(json_build_object('name', j.name, 'species', j.species, 'photo', j.photo)
                               order by j.entry_date, j.id), '[]'::json)
      from journal_entries j
      where j.player_id = p_player_id and j.id = any(p_entry_ids)
    )
  );
end;
$$;

-- The picture came back: save it, use the token, and show it at the top of the journal.
create or replace function finish_group_photo(p_code text, p_id bigint, p_photo text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_photo group_photos;
  v_spend_id bigint;
begin
  perform check_code(p_code);

  select * into v_photo from group_photos where id = p_id and status = 'pending' for update;
  if v_photo.id is null then
    raise exception 'No group photo is developing';
  end if;

  insert into token_spends (player_id, prize, spent_on)
  values (v_photo.player_id, v_photo.prize, v_photo.photo_date)
  returning id into v_spend_id;

  update group_photos
  set status = 'done', photo = p_photo, spend_id = v_spend_id, shown_at = now(), error = null
  where id = p_id;

  return json_build_object('id', p_id);
end;
$$;

-- It didn't work. The token isn't used.
create or replace function fail_group_photo(p_code text, p_id bigint, p_error text)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  perform check_code(p_code);
  update group_photos set status = 'failed', error = left(coalesce(p_error, 'Something went wrong'), 300)
  where id = p_id and status = 'pending';
  return json_build_object('id', p_id);
end;
$$;

-- Change a group photo's caption, date and look.
create or replace function save_group_photo(
  p_code text, p_player_id int, p_id bigint, p_caption text, p_date date, p_style jsonb
)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  perform check_code(p_code);
  update group_photos
  set caption = left(trim(coalesce(p_caption, '')), 40),
      photo_date = coalesce(p_date, photo_date),
      style = coalesce(p_style, style)
  where id = p_id and player_id = p_player_id;
  return get_state(p_code);
end;
$$;

-- Put an older group photo back at the top of the journal.
create or replace function show_group_photo(p_code text, p_player_id int, p_id bigint)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  perform check_code(p_code);
  update group_photos set shown_at = now() where id = p_id and player_id = p_player_id and status = 'done';
  return get_state(p_code);
end;
$$;

-- Remove a group photo. The token it used stays used.
create or replace function delete_group_photo(p_code text, p_player_id int, p_id bigint)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  perform check_code(p_code);
  delete from group_photos where id = p_id and player_id = p_player_id;
  return get_state(p_code);
end;
$$;

-- One group photo's picture, as a data: URL.
create or replace function get_group_photo(p_code text, p_id bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  perform check_code(p_code);
  return (select photo from group_photos where id = p_id);
end;
$$;

-- Only these functions are callable from the website.
revoke execute on function check_code(text) from public, anon, authenticated;
grant execute on function get_state(text) to anon;
grant execute on function submit_log(text, int, int, date, int) to anon;
grant execute on function set_hardcore_optin(text, int, boolean, date) to anon;
grant execute on function submit_reading(text, int, date, int) to anon;
grant execute on function submit_study(text, int, text, date, int) to anon;
grant execute on function spend_token(text, int, text, date) to anon;
grant execute on function unspend_token(text, int, bigint) to anon;
grant execute on function save_journal_entry(text, int, bigint, text, date, text, jsonb, bigint, text, text) to anon;
grant execute on function delete_journal_entry(text, int, bigint) to anon;
grant execute on function get_journal_photo(text, bigint) to anon;
grant execute on function begin_group_photo(text, int, text, text, bigint[], date) to anon;
grant execute on function finish_group_photo(text, bigint, text) to anon;
grant execute on function fail_group_photo(text, bigint, text) to anon;
grant execute on function save_group_photo(text, int, bigint, text, date, jsonb) to anon;
grant execute on function show_group_photo(text, int, bigint) to anon;
grant execute on function delete_group_photo(text, int, bigint) to anon;
grant execute on function get_group_photo(text, bigint) to anon;

-- ---------- Seed data ----------
-- Names must match the keys in passes.js.

insert into players (name) values ('Michael'), ('Abbie')
on conflict (name) do nothing;

insert into settings (key, value) values ('access_code', 'CHANGE-ME')
on conflict (key) do nothing;

-- Mochi, Abbie's first plushie, is a goat (the photo doesn't make that obvious).
-- Only fills it in if it's blank, so it never undoes a change made in the app.
update journal_entries set species = 'goat' where name = 'Mochi' and species is null;

-- To set your real shared code, run:
--   update settings set value = 'your-secret-code' where key = 'access_code';
