CREATE TABLE IF NOT EXISTS retone_v2.schema_migrations (version INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS retone_v2.admin_auth_state (
  id SMALLINT PRIMARY KEY CHECK(id=1), failures INTEGER NOT NULL DEFAULT 0,
  blocked_until TIMESTAMPTZ, totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  last_totp_step BIGINT NOT NULL DEFAULT -1
);
INSERT INTO retone_v2.admin_auth_state(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS retone_v2.admin_sessions (
  token_hash TEXT PRIMARY KEY, expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS retone_v2.agreement_responses (
  agreement_id UUID REFERENCES retone_v2.agreements(id) ON DELETE CASCADE,
  user_id UUID REFERENCES retone_v2.users(id) ON DELETE CASCADE,
  response TEXT NOT NULL CHECK(response IN ('confirm','revise')),
  suggestion TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(agreement_id,user_id)
);
ALTER TABLE retone_v2.users ADD COLUMN IF NOT EXISTS ai_settings JSONB NOT NULL DEFAULT '{}';
ALTER TABLE retone_v2.room_members ADD COLUMN IF NOT EXISTS ai_settings JSONB NOT NULL DEFAULT '{}';
ALTER TABLE retone_v2.appointments ALTER COLUMN room_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS messages_room_created_idx ON retone_v2.messages(room_id,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS room_members_user_idx ON retone_v2.room_members(user_id,room_id);
CREATE INDEX IF NOT EXISTS reactions_message_idx ON retone_v2.message_reactions(message_id);
CREATE TABLE IF NOT EXISTS retone_v2.message_events (
 seq BIGSERIAL PRIMARY KEY, room_id UUID NOT NULL REFERENCES retone_v2.rooms(id) ON DELETE CASCADE,
 message_id UUID NOT NULL, removed BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS message_events_room_seq_idx ON retone_v2.message_events(room_id,seq);
CREATE OR REPLACE FUNCTION retone_v2.log_message_change() RETURNS TRIGGER AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  INSERT INTO retone_v2.message_events(room_id,message_id,removed) VALUES(OLD.room_id,OLD.id,TRUE);
  RETURN OLD;
 END IF;
 INSERT INTO retone_v2.message_events(room_id,message_id,removed) VALUES(NEW.room_id,NEW.id,NEW.deleted_at IS NOT NULL);
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS message_change ON retone_v2.messages;
CREATE TRIGGER message_change AFTER INSERT OR UPDATE OR DELETE ON retone_v2.messages FOR EACH ROW EXECUTE FUNCTION retone_v2.log_message_change();
CREATE OR REPLACE FUNCTION retone_v2.log_reaction_change() RETURNS TRIGGER AS $$
DECLARE target UUID;
BEGIN
 IF TG_OP='DELETE' THEN target=OLD.message_id; ELSE target=NEW.message_id; END IF;
 INSERT INTO retone_v2.message_events(room_id,message_id)
 SELECT room_id,id FROM retone_v2.messages WHERE id=target AND deleted_at IS NULL;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS reaction_change ON retone_v2.message_reactions;
CREATE TRIGGER reaction_change AFTER INSERT OR DELETE ON retone_v2.message_reactions FOR EACH ROW EXECUTE FUNCTION retone_v2.log_reaction_change();
CREATE TABLE IF NOT EXISTS retone_v2.media (
 id UUID PRIMARY KEY, owner_id UUID NOT NULL REFERENCES retone_v2.users(id) ON DELETE CASCADE,
 room_id UUID REFERENCES retone_v2.rooms(id) ON DELETE CASCADE,
 mime TEXT NOT NULL, bytes BYTEA NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Earlier builds interpreted Korean wall-clock input as UTC. Adjust once only.
WITH applied AS (INSERT INTO retone_v2.schema_migrations(version) VALUES(2) ON CONFLICT DO NOTHING RETURNING version)
UPDATE retone_v2.appointments SET starts_at=starts_at-INTERVAL '9 hours',ends_at=ends_at-INTERVAL '9 hours' WHERE EXISTS(SELECT 1 FROM applied);
