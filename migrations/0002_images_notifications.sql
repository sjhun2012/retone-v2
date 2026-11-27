CREATE TABLE IF NOT EXISTS retone_v2.message_images (
    message_id UUID PRIMARY KEY REFERENCES retone_v2.messages(id) ON DELETE CASCADE,
    mime TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp','image/gif')),
    payload BYTEA NOT NULL CHECK (octet_length(payload) BETWEEN 1 AND 8388608)
);

CREATE TABLE IF NOT EXISTS retone_v2.user_notifications (
    id BIGSERIAL PRIMARY KEY,
    recipient_id UUID NOT NULL REFERENCES retone_v2.users(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES retone_v2.users(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('friend_request','friend_accepted','room_invite')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    room_id UUID REFERENCES retone_v2.rooms(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS user_notifications_recipient_idx ON retone_v2.user_notifications(recipient_id,id);
