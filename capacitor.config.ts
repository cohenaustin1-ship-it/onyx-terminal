// IMO Onyx Terminal — Capacitor configuration (Phase 3p.11 / Addition 3)
//
// HONEST SCOPE NOTICE
// ===================
// This is SCAFFOLDING for Capacitor (the native-shell wrapper that
// turns the Vite-built web app into iOS/Android apps). The actual
// device build requires:
//   - macOS + Xcode for iOS
//   - Android Studio + Android SDK for Android
//   - Apple Developer account ($99/year) for App Store submission
//   - Google Play Console account ($25 one-time) for Play Store
//
// None of those can be set up from this codebase alone.
//
// What this scaffolding provides:
//   - capacitor.config.ts with sensible defaults (app id, name,
//     webDir pointing at Vite's dist/, splash + status bar config)
//   - npm scripts for: cap-init, cap-sync (sync dist/ → native projects),
//     cap-open-ios, cap-open-android
//   - Notes on which Capacitor plugins to install for the features
//     this app uses (camera for receipt capture, biometric for lock
//     unlock, push for alerts, etc.)
//
// To go from this scaffold → working iOS app:
//   1. npx cap add ios       (creates ios/ directory)
//   2. npm run build         (builds dist/)
//   3. npx cap sync          (copies dist/ to ios/)
//   4. npx cap open ios      (opens Xcode)
//   5. In Xcode: configure team, signing, run on simulator
//
// Same flow for Android (cap add android, cap open android).

import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.imoonyx.terminal',
  appName: 'IMO Onyx Terminal',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    // For development, point at the Vite dev server. Comment out
    // for production builds (the web bundle then comes from webDir).
    // url: 'http://10.0.2.2:5173', // Android emulator localhost
    // url: 'http://localhost:5173', // iOS simulator
    cleartext: true,
  },
  ios: {
    contentInset: 'always',
    // We're an institutional trading app — landscape support matters
    // for chart-heavy views.
    preferredContentMode: 'mobile',
  },
  android: {
    // Edge-to-edge mode (modern Android UX)
    backgroundColor: '#000000',
    allowMixedContent: false,
    captureInput: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1000,
      launchAutoHide: true,
      backgroundColor: '#000000',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: true,
      spinnerColor: '#3DBE9A',  // COLORS.mint
      iosSpinnerStyle: 'small',
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#000000',
      overlaysWebView: false,
    },
    // Recommended plugins for IMO Onyx features:
    //   @capacitor/preferences      — keychain-backed lock state storage
    //   @capacitor/biometric-auth   — Face ID / fingerprint unlock
    //   @capacitor/push-notifications — alert notifications
    //   @capacitor/camera           — receipt capture for tax records
    //   @capacitor/share            — share trade screenshots / reports
    //   @capacitor/local-notifications — price alerts, market open reminders
  },
};

export default config;
