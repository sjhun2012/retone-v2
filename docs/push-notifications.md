# Firebase push notifications

Project: `retone-push-sjhun-20261128`. Android package: `com.retone.app`.
The checked-in Firebase client configuration is public SDK configuration. It contains no server private key or login token.

## Runtime setup

Set `RETONE_FCM_SERVICE_ACCOUNT_JSON` to the service-account JSON in the existing Render service's private environment settings. The credential must belong to this Firebase project and have permission to send FCM messages. The server signs short-lived OAuth assertions with the `firebase.messaging` scope and only contacts Google's fixed OAuth/FCM endpoints. Do not commit or serve this credential, put it into a client config file, or include it in a public build artifact.

Set `RETONE_FIREBASE_VAPID_PUBLIC_KEY` to the Web Push certificate public key from this project's Firebase Cloud Messaging settings. Enable the FCM HTTP v1 API and FCM Registration API if the project reports they are disabled. Re:tone retains its existing account system, PostgreSQL database and Render hosting.

Without a valid server credential the push transport stays disabled. Running-app notification history and system alerts continue to work. The notification center reports whether enrollment is ready, pending, unsupported or needs an Android app update.

## Delivery and account isolation

Device registrations require the existing authenticated cookie and bind a per-installation UUID and FCM token to that session. Logout deletes the session and cascades to its devices and queued jobs. Rebinding an installation removes its old recipient's queue before enrollment. Tokens never appear in API responses or logs.

Friend requests, acceptance and room invitations enqueue recipient/device jobs in the action's transaction. The worker leases one job at a time with `SKIP LOCKED`, checks active session/recipient, read state, account deletion, block state and a 24-hour expiry immediately before sending, then records success or backs off. Invalid FCM registrations are removed; transient errors retry with bounded delays. Committed actions wake the worker, so an idle server does not need a rapid polling loop.

The web service worker rechecks the current cookie and intended recipient before showing private text. Android stores the enrolled recipient in app-private preferences and rejects mismatched payloads. Native token rotation re-enrolls through the fixed authenticated Re:tone endpoint. Foreground polling remains a fallback until push enrollment succeeds. Notification tags and native seen IDs limit duplicate alerts.

## Android release

Android 1.2.0 (version code 3) adds Firebase Messaging to the existing System WebView app. The new package must be installed once; web features continue updating from the server afterward. The application ID and original release-signing certificate must stay unchanged.

The `Build Android push app` workflow builds an **unsigned** release using Gradle 8.13, AGP 8.13.0 and Firebase Messaging 25.1.0. No release private key enters CI. Download its `Retone-Android-unsigned` artifact and sign locally:

```text
python apps/build_apps.py --only android --unsigned PATH_TO_UNSIGNED_APK
```

The signer verifies the old certificate fingerprint, APK identity, Firebase configuration and package integrity before updating `public/downloads/InstallRetone.apk` and its checksum manifest. Keep `.local/retone-release.jks` and `.local/android-signing.json` private and backed up.

## Verification

Automated checks cover RSA signatures/OAuth claims, authenticated device enrollment, account rebinding, cross-account revocation attempts, transactionally queued jobs, logout cascades, stale frontend responses, opt-out, failed enrollment fallback, service-worker recipient checks, Android compilation and the installed package hashes. Actual notification delivery on a closed physical app still requires a configured sending credential, an enrolled device with permission and a device test; a successful build alone does not establish that delivery worked.
