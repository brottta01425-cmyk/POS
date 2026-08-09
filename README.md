# Brottta Restaurant POS v2

## Main workflow
1. Waiter selects a table.
2. Waiter adds food and sends a ticket to kitchen.
3. The same table can receive unlimited additional order tickets.
4. The waiter sees the complete open table history and running total.
5. Chef sees every ticket separately and marks it READY.
6. Waiter sees which table's ticket is ready and marks it SERVED.
7. When the customer is done, waiter clicks **CLOSE TABLE & SEND BILL TO CASHIER**.
8. The cashier receives one consolidated bill for the entire table. There is no CASH/UPI/CARD prompt when the waiter closes the table.
9. Cashier collects payment and marks the complete table PAID.

## Dark theme
Use the Light/Dark button in the top-right. The choice is saved in the browser.

## Setup
npm install
copy .env.example .env
npm run dev

Then run `supabase/schema.sql` in the Supabase SQL Editor.


## Automatic table reset
A table follows this lifecycle:

OPEN → waiter closes table → BILL_REQUESTED → cashier collects payment → PAID/RESET.

The historical orders remain in Supabase for analytics. The table has no active session after payment, so it is available for a completely new order. The waiter does not need to manually delete or clear old orders.


# Brottta POS v4 changes

## Run the updated database migration
Run `supabase/schema.sql` in Supabase SQL Editor. This adds:
- Per-item kitchen status (`NEW`, `PREPARING`, `READY`, `SERVED`)
- Seat selection (`ENTIRE TABLE` or Chair 1-4 / combinations)
- Seat labels on every order
- Served timestamps

## New workflow
1. Waiter selects a table.
2. Waiter selects Entire Table or one/more chairs.
3. Each ticket is sent to kitchen with its seat label.
4. Chef updates each item independently; items can be made Ready immediately or moved through Preparing.
5. Kitchen INSERT and waiter READY events trigger a short sound and the UI also auto-refreshes every 5 seconds.
6. Waiter can remove individual items until the table is closed/billed.
7. Waiter sees green Ready/Served badges and red Pending/Preparing badges per item.
8. Closing a table sends the complete table bill to cashier.
9. Cashier payment marks the session PAID and the table is automatically available for a new session.
10. Menu management now uses a side drawer for Add/Edit, plus Enable/Disable and Delete.

Note: browser sound notifications require the device/browser to allow audio. The first login/user interaction provides the required browser interaction for most devices.


## v5 additions
- Menu stock control (`out_of_stock`) so unavailable food is hidden from waiter ordering.
- Order/bill date and time.
- Cash / Online Payment selection at cashier.
- Payment method stored against paid bills.
- Date-range sales analytics with Cash vs Online totals.
- Historical paid bills remain available for trend reporting.
- Run the updated `supabase/schema.sql` before using v5.
