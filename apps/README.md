# Re:tone apps 1.1

Windows runs the existing site in an Edge/Chrome app window; Android uses **Android System WebView**, with no Chrome-app or Custom Tabs dependency. iOS remains a Safari home-screen web app. These are established web-app packaging methods. All clients use the existing production backend and require internet access.

Display name: **Re:tone**. Windows file/shortcut names use **Retone** because colons are forbidden. Downloads remain `InstallRetone.exe` and `InstallRetone.apk`.

## Friend QR links

New QR codes encode `https://retone-v2-mygr.onrender.com/friend.html?code=ABC123`. An ordinary camera can recognize this HTTPS URL. Android 1.1 registers verified App Links for `/friend.html`, with the existing release certificate in `public/.well-known/assetlinks.json`. The OS opens the app when its verified-link preference allows it; otherwise the page continues to the web. No-app mobile visitors continue to `/?friend=ABC123`. iOS uses this web route; the installed Safari home-screen web app is not a native iOS universal-link handler.

On desktop, `friend.html` offers an app-open prompt, a remember-choice checkbox, a persistent web fallback, and an install link. The Windows installer registers `retone://friend?code=ABC123` for the current user. Only a validated six-character friend code enters the app URL; arbitrary URLs or arguments are rejected. The checkbox remembers the site's choice. The browser controls its separate external-protocol permission prompt and may still ask. Neither JavaScript nor the installer bypasses that permission.

After login, the friend code is looked up and the normal friend-request confirmation is shown. Opening an invite never automatically sends or accepts a friend request. Old `RETONE-FRIEND:ABC123` images remain readable by the in-app scanner but cannot be made into clickable camera links retroactively; share newly generated QR codes.

**Existing installations need one update to version 1.1** to gain Android verified links/WebView hosting and the Windows protocol registration. Keep the same Android package and signing key. WebView has its own cookie store, so users may need to sign in once after migrating from the old browser-based Android app. The server account and conversations remain the same.

## WebView integration

JavaScript and DOM storage are enabled for the production site. File-system access, mixed content, and untrusted main-frame navigation are blocked. External HTTPS citations open through the user's browser. Native file selection supports documents, photos and temporary camera capture URIs. Microphone/camera permissions are granted only for the exact trusted HTTPS origin, only for recognized resources, and only after Android permission approval. Authenticated attachment downloads pass the origin's cookies to DownloadManager.

The existing web notification API is connected through a private WebMessagePort delivered to the trusted top-level origin with a per-document secret. No global JavaScript interface is exposed. Android notification permission is requested when the user enables notifications. This does not add server push or guaranteed delivery while the app is closed.

## Updates and icon

Web feature changes appear after deployment when an app reloads or reopens. The worker caches only the disconnected notice, fetches navigations/JavaScript/CSS with no-store, and leaves API traffic untouched. It never reloads an active conversation or draft automatically. Native code, URL handler, version or icon changes require rebuilding and updating the installer.

Logo design is deferred. Replace `apps/shared/icon.png` and rebuild to apply the same artwork across packages. Existing installed icons may require an app update/reinstall to refresh OS icon caches.

## Build and checks

Requirements: Windows .NET Framework 4.x C# compiler, Python, JDK 21, Android SDK platform 36 and build tools 36.0.0. Set `ANDROID_HOME` and `RETONE_JAVA_HOME` for nondefault paths. There are no third-party Android runtime dependencies and no Gradle build is required.

```powershell
python apps/build_apps.py
node --test tests/installable-apps.cjs
```

The builder checks Windows link-policy rejection cases, embedded installer extraction and shortcut creation; Android origin/link policy cases; APK release signature, alignment, package, display label, versionCode and target SDK. It writes hashes to `public/downloads/checksums.json` and the release certificate to `/.well-known/assetlinks.json` (plus the historical `digitalassetlinks.json` alias).

Keep `.local/retone-release.jks` and `.local/android-signing.json` private and backed up. Never publish them. Losing the original key prevents updates of installed Android packages. Version 1.1 uses versionCode 2; increase it for future native releases. Windows installer remains unsigned. Google Play/App Store registration is not configured.

CI runs the existing server/frontend checks, invite/prompt/download-button and notification-port tests, native origin-policy tests, and a real jsQR decode of the server's generated SVG using a local test account/database. The post-deploy workflow checks live static files, canonical asset links, API health and exact installer hashes. Package tests are not physical-device, camera, microphone, or OS link-dispatch tests; do not claim device coverage without actually running it.
