# Brottta POS v18

## Split dine-in billing
Each bill-ready dine-in order is now shown as its own bill card, even when two chair groups share the same table.

Example:
- Table 4 — CH-1&2 — Bill A
- Table 4 — CH-3&4 — Bill B

Each card has its own:
- items
- total
- Print This Bill
- Collect Payment / Cash + Print / Online + Print

Paying the last remaining bill resets the table session.

## Payroll
A new Payroll tab contains the salary/payroll functionality previously shown on Employees.

Only Super Admin has Payroll in navigation.

## Employees
Employees now focuses on:
- Employee name
- Role
- Pending lending
- Add Employee
- Review Lending
- Lending notes/comments
- Delete untouched lending entries

## Access
- Super Admin: all tabs, including Payroll.
- Admin: all normal admin tabs, but no Payroll.
- Waiter / Chef / Cashier: role-specific tabs.

Run `SUPABASE_V18_MIGRATION.sql` once before assigning `super_admin`.

## Last selected tab
The POS stores the last selected tab per role in local storage. When the user returns to the app, it restores that tab if the role is still allowed to access it.

## UI
Per-day salary input has a light-grey background for visibility.

## Updating Android app
If the Android folder already exists:

```bash
npm install
npm run android:sync
npm run android:open
```

Then rebuild/install the APK in Android Studio.

The selected page is stored locally on each device, so reopening the app returns that user role to its last permitted tab.
