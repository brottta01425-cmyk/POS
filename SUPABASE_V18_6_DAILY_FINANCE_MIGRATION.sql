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
