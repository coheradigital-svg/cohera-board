-- Cohera Board · Supabase schema
-- Run once in the SQL editor of the project. Every collection is one table with a JSON document,
-- so the app's document model stays exactly as it is.

create extension if not exists pgcrypto;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['tasks','clients','obligations','checkins','months','picks','intake','funding','sessions','reviews','meta']
  loop
    execute format('create table if not exists public.%I (id text primary key, data jsonb not null default ''{}''::jsonb, updated_at timestamptz not null default now())', t);
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "team reads" on public.%I', t);
    execute format('drop policy if exists "team writes" on public.%I', t);
    execute format('create policy "team reads" on public.%I for select to authenticated using (true)', t);
    execute format('create policy "team writes" on public.%I for all to authenticated using (true) with check (true)', t);
    execute format('alter publication supabase_realtime add table public.%I', t);
  end loop;
exception when duplicate_object then null;
end $$;

-- Only the three of them may sign in. Anyone else who requests a magic link is refused.
create table if not exists public.allowed_emails (email text primary key, person text not null);
alter table public.allowed_emails enable row level security;
create policy "team reads allowed" on public.allowed_emails for select to authenticated using (true);

create or replace function public.check_allowed_email() returns trigger language plpgsql security definer as $$
begin
  if not exists (select 1 from public.allowed_emails a where lower(a.email) = lower(new.email)) then
    raise exception 'This email is not on the team list.';
  end if;
  return new;
end $$;
drop trigger if exists only_team_signs_up on auth.users;
create trigger only_team_signs_up before insert on auth.users for each row execute function public.check_allowed_email();

-- Fill in the three addresses before anyone signs in:
-- insert into public.allowed_emails (email, person) values
--   ('yani@example.com', 'Яни'), ('kancho@example.com', 'Кънчо'), ('evi@example.com', 'Еви');
