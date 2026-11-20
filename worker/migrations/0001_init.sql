-- Een profiel is "jouw lijstje". Een apparaat is een iPhone/browser die bij dat profiel hoort.
-- Zo kunnen meerdere apparaten (of een herinstallatie) hetzelfde profiel delen via de koppelcode.

CREATE TABLE profiles (
  id                  TEXT PRIMARY KEY,
  created_at          INTEGER NOT NULL,
  last_seen_at        INTEGER NOT NULL,
  recovery_hash       TEXT,            -- SHA-256 van de koppelcode; de code zelf wordt nooit bewaard
  recovery_created_at INTEGER
);
CREATE UNIQUE INDEX idx_profiles_recovery ON profiles(recovery_hash) WHERE recovery_hash IS NOT NULL;

CREATE TABLE devices (
  id           TEXT PRIMARY KEY,
  profile_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL,          -- SHA-256 van het apparaattoken
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX idx_devices_profile ON devices(profile_id);

CREATE TABLE favorites (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  park_id    TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('attraction', 'show')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, park_id, entity_id)
);

CREATE TABLE preferences (
  profile_id         TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  park_id            TEXT NOT NULL,
  sort               TEXT NOT NULL CHECK (sort IN ('distance', 'wait', 'name')),
  arrival_margin_min INTEGER NOT NULL,
  walking_speed_kmh  REAL NOT NULL,
  updated_at         INTEGER NOT NULL,
  PRIMARY KEY (profile_id, park_id)
);

-- Eenvoudige begrenzing tegen het raden van koppelcodes en het massaal aanmaken van profielen.
CREATE TABLE rate_limits (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
