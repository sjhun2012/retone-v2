ALTER TABLE retone_v2.room_members
    ADD COLUMN IF NOT EXISTS notifications_muted BOOLEAN NOT NULL DEFAULT FALSE;
