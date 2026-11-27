# Photos and social notifications

Chat photos no longer require Cloudinary credentials. The client prepares photos up to 32 MiB and reduces large inputs to at most 1920 pixels and about 1.4 MB. Small JPEG/PNG/WebP/GIF images retain their original bytes. Unsupported encodings produce a specific conversion hint. If the AI check is unavailable, the UI says so and requires an explicit choice before sending without that check.

The message and its binary image are stored in one PostgreSQL transaction. The authenticated image endpoint checks room membership and message visibility and serves a fixed image MIME type with private/no-store and nosniff headers. Chat metadata contains a relative image path rather than a large inline data URL. Previous Cloudinary image URLs continue to render. Upload JSON routes permit 12 MiB to account for base64 overhead; decoded images are restricted to 8 MiB and plain message text retains a 2 MiB bound. Profiles still use their existing avatar storage path.

Friend requests, acceptance and room invitations create durable recipient-specific events in the same transaction as the corresponding action. A transaction advisory lock orders event IDs through commit so cursors cannot skip an earlier uncommitted event. Repeated requests/acceptances/invites do not create duplicate alerts. Blocked actors are omitted. A user can only read or acknowledge their own notifications.

The running app polls this independent notification stream even while a chat room is open. Desktop uses standard system notifications or service-worker notifications; the Android app uses its existing private native-notification bridge. Users must enable device notifications. The notification center provides history, read state and navigation to the friend or room. Cursor storage is scoped by account, and account changes invalidate outstanding results.

## Closed-app push remains a separate dependency

The user explicitly requested notifications after the app is closed and authorized creating a new Re:tone Firebase project. Firebase has been added, but authenticated project access is not yet available in this execution session. Do not describe foreground polling as closed-app push.

Completing closed-app delivery requires a Firebase project, Android/web app registration, FCM device-token registration, a least-privilege server sending credential, server outbox/retry delivery, a web push service worker and an Android Firebase messaging service. The current Android 1.1 package does not include the Firebase Messaging SDK. It must be updated once when that integration is ready. Preserve the existing package ID `com.retone.app` and release-signing certificate. Do not use a permanent background polling service as a substitute or add paid Cloud Functions/hosting without authorization.
