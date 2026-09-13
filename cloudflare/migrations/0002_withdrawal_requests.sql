CREATE TABLE withdrawal_requests (
 id TEXT PRIMARY KEY,
 user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 session_hash TEXT,
 identity_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','ready','processing','complete','unconfirmed','cancelled')),
 account_withdrawn INTEGER NOT NULL DEFAULT 0,
 recovery_deadline INTEGER,
 generation INTEGER NOT NULL DEFAULT 0,
 encrypted_token TEXT,
 token_expires_at INTEGER,
 expires_at INTEGER NOT NULL,
 lock_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX withdrawal_expiry ON withdrawal_requests(expires_at);
CREATE INDEX withdrawal_identity ON withdrawal_requests(identity_hash,status,lock_until);
ALTER TABLE oauth_states ADD COLUMN withdrawal_id TEXT;
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','withdrawn','purging'));
ALTER TABLE users ADD COLUMN withdrawn_at INTEGER;
ALTER TABLE users ADD COLUMN recovery_deadline INTEGER;
ALTER TABLE users ADD COLUMN withdrawal_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN withdrawal_request_id TEXT;
CREATE INDEX users_withdrawal_expiry ON users(status,recovery_deadline);
CREATE INDEX likes_user ON comment_likes(user_id);
CREATE INDEX votes_user ON tag_votes(user_id);
CREATE INDEX tags_creator ON tags(created_by);
CREATE TABLE recovery_tickets (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 generation INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 consumed_session_hash TEXT
);
CREATE INDEX recovery_expiry ON recovery_tickets(expires_at);
UPDATE schema_metadata SET version=2 WHERE version=1;
