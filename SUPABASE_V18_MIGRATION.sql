-- Brottta POS v18.1 - Daily Takeaway / Parcel Token Number
-- Run once in Supabase SQL Editor.
-- Counter is based on India time (Asia/Kolkata).
-- Each new calendar day begins again with token 1.

alter table public.orders
  add column if not exists token_number integer;

create table if not exists public.daily_takeaway_tokens (
  token_date date primary key,
  last_token integer not null default 0
);

create or replace function public.assign_takeaway_token()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  local_date date;
  next_token integer;
begin
  if new.order_type = 'TAKEAWAY' and new.token_number is null then
    local_date := (now() at time zone 'Asia/Kolkata')::date;

    insert into public.daily_takeaway_tokens(token_date, last_token)
    values (local_date, 1)
    on conflict (token_date)
    do update set last_token = public.daily_takeaway_tokens.last_token + 1
    returning last_token into next_token;

    new.token_number := next_token;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_assign_takeaway_token on public.orders;

create trigger trg_assign_takeaway_token
before insert on public.orders
for each row
execute function public.assign_takeaway_token();

create index if not exists orders_takeaway_token_idx
  on public.orders ((created_at at time zone 'Asia/Kolkata')::date, token_number)
  where order_type = 'TAKEAWAY';

-- Optional cleanup: old counter rows can be retained safely.
-- They are tiny and make historical auditing easier.
