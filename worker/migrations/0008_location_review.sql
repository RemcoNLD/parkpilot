-- Controle van kijkplekken door de beheerder (sinds 0.23.0).
-- user_locations.confirmed: 1 = door de beheerder bevestigd, 0 = nog niet (wel al in gebruik).
ALTER TABLE user_locations ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0;

-- Elke opslag, vervanging of verwijdering van een kijkplek is een inzending. Dit is ook de geschiedenis.
--   kind:   new (eerste plek, meteen in gebruik) | replace (vervangen, pas na akkoord) | delete (pas na akkoord)
--   status: pending | approved | rejected | superseded (vervangen door een nieuwere inzending van dezelfde persoon)
--   flags:  JSON-lijst, bijv. ["far","edge","weak"]; dist_m = afstand tot de plek die er toen stond
--   prev_*: de plek die er stond toen de inzending binnenkwam
CREATE TABLE location_submissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  park_id     TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  kind        TEXT NOT NULL,
  lat         REAL,
  lng         REAL,
  accuracy_m  REAL,
  profile_id  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  flags       TEXT NOT NULL DEFAULT '[]',
  dist_m      REAL,
  prev_lat    REAL,
  prev_lng    REAL,
  prev_accuracy_m REAL,
  decided_at  INTEGER
);
CREATE INDEX location_submissions_status ON location_submissions (status, created_at);
CREATE INDEX location_submissions_entity ON location_submissions (park_id, entity_id, status);

-- Bestaande plekken (van vóór 0.23.0) zijn nooit gecontroleerd: als inzending klaarzetten voor de beheerder.
INSERT INTO location_submissions (park_id, entity_id, kind, lat, lng, accuracy_m, profile_id, created_at, status, flags)
  SELECT park_id, entity_id, 'new', lat, lng, accuracy_m, profile_id, updated_at, 'pending', '[]' FROM user_locations;

-- Pushberichten naar de beheer-app (Web Push). Eén regel per toestel.
CREATE TABLE admin_push_subs (
  endpoint  TEXT PRIMARY KEY,
  p256dh    TEXT NOT NULL,
  auth      TEXT NOT NULL,
  label     TEXT NOT NULL,
  added_at  INTEGER NOT NULL
);
