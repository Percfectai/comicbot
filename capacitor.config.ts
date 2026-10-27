import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.percfectai.comicbot",
  appName: "Comic Bot",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
