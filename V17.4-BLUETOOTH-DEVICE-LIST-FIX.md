# Bluetooth paired-device list fix

The previous native Capacitor plugin requested Android Bluetooth permission using the plugin method name as the permission callback. On Android 12+ this can prevent the paired-device list from refreshing after the Nearby devices permission prompt.

v17.4 changes:
- Uses proper Capacitor `@PermissionCallback` handlers.
- Requests `BLUETOOTH_CONNECT` for paired device listing and Bluetooth Classic/SPP connection.
- Removes unnecessary active scanning permission from this workflow.
- Removes `cancelDiscovery()` so the app does not require `BLUETOOTH_SCAN`.
- Shows a clear message when Android returns no paired devices.

After upgrading:
1. Run `npm install`.
2. Run `npm run android:sync`.
3. Open Android Studio using `npm run android:open`.
4. Uninstall the old Brottta POS app from the tablet before installing the new build, or go to App Info → Permissions and enable Nearby devices.
5. Pair the printer in Android Settings.
6. Brottta → Billing → Bluetooth → Refresh Paired Devices.
