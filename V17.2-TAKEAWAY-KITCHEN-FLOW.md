-- Brottta POS v18 migration
-- Run once in Supabase SQL Editor before creating a Super Admin profile.

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('super_admin','admin','waiter','chef','cashier'));

-- Example: promote an existing profile after replacing EMAIL below.
-- update public.profiles
-- set role='super_admin'
-- where id=(select id from auth.users where email='YOUR_EMAIL');
