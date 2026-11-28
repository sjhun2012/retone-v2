CREATE TABLE IF NOT EXISTS retone_v2.push_devices (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES retone_v2.users(id) ON DELETE CASCADE,
    session_token UUID NOT NULL REFERENCES retone_v2.auth_sessions(token) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK(platform IN ('android','web')),
    token TEXT NOT NULL UNIQUE CHECK(length(token) BETWEEN 20 AND 4096),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS push_devices_user_idx ON retone_v2.push_devices(user_id);
CREATE TABLE IF NOT EXISTS retone_v2.push_jobs (
    notification_id BIGINT NOT NULL REFERENCES retone_v2.user_notifications(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES retone_v2.push_devices(id) ON DELETE CASCADE,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_until TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    outcome TEXT,
    PRIMARY KEY(notification_id,device_id)
);
CREATE INDEX IF NOT EXISTS push_jobs_pending_idx ON retone_v2.push_jobs(next_attempt) WHERE completed_at IS NULL;
