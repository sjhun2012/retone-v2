# Re:Tone v2

Rust/Axum server, PostgreSQL 16 database, and a JavaScript web client. This repository includes the combined app and its safety/regression fixes.

## Run locally

Install Rust 1.100, Node.js 22 or later, and PostgreSQL. Set the variables listed in `.env.example` in the process environment. The application does not automatically load a `.env` file.

```sh
cargo build --locked
RETONE_INSECURE_COOKIES=true PORT=4000 cargo run --locked
```

`DATABASE_URL` is required. Startup applies the idempotent core schema and the safety migration. Do not point a local test runner at production data.

## Required secrets

- `RETONE_PHONE_SECRET`: a stable random secret of at least 32 characters. Existing `phone:` records are migrated to keyed HMAC-SHA256 without changing passwords. Keep this secret backed up; changing it requires a deliberate account migration.
- `RETONE_ADMIN_PASSWORD`: a random administrator password of at least 16 characters. There is no built-in administrator password or signup shortcut.
- `RETONE_ADMIN_TOTP_SECRET`: a random Base32 key representing at least 20 random bytes. First log in with the administrator password and leave the OTP field empty to enroll an authenticator using the protected QR screen. Subsequent logins require the current six-digit OTP. Accepted codes cannot be replayed. Five failures lock administrator login for 15 minutes.

Administrator access uses its own HttpOnly, Secure, SameSite=Strict session cookie and expires after eight hours. Administrator APIs require that session; modifying browser storage does not grant privileges. Credentials are never sent in query strings.

## Optional integrations

`OPENAI_API_KEY` enables AI features. Account and room settings are persisted in PostgreSQL and checked again by the server before any AI provider request. Turning off AI is authoritative across devices. General chat still works with AI off or the API key absent.

Photos are stored privately in PostgreSQL by default (PNG/JPEG/WebP, 2 MB per image, 30 MB per account). If all three Cloudinary variables are present, the existing Cloudinary integration is used instead. Room images require room membership. Profile images require the owner, a friend, or a shared-room participant. AI image review is controlled by the user's AI settings.

## Data and time

API schedule timestamps use ISO 8601 with a timezone. Browsers send an explicit UTC instant and render it in the device's local timezone. Legacy schedule strings are interpreted as Korean local time. Migration 2 corrects the earlier UTC interpretation once only.

Chat opens the most recent 50 messages. Earlier history is loaded explicitly; synchronization transfers changed/deleted messages using a monotonically increasing event cursor. The server keeps no more than 100 context messages per room in memory. All history remains in PostgreSQL.

Agreement responses and emoji reactions are unique per person. Schedule proposals and approvals are serialized with database row locks so concurrent approvals are retained.

## Checks and deployment

```sh
cargo test --locked
npm install
npm test
# Run a local server with a disposable database first:
npm run test:api
```

GitHub Actions runs the Rust tests, frontend regressions, a previous-schema upgrade, and local API checks. The API tests create test accounts and reject nonlocal targets. The Docker build uses the same pinned Rust toolchain and lockfile. `/api/health` runs a bounded, read-only database check and never performs migrations.

Render uses the existing `retone-v2` service and `main` branch. Configure secrets only in Render. `RETONE_INSECURE_COOKIES=true` is for local HTTP testing and must be absent in production. Free database expiry is a hosting-plan limitation; monitor the database's expiry separately from application releases.
