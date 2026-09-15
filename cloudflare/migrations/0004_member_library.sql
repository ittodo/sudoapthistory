CREATE TABLE apartment_favorites(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,apartment_id TEXT NOT NULL,name TEXT NOT NULL,region TEXT NOT NULL,district TEXT NOT NULL,created_at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1,mutation_id TEXT NOT NULL,PRIMARY KEY(user_id,apartment_id));
CREATE TABLE favorite_areas(user_id TEXT NOT NULL,apartment_id TEXT NOT NULL,area TEXT NOT NULL,PRIMARY KEY(user_id,apartment_id,area),FOREIGN KEY(user_id,apartment_id) REFERENCES apartment_favorites(user_id,apartment_id) ON DELETE CASCADE);
CREATE INDEX favorites_rank ON apartment_favorites(region,district,apartment_id);
CREATE TABLE saved_calculations(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,slot TEXT,name TEXT NOT NULL,payload TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(user_id,kind,slot));
CREATE INDEX calculations_user ON saved_calculations(user_id,updated_at);
CREATE TABLE apartment_events(id TEXT PRIMARY KEY,visit TEXT NOT NULL,apartment_id TEXT NOT NULL,area TEXT NOT NULL,kind TEXT NOT NULL,source TEXT NOT NULL,day TEXT NOT NULL,created_at INTEGER NOT NULL,bucket INTEGER NOT NULL,UNIQUE(visit,apartment_id,area,kind,bucket));
CREATE INDEX events_retention ON apartment_events(created_at);
CREATE INDEX events_day ON apartment_events(day,apartment_id,source);
CREATE TABLE apartment_daily(day TEXT NOT NULL,apartment_id TEXT NOT NULL,source TEXT NOT NULL,views INTEGER NOT NULL,sessions INTEGER NOT NULL,hearts INTEGER NOT NULL,trades INTEGER NOT NULL,calculators INTEGER NOT NULL,PRIMARY KEY(day,apartment_id,source));
