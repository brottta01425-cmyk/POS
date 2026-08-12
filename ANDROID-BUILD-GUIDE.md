# Brottta POS Android — Native Bluetooth + Wi-Fi Printing

This package keeps the same responsive React/Vite/Supabase POS and adds Capacitor Android support.

## Native printer support
- Wi-Fi: direct ESC/POS TCP printing to printer IP/port (default 9100).
- Bluetooth: direct Bluetooth Classic/SPP printing to a paired printer.
- Website modes remain available as fallbacks.
- Mobile/tablet responsive CSS is included.

## Requirements
- Node.js 22+
- Android Studio + Android SDK
- Android tablet/phone
- Printer and tablet on same Wi-Fi for Wi-Fi mode
- Bluetooth printer paired in Android Settings for Bluetooth mode

## First setup
Open CMD/PowerShell in this project:

1. `npm install`
2. `npm run android:setup`
3. `npm run android:open`

Android Studio opens the generated `android` project.

## Future updates
After editing the web POS:
1. `npm run android:sync`
2. Build/run again in Android Studio.

## Android printing
### Wi-Fi
Billing → Receipt Printer → Wi-Fi → enter printer IP (example `192.168.1.87`) → port `9100` → Save → Test Wi-Fi → Print Bill.

### Bluetooth
Pair the printer in Android Settings first. Then:
Billing → Receipt Printer → Bluetooth → select paired printer → Print Bill.

Bluetooth uses the standard SPP UUID:
`00001101-0000-1000-8000-00805F9B34FB`

This is intended for Bluetooth Classic ESC/POS printers such as many 58mm/80mm POS printers.

## Receipt
The bill includes:
- BROTTTA logo
- Date/time
- Order number
- Dine-In / Takeaway
- Table/chair group
- Items, quantity, amount
- Total
- Payment mode
- Powered by HighLoops.in
