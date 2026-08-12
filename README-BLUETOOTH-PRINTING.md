# Brottta POS - Bluetooth Receipt Printing

## Receipt format
The 80mm bill includes:
- BROTTTA logo converted to black/white for ESC/POS printing
- Date and time
- Order number
- Dine-In / Takeaway (Parcel)
- Table and chair/group for Dine-In
- Customer name for Takeaway when available
- Item, quantity and amount
- Total amount
- Payment mode when already paid
- `Powered by HighLoops.in`
- `www.highloops.in`

The BROTTTA logo is also shown on the login screen, application header and dashboard.

## Bluetooth connection

Use the `Connect Printer` button from the top header or Billing page.

The direct Bluetooth implementation uses the browser Web Bluetooth API and ESC/POS commands. It works with printers that expose a BLE GATT writable characteristic.

Recommended test:
1. Open the POS using Chrome/Edge on Android.
2. Turn on Bluetooth and the thermal printer.
3. Open Billing.
4. Tap `Connect Printer`.
5. Select the thermal printer.
6. Tap `Print Bill`.

### Important printer compatibility
Some 80mm POS printers advertise "Bluetooth" but only implement Bluetooth Classic/SPP. Chrome Web Bluetooth only talks to BLE/GATT devices. If your printer is Bluetooth Classic only, the app automatically offers **Browser/System Print** as a fallback after direct Bluetooth fails.

For guaranteed direct printing to a Bluetooth Classic thermal printer, package the POS as an Android APK with a native Bluetooth/ESC-POS plugin.

## Browser printing fallback

If Bluetooth direct printing fails, choose **OK** when the app asks to use browser/system printing. The receipt opens in an 80mm print layout with the same logo and bill fields.

## GitHub/Vercel
Do not upload:
- `node_modules`
- `.env`
- `dist`

Keep these Vercel environment variables:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
