# Brottta POS printer modes

Billing now has System, USB, Bluetooth and Wi-Fi modes.

- System: normal Android/desktop print dialog; most universally compatible.
- USB: direct WebUSB ESC/POS where Chrome/Edge and the printer expose a compatible USB interface. Android tablet must support USB OTG/Host.
- Bluetooth: direct Web Bluetooth only when the printer supports BLE/GATT.
- Wi-Fi: stores printer IP/port. A Vercel-hosted HTTPS webpage cannot open raw TCP port 9100, so website Wi-Fi mode uses system printing. Direct/silent Wi-Fi ESC/POS requires an Android/native wrapper or local print bridge.

Receipt includes the Brottta logo, date/time, order number, Dine-In/Takeaway, table/chairs, items, quantities, amounts, total, payment mode, and Powered by HighLoops.in.
