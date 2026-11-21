-- Kijkplekken voor shows die in de bron geen locatie hebben. Door gebruikers ter plekke vastgelegd
-- (lang drukken op de show), en gedeeld met iedereen. Eén plek per show; de laatste opslag wint.
CREATE TABLE user_locations (
  park_id     TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  accuracy_m  REAL,
  profile_id  TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (park_id, entity_id)
);
