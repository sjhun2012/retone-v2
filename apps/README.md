# Re:tone installable apps

These are established web-app packaging approaches: Windows uses an Edge/Chrome app window, Android uses a Trusted Web Activity (AndroidX Browser), and iOS uses a Safari home-screen web app. They run the existing production application at https://retone-v2-mygr.onrender.com/ and introduce no separate account system or backend. They require an internet connection.

Names: the application display name is **Re:tone**. Windows forbids `:` in file and shortcut names, so those use **Retone**. Downloads are `InstallRetone.exe` and `InstallRetone.apk`. iOS installation is via Safari > Share > Add to Home Screen; there is no IPA or App Store listing.

## Updates

Web features are the single source of truth. After a normal web deployment, reopening or refreshing an app loads the deployed version. A service worker uses network-only/no-store for navigations, JavaScript and CSS; it caches only the disconnected notice and leaves all API requests alone. It does not force reload during a call or while composing. Native binaries do not need rebuilding for web-only features and their bytes do not change when server code changes. Changes to the native launcher, icon, URL or packaging require a new build and reinstall/update. Use a higher Android versionCode for native releases.

## Placeholder icon

Logo design was deferred at the user's request. `apps/shared/icon.png` is a generic operating-system application placeholder, shared by the Windows, Android and PWA packages. Replace that one PNG and run the build to update all package icons. Existing app icons may need reinstalling to refresh OS caches.

## Build

On Windows, install Python, .NET Framework 4.x, JDK 21, Android SDK platform 36 and build tools 36.0.0. Set `ANDROID_HOME` and `RETONE_JAVA_HOME` if their paths differ. Run:

```powershell
python apps/build_apps.py
node --test tests/installable-apps.cjs
```

The script uses existing official Maven artifacts from the local Gradle cache when available, or downloads AndroidX Browser 1.4.0 and Core 1.13.1 from Google's Maven repository. No Gradle or API keys are needed. APKs are architecture-independent (no native libraries).

Builds are saved directly to `public/downloads/`. The build verifies Windows installer resource extraction byte-for-byte, browser discovery, APK signature, alignment, display name, application ID and target SDK. It writes the actual signing-certificate SHA-256 into `public/.well-known/digitalassetlinks.json`, which must be deployed on the production origin. Without this verification Android may show a browser toolbar. An installed up-to-date browser supporting TWA is required; unsupported devices fall back to their browser.

The release keystore and password configuration are generated once under `.local/`. **Keep a private backup of both files**, outside Git. Never commit them or publish them with downloads. If they are lost, a replacement key cannot update the existing installed Android application. Builds refuse to generate over an existing key with missing configuration. Publish only the public certificate fingerprint, never the key/password.

Windows installer is currently unsigned and may show an unknown-publisher prompt. Android is signed with the project release key for direct installation; Google Play publication is a separate step. No store accounts or paid signing service have been configured.

## Checks and deployment

`tests/installable-apps.cjs` executes the service worker in an isolated harness to verify fresh navigation/assets, offline fallback and API exclusion. It checks installer download hashes and APK certificate association. Existing frontend checks continue to run because the chat code is unchanged. CI checks source and downloaded-package integrity. Native installation and camera/microphone/notification behavior still need physical Windows/Android/iOS device checks; do not claim emulator or device coverage from package checks alone.

Merge the tested change into `main`, follow the existing Render auto-deploy, then check `/api/health`, `/install.html`, `/manifest.webmanifest`, `/.well-known/digitalassetlinks.json`, and both downloads. Deploying these static additions does not migrate or change accounts or chat data.
