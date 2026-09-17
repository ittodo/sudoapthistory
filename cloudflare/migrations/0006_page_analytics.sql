CREATE TABLE page_events (
 id TEXT PRIMARY KEY,
 created_at INTEGER NOT NULL
);
CREATE INDEX page_events_created ON page_events(created_at);
CREATE TABLE page_daily (
 day TEXT NOT NULL,
 path TEXT NOT NULL,
 views INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(day,path)
);
