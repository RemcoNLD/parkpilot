-- Bron zegt voor een attractie lang niets meer (lastUpdated ouder dan 30 min): onthouden, zodat de cron
-- die overgang één keer in wait_log zet (status 'stale') en de grafiek dat stuk grijs kan tekenen.
-- Waarde: 0 = nooit stil geweest; > 0 = stil sinds dat tijdstip (s); < 0 = weer actief sinds -waarde.
-- Bij een gewone wijziging (wachttijd/status) wordt hij 0 of het nieuwe stil-tijdstip.
ALTER TABLE wait_state ADD COLUMN stale INTEGER NOT NULL DEFAULT 0;
