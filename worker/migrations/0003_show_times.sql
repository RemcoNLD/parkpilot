-- Showtijden die ParkPilot ooit gezien heeft. Daarmee kan de app voor een volgende dag verwachte tijden tonen
-- als ThemeParks.wiki er nog geen levert.
CREATE TABLE show_seen (
  park_id   TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  start_at  INTEGER NOT NULL,
  seen_at   INTEGER NOT NULL,
  PRIMARY KEY (park_id, entity_id, start_at)
);
CREATE INDEX idx_show_seen_park ON show_seen(park_id, start_at);
