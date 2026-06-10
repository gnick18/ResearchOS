# ResearchOS Companion, dev-client install + run

How to build and run the Companion phone app on iPhone and Android. The Companion
is a **dev-client** build, not Expo Go. The handwriting scanner and on-device OCR
use native modules that do not exist in Expo Go, so they only work in a real dev
build. Everything here is run from the mobile project.

```
cd ~/Desktop/ResearchOS/mobile
```

Run from the real checkout, not a `/tmp` worktree. macOS garbage-collects `/tmp`,
and a shell sitting in a deleted folder fails with `uv_cwd ENOENT` before any
command starts.

---

## One-time setup (both platforms)

1. Node 20+ and the repo cloned.
2. Install the JS + native deps once:
   ```
   cd ~/Desktop/ResearchOS/mobile
   npm install
   ```
   This is `npm`, not `pnpm` (pnpm is for `frontend/`). The native modules
   (`react-native-document-scanner-plugin`, `@react-native-ml-kit/text-recognition`,
   `expo-dev-client`) are in `package.json`, so a fresh `npm install` pulls them.

The app code is fully cross-platform. There is no iOS-only or Android-only code in
the scan/OCR path. The scanner uses Apple VisionKit on iOS and ML Kit on Android,
and the text extraction uses ML Kit on both. So the only platform difference is
the build command.

---

## Android

### Prerequisites
- Android Studio (for the SDK + an emulator image, or to manage a device).
- A JDK **17 or 21**. The Gradle build fails on Java 8. Android Studio ships a JBR
  you can point at:
  ```
  export JAVA_HOME="$HOME/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  export ANDROID_HOME="$HOME/Library/Android/sdk"
  export PATH="$ANDROID_HOME/platform-tools:$PATH"
  ```

### Build + install
- Emulator: start it from Android Studio (or `emulator -avd <name>`), then:
  ```
  npx expo run:android
  ```
- Physical device: enable USB debugging, plug it in, then the same command. It
  builds the dev-client APK, installs it, and starts Metro.

The first build is slow (Gradle downloads). After that it is fast.

### Reconnect on later runs (no rebuild needed)
Once the dev-client is installed, you only need Metro:
```
npx expo start --dev-client
```
- Emulator reaches Metro over the local bridge. If a reload cannot connect, set:
  ```
  ~/Library/Android/sdk/platform-tools/adb reverse tcp:8081 tcp:8081
  ```
  then reload (Cmd+M in the emulator, Reload).
- Physical device must be on the **same Wi-Fi as the laptop**, and that network
  must not isolate devices from each other. See Networking below.

---

## iPhone

### Prerequisites
- Xcode installed (App Store), opened once so the command-line tools are set up.
- CocoaPods (Xcode/Expo install it as needed).
- For a **physical iPhone**: signed into Xcode with your Apple ID so the build can
  sign to your device. For the **simulator**: no signing needed.

### Build + install
```
npx expo run:ios
```
- Simulator: builds + boots the simulator + installs.
- Physical iPhone: plug it in, trust the computer, then run the command (or pick
  the device in Xcode). It builds, signs to your Apple ID, and installs.

The **first** `expo run:ios` after new native deps runs `pod install`, which is
slow. After that it is the normal fast dev loop. Your existing iPhone app predates
the scanner + ML Kit packages, so you must rebuild once to pick them up.

### Reconnect on later runs
```
npx expo start --dev-client
```
iPhone and laptop on the same Wi-Fi, then open the app and reload.

---

## The daily loop

1. `npx expo start --dev-client` in `mobile/`.
2. Open the installed app on the phone, it connects to Metro.
3. Edit code, the app fast-refreshes. Press `r` in the Metro terminal for a full
   reload.

JavaScript changes (UI, logic) need only a reload. You only rebuild
(`expo run:*`) when native dependencies change.

---

## Networking (the part that bites)

The phone reaches Metro over the network, so the phone and laptop must be able to
see each other.

- **Emulator**: uses the local adb bridge, no Wi-Fi involved. If a reload fails,
  `adb reverse tcp:8081 tcp:8081`.
- **Physical device on home Wi-Fi**: works, as long as both are on that network.
- **Campus / lab Wi-Fi**: these usually isolate devices from each other, so the
  phone cannot reach the laptop even on the same SSID. The timeout looks like
  `SocketTimeoutException, failed to connect`. Fix: put both on a private network,
  the simplest being an iPhone **Personal Hotspot** with the laptop joined to it.
  The laptop IP changes when it joins, so **restart Metro** and **scan the fresh
  QR** afterward, do not reuse the old one.
- **Cellular**: a phone on cellular cannot reach a `192.168.x` laptop address. Make
  sure the phone is on Wi-Fi, not mobile data.

Quick test from the phone browser: open `http://<laptop-ip>:8081`. If it loads, the
network path is clear. If it times out, it is the network, not the app.

---

## Handwriting scan + OCR, what to expect

- The "Scan a handwritten note" button **only appears where the native scanner is
  actually linked**. On a proper dev build (iPhone or Android device) it shows and
  works. On a build that lacks the native module (an emulator image without it, or
  Expo Go), it safely hides, no crash.
- The scan dewarps + cleans the page (VisionKit on iOS, ML Kit document scanner on
  Android), runs on-device OCR (ML Kit), and the extracted text rides back to the
  laptop as a `{image}.ocr.json` sidecar so the page becomes searchable.

---

## Troubleshooting quick reference

- **`uv_cwd ENOENT` / npx fails before running**: your terminal is in a deleted
  folder. `cd ~/Desktop/ResearchOS/mobile` (or open a fresh tab).
- **Gradle / Android build fails on Java**: point `JAVA_HOME` at the Android Studio
  JBR (JDK 17/21), see Android prerequisites.
- **`SocketTimeoutException` on the phone**: network, not code. See Networking.
- **App stuck on the dev launcher**: scan the QR Metro prints, or enter the Metro
  URL manually in the dev-client.
- **Scan button missing on a device build**: the native module did not link.
  Rebuild with `expo run:*` (a plain reload does not add native modules).
- **Firewall prompt on the Mac**: the emulator path uses loopback and does not need
  it, so you can dismiss it. A physical device connecting over the LAN may need it
  allowed.
