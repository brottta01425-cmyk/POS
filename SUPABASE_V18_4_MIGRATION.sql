-- Brottta POS v18.4
-- Run once in Supabase SQL Editor.
-- Adds Counter Dine-In as a source and makes sure it does NOT receive a takeaway token.

alter table public.orders
  add column if not exists order_source text not null default 'DIRECT';

alter table public.orders
  add column if not exists token_number integer;

create table if not exists public.daily_takeaway_tokens (
  token_date date primary key,
  last_token integer not null default 0
);

alter table public.orders
  drop constraint if exists orders_order_source_check;

alter table public.orders
  add constraint orders_order_source_check
  check (order_source in ('DIRECT','DINE_IN','ZOMATO'));

-- Keep ZOMATO in the database constraint only for historical rows.
-- The POS no longer offers Zomato as a new-order option.

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
  if new.order_type = 'TAKEAWAY'
     and coalesce(new.order_source, 'DIRECT') <> 'DINE_IN'
     and new.token_number is null then

    local_date := (now() at time zone 'Asia/Kolkata')::date;

    insert into public.daily_takeaway_tokens(token_date, last_token)
    values (local_date, 1)
    on conflict (token_date)
    do update
      set last_token = public.daily_takeaway_tokens.last_token + 1
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
