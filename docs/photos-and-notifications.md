# Photos and social notifications

Chat photos no longer require Cloudinary credentials. The client prepares photos up to 32 MiB and reduces large inputs to at most 1920 pixels and about 1.4 MB. Small JPEG/PNG/WebP/GIF images retain their original bytes. Unsupported encodings produce a specific conversion hint. If the AI check is unavailable, the UI says so and requires an explicit choice before sending without that check.

The message and its binary image are stored in one PostgreSQL transaction. The authenticated image endpoint checks room membership and message visibility and serves a fixed image MIME type with private/no-store and nosniff headers. Chat metadata contains a relative image path rather than a large inline data URL. Previous Cloudinary image URLs continue to render. Upload JSON routes permit 12 MiB to account for base64 overhead; decoded images are restricted to 8 MiB and plain message text retains a 2 MiB bound. Profiles still use their existing avatar storage path.

Friend requests, acceptance and room invitations create durable recipient-specific events in the same transaction as the corresponding action. A transaction advisory lock orders event IDs through commit so cursors cannot skip an earlier uncommitted event. Repeated requests/acceptances/invites do not create duplicate alerts. Blocked actors are omitted. A user can only read or acknowledge their own notifications.

The running app polls this independent notification stream even while a chat room is open. Desktop uses standard system notifications or service-worker notifications; the Android app uses its existing private native-notification bridge. Users must enable device notifications. The notification center provides history, read state and navigation to the friend or room. Cursor storage is scoped by account, and account changes invalidate outstanding results.

## Closed-app push integration

Firebase project and Android/web registrations are complete. The transport, authenticated device enrollment, durable retry queue, web service worker and Android Firebase messaging service are implemented in the push integration. See `push-notifications.md` for private server configuration and Android 1.2 release steps. Do not describe running-app polling or a build-only check as successful closed-app delivery. The original Android 1.1 package still requires its one-time native update.
