# Brottta POS v17 — UX, Zomato, Payroll and Analytics

## Included changes

1. Cashier takeaway cancellation
   - Active takeaway/parcel orders have a compact X cancel button.
   - Paid orders cannot be cancelled.

2. Zomato takeaway source
   - Cashier can select Direct or Zomato before sending a takeaway order.
   - Zomato orders show a ZOMATO ORDER badge in Kitchen, Billing and Billing History.
   - `orders.order_source` stores DIRECT or ZOMATO.

3. Responsive popup UX
   - Food Add/Edit is a centered modal.
   - Lending is a centered modal.
   - Salary Review is a centered responsive modal.
   - Optimized for phone and tablet with compact buttons.

4. React frontend + dark default
   - Frontend remains React.js/Vite.
   - New users start in Dark Mode.
   - Users can still switch to Light Mode.

5. Orange + black theme
   - Dark background: black.
   - Light background: white.
   - Selected navigation, borders and highlights: orange.

6. Printer connection status
   - Billing shows Connected / Not connected.
   - Android Wi-Fi mode runs an actual socket connectivity test.
   - Android Bluetooth Classic mode runs an actual SPP connection test.
   - Browser BLE connection remains available where supported.

7. Attendance
   - Attendance has one Date field only.
   - Present, Half Day, Absent and Leave are supported.

8. Lending correction
   - Salary Review lists every pending lending entry with amount, remaining amount and note.
   - An untouched lending entry can be deleted.
   - A lending entry already partially deducted from salary is protected from deletion to preserve payroll history.

9. Analytics
   - Sales by hour/time of day.
   - Best sales hour.
   - Last 7 days sales/order performance.
   - Best performing day in the last 7 days.
   - Existing date filtering and CSV/Excel export remain available.

## Supabase migration

Run `SUPABASE_V17_MIGRATION.sql` once in Supabase SQL Editor before using Zomato source tracking.

## Website

```bash
npm install
npm run dev
```

For Vercel, push the updated project to the existing GitHub repository.

## Android

First setup:

```bash
npm install
npm run android:setup
npm run android:open
```

After future React changes:

```bash
npm run android:sync
npm run android:open
```

The Android printer plugin supports:
- Bluetooth Classic/SPP
- Wi-Fi ESC/POS using printer IP/port
- Web/system print fallbacks
