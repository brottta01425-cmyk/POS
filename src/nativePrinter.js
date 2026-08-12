import { Capacitor, registerPlugin } from '@capacitor/core';

const NativePrinter = registerPlugin('NativePrinter');

export const isNativeAndroid = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export const bytesToBase64 = bytes => {
  let binary = '';
  const chunk = 0x8000;
  for (let i=0;i<bytes.length;i+=chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i+chunk, bytes.length)));
  }
  return btoa(binary);
};

export async function listPairedBluetoothPrinters() {
  if (!isNativeAndroid()) return [];
  const result = await NativePrinter.listBluetoothDevices();
  return result.devices || [];
}

export async function nativePrintBluetooth(address, bytes) {
  return NativePrinter.printBluetooth({ address, data: bytesToBase64(bytes) });
}

export async function nativePrintWifi(host, port, bytes) {
  return NativePrinter.printWifi({ host, port: Number(port || 9100), data: bytesToBase64(bytes) });
}

export async function nativeTestWifi(host, port) {
  return NativePrinter.testWifi({ host, port: Number(port || 9100) });
}

export async function nativeTestBluetooth(address) {
  return NativePrinter.testBluetooth({ address });
}
