-- Wachttijdgeschiedenis, door ParkPilot zelf bijgehouden (de bron biedt alleen de actuele stand).
CREATE TABLE wait_state (
  park_id       TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  wait          INTEGER,
  status        TEXT NOT NULL,
  prev_wait     INTEGER,
  changed_at    INTEGER NOT NULL,
  first_seen_at INTEGER NOT NULL,
  PRIMARY KEY (park_id, entity_id)
);

CREATE TABLE wait_log (
  park_id   TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  at        INTEGER NOT NULL,
  wait      INTEGER,
  status    TEXT NOT NULL
);
CREATE INDEX idx_wait_log_entity ON wait_log(park_id, entity_id, at);
CREATE INDEX idx_wait_log_at ON wait_log(at);
