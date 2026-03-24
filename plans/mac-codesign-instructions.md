# macOS Code Signing Instructions for Development

## Problem
When running a packaged Electron app on macOS, you may see the error:
"`ResearchOS Installer` is damaged and can't be opened. You should move it to the Trash."

This occurs because macOS Gatekeeper blocks unsigned applications by default.

## Solution for Development
For development and testing purposes, you can create a self-signed certificate to sign your app locally.

### Step 1: Create a Self-Signed Certificate
1. Open Keychain Access (Applications → Utilities → Keychain Access)
2. From the menu bar: Keychain Access → Certificate Assistant → Create a Certificate...
3. Fill in the details:
   - Name: `ResearchOS Development Certificate`
   - Identity Type: Self Signed Root
   - Certificate Type: Code Signing
   - Let me override defaults: ✓ Checked
4. Click Continue
5. For Key Pair Size: 2048 bits (or higher)
6. Click Continue
7. For Validity Period: 3650 days (10 years) or your preferred duration
8. Click Continue
9. Leave all extensions unchecked (default)
10. Click Continue
11. Specify a location for the certificate (login keychain is fine)
12. Click Create
13. Enter your system password if prompted

### Step 2: Trust the Certificate
1. In Keychain Access, locate your new certificate under "Certificates" in the login keychain
2. Double-click the certificate to open its info window
3. Expand the "Trust" section
4. Set "Code Signing" to "Always Trust"
5. Close the window and enter your password to save changes

### Step 3: Sign Your App
After building your app with `npm run build:mac`, sign it using:

```bash
# Path to your built app
APP_PATH="out/make/zip/darwin/x64/ResearchOS-Installer-1.0.0.dmg"

# Or if you have an .app bundle:
# APP_PATH="out/make/zip/darwin/x64/ResearchOS Installer.app"

# Sign the app
codesign --sign "ResearchOS Development Certificate" --deep --force --verbose "$APP_PATH"
```

### Step 4: Verify the Signature
```bash
codesign --verify --verbose="$APP_PATH"
```

### Step 5: Test the App
You should now be able to open the app without Gatekeeper blocking it.

## Alternative: Disable Gatekeeper Temporarily (Not Recommended for Regular Use)
For quick testing only, you can temporarily disable Gatekeeper:

```bash
sudo spctl --master-disable
```

To re-enable:
```bash
sudo spctl --master-enable
```

## For Production Distribution
For actual distribution, you need:
1. An Apple Developer ID certificate (paid Apple Developer Program membership)
2. Notarization from Apple
3. Proper configuration in forge.config.js with your Apple ID credentials

## Notes
- Self-signed certificates only work on machines where the certificate is trusted
- Each developer needs to create and trust their own certificate
- This solution is for development/testing only
- For sharing with others, they would need to install and trust your certificate