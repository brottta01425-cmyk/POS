-- BROTTTA POS v4
-- Run this in Supabase SQL Editor.
-- This migration keeps existing data and adds table-session support.

create extension if not exists pgcrypto;

create table if not exists public.profiles(
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text,
 role text not null default 'waiter' check(role in('super_admin','admin','waiter','chef','cashier')),
 active boolean not null default true,
 created_at timestamptz not null default now()
);

create table if not exists public.menu_items(
 id uuid primary key default gen_random_uuid(),name text not null,
 category text not null default 'Other',price numeric(12,2) not null default 0,
 cost_price numeric(12,2) not null default 0,available boolean not null default true,
 created_at timestamptz not null default now()
);

create table if not exists public.table_sessions(
 id uuid primary key default gen_random_uuid(),
 table_no integer not null,
 status text not null default 'OPEN' check(status in('OPEN','CLOSED','PAID')),
 opened_by uuid references auth.users(id),
 closed_by uuid references auth.users(id),
 opened_at timestamptz not null default now(),
 closed_at timestamptz,
 paid_at timestamptz,
 total numeric(12,2) not null default 0,
 seat_label text not null default 'ENTIRE TABLE',
 chairs integer[] not null default '{}'
);

create unique index if not exists one_open_session_per_table
on public.table_sessions(table_no) where status='OPEN';

create table if not exists public.orders(
 id uuid primary key default gen_random_uuid(),
 table_no integer not null,
 session_id uuid references public.table_sessions(id) on delete set null,
 status text not null default 'NEW'
   check(status in('NEW','PREPARING','READY','SERVED','BILL_REQUESTED','PAID','CANCELLED')),
 total numeric(12,2) not null default 0,
 created_by uuid references auth.users(id),
 payment_method text,
 paid_at timestamptz,
 created_at timestamptz not null default now()
);

-- Add new columns safely to an existing installation.
alter table public.orders add column if not exists created_by uuid references auth.users(id);
alter table public.orders add column if not exists session_id uuid references public.table_sessions(id) on delete set null;
alter table public.orders add column if not exists seat_label text not null default 'ENTIRE TABLE';
alter table public.orders add column if not exists chairs integer[] not null default '{}';
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check(status in('NEW','PREPARING','READY','SERVED','BILL_REQUESTED','PAID','CANCELLED'));

create table if not exists public.order_items(
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.orders(id) on delete cascade,
 menu_item_id uuid references public.menu_items(id),
 item_name text not null,unit_price numeric(12,2) not null default 0,
 qty integer not null default 1,line_total numeric(12,2) not null default 0,
 status text not null default 'NEW' check(status in('NEW','PREPARING','READY','SERVED','CANCELLED')),
 served_at timestamptz,
 created_at timestamptz not null default now()
);

alter table public.order_items add column if not exists status text not null default 'NEW';
alter table public.order_items add column if not exists served_at timestamptz;
alter table public.order_items drop constraint if exists order_items_status_check;
alter table public.order_items add constraint order_items_status_check check(status in('NEW','PREPARING','READY','SERVED','CANCELLED'));

create table if not exists public.employees(
 id uuid primary key default gen_random_uuid(),name text not null,
 role text not null default 'Waiter',active boolean not null default true,
 created_at timestamptz not null default now()
);

create table if not exists public.attendance(
 id uuid primary key default gen_random_uuid(),
 employee_id uuid not null references public.employees(id) on delete cascade,
 attendance_date date not null default current_date,
 status text not null check(status in('PRESENT','ABSENT','LEAVE')),
 created_at timestamptz not null default now(),unique(employee_id,attendance_date)
);

create table if not exists public.expenses(
 id uuid primary key default gen_random_uuid(),description text not null,
 amount numeric(12,2) not null default 0,expense_date date not null default current_date,
 created_at timestamptz not null default now()
);

create index if not exists orders_status_idx on public.orders(status);
create index if not exists orders_created_at_idx on public.orders(created_at desc);
create index if not exists orders_session_idx on public.orders(session_id);
create index if not exists order_items_order_id_idx on public.order_items(order_id);

alter table public.profiles enable row level security;
alter table public.menu_items enable row level security;
alter table public.table_sessions enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.employees enable row level security;
alter table public.attendance enable row level security;
alter table public.expenses enable row level security;

drop policy if exists staff_profiles on public.profiles;
create policy staff_profiles on public.profiles for select to authenticated using(true);

drop policy if exists staff_menu on public.menu_items;
create policy staff_menu on public.menu_items for all to authenticated using(true) with check(true);

drop policy if exists staff_sessions on public.table_sessions;
create policy staff_sessions on public.table_sessions for all to authenticated using(true) with check(true);

drop policy if exists staff_orders on public.orders;
create policy staff_orders on public.orders for all to authenticated using(true) with check(true);

