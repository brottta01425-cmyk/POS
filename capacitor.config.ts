import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.highloops.brottta',
  appName: 'Brottta POS',
  webDir: 'dist',
  android: {
    allowMixedContent: true
  }
};

export default config;
