-- Hiscores van het spelletje tijdens het wachten. Eén regel per profiel + naam + spel, met alleen de beste score.
-- Zo groeit de tabel niet mee met het aantal gespeelde potjes (zuinig met D1).
CREATE TABLE game_scores (
  game        TEXT NOT NULL,
  profile_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  score       INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (game, profile_id, name)
);
CREATE INDEX game_scores_top ON game_scores (game, score DESC, updated_at);
