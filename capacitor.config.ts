import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.extrachef.app',
  appName: 'ExtraChef',
  server: {
    url: 'https://extrachef.vercel.app',
    cleartext: false
  }
};

export default config;