CREATE TABLE admin_audit_log (id TEXT PRIMARY KEY,actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,created_at TEXT NOT NULL,target_id INTEGER NOT NULL,page_id TEXT NOT NULL,action TEXT NOT NULL,before_state TEXT NOT NULL,after_state TEXT NOT NULL,reason TEXT,request_id TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL);
CREATE INDEX admin_audit_created ON admin_audit_log(created_at);
CREATE INDEX admin_audit_target ON admin_audit_log(target_id,created_at);
