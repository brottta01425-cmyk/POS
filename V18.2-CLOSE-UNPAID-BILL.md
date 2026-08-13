# v18.2 Close / Delete Unpaid Bill

In the Billing section, each unpaid dine-in or takeaway bill now has:

`✕ DELETE UNPAID BILL`

Tapping it shows a confirmation popup:

`Are you sure you want to delete this unpaid bill?`

If confirmed:
- order status becomes CANCELLED
- order items become CANCELLED
- bill disappears from active Billing
- if it is the last open dine-in bill for that table session, the table is reset and becomes available again

Paid bills cannot be deleted.
