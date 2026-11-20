-- Instellingen voor de hele installatie (niet per profiel), bijvoorbeeld of de server wachttijdhistorie bijhoudt.
CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