drop policy if exists staff_order_items on public.order_items;
create policy staff_order_items on public.order_items for all to authenticated using(true) with check(true);

drop policy if exists staff_employees on public.employees;
create policy staff_employees on public.employees for all to authenticated using(true) with check(true);

drop policy if exists staff_attendance on public.attendance;
create policy staff_attendance on public.attendance for all to authenticated using(true) with check(true);

drop policy if exists staff_expenses on public.expenses;
create policy staff_expenses on public.expenses for all to authenticated using(true) with check(true);

-- Enable realtime for the tables used by the live kitchen/waiter/cashier screens.
do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.order_items;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.table_sessions;
exception when duplicate_object then null;
end $$;


-- Brottta POS v5: stock, date/time, payment method and sales analytics support
alter table public.menu_items add column if not exists out_of_stock boolean not null default false;
alter table public.orders add column if not exists payment_method text;
alter table public.orders add column if not exists paid_at timestamptz;
alter table public.orders add column if not exists created_at timestamptz not null default now();

update public.menu_items set out_of_stock=false where out_of_stock is null;

create index if not exists idx_orders_created_at on public.orders(created_at);
create index if not exists idx_orders_paid_at on public.orders(paid_at);
create index if not exists idx_orders_payment_method on public.orders(payment_method);


-- Brottta POS v6: employee payroll, lending and salary payment tracking
alter table public.employees add column if not exists payment_type text not null default 'WEEKLY';
alter table public.employees add column if not exists per_day_salary numeric not null default 0;
alter table public.employees add column if not exists advance_balance numeric not null default 0;

create table if not exists public.employee_advances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  amount numeric not null default 0,
  remaining_amount numeric not null default 0,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.salary_payments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  payment_type text not null default 'WEEKLY',
  period_start date not null,
  period_end date not null,
  present_days integer not null default 0,
  base_salary numeric not null default 0,
  allowance numeric not null default 0,
  incentive numeric not null default 0,
  personal_expense numeric not null default 0,
  advance_deduction numeric not null default 0,
  gross_salary numeric not null default 0,
  net_salary numeric not null default 0,
  status text not null default 'PAID',
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_employee_advances_employee on public.employee_advances(employee_id);
create index if not exists idx_salary_payments_employee on public.salary_payments(employee_id);
create index if not exists idx_salary_payments_period on public.salary_payments(period_start,period_end);

alter table public.employee_advances enable row level security;
alter table public.salary_payments enable row level security;

drop policy if exists "Authenticated staff can manage employee advances" on public.employee_advances;
create policy "Authenticated staff can manage employee advances" on public.employee_advances for all to authenticated using (true) with check (true);

drop policy if exists "Authenticated staff can manage salary payments" on public.salary_payments;
create policy "Authenticated staff can manage salary payments" on public.salary_payments for all to authenticated using (true) with check (true);

-- v7 payroll behavior is calculated in the app: weekly periods are Monday-Sunday;
-- monthly periods are the first through last day of the current calendar month.
-- HALF_DAY attendance counts as 0.5 day toward salary.


-- v17 order source
alter table public.orders add column if not exists order_source text not null default 'DIRECT';
alter table public.orders drop constraint if exists orders_order_source_check;
alter table public.orders add constraint orders_order_source_check check (order_source in ('DIRECT','DINE_IN','ZOMATO'));


-- v18.1 daily takeaway tokens
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
  if new.order_type = 'TAKEAWAY' and coalesce(new.order_source, 'DIRECT') <> 'DINE_IN' and new.token_number is null then
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

-- Optional cleanup: old counter rows can be retained safely.
-- They are tiny and make historical auditing easier.


-- v18.6 daily finance
-- Brottta POS v18.6
-- Daily attendance salary expense + sales adjustment + adjusted profit.
-- Run ONCE in Supabase SQL Editor.

-- 1) Expenses can now distinguish manual vs auto salary entries.
alter table public.expenses
  add column if not exists expense_type text not null default 'MANUAL';

alter table public.expenses
  add column if not exists auto_key text;

update public.expenses
set expense_type='MANUAL'
where expense_type is null;

create unique index if not exists expenses_auto_key_unique_idx
  on public.expenses(auto_key);

-- 2) One sales adjustment record per calendar date.
create table if not exists public.sales_adjustments (
  id uuid primary key default gen_random_uuid(),
  adjustment_date date not null,
  amount numeric(12,2) not null default 0,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(adjustment_date)
);

alter table public.sales_adjustments enable row level security;

drop policy if exists staff_sales_adjustments on public.sales_adjustments;
create policy staff_sales_adjustments
on public.sales_adjustments
for all
to authenticated
using (true)
with check (true);

create index if not exists idx_sales_adjustments_date
  on public.sales_adjustments(adjustment_date desc);
