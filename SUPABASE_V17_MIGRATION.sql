-- Brottta POS v17 migration
-- Run once in Supabase SQL Editor.

alter table public.orders
  add column if not exists order_source text not null default 'DIRECT';

alter table public.orders
  drop constraint if exists orders_order_source_check;

alter table public.orders
  add constraint orders_order_source_check
  check (order_source in ('DIRECT','ZOMATO'));

create index if not exists orders_order_source_idx
  on public.orders(order_source);

-- Attendance values used by the responsive attendance screen.
alter table public.attendance
  drop constraint if exists attendance_status_check;

alter table public.attendance
  add constraint attendance_status_check
  check (status in ('PRESENT','ABSENT','HALF_DAY','LEAVE'));
