import type { LatLng } from '../../packages/shared/src/index';

/**
 * Parkconfiguratie. Een extra park toevoegen = een regel hieronder.
 * De ThemeParks.wiki-ID's staan hier bewust niet hard in: ze worden bij gebruik opgezocht
 * via /destinations op naam, zodat een verkeerd onthouden ID geen stille fout wordt.
 */
export interface ParkConfig {
  id: string;
  name: string;
  timezone: string;
  center: LatLng; // bij benadering; alleen bedoeld als beginpunt voor de kaart
  destinationMatch: RegExp;
  parkMatch: RegExp;
}

export const PARKS: ParkConfig[] = [
  {
    id: 'dlp-disneyland',
    name: 'Disneyland Park',
    timezone: 'Europe/Paris',
    center: { lat: 48.8722, lng: 2.7758 },
    destinationMatch: /disneyland paris/i,
    parkMatch: /^disneyland park$/i,
  },
  {
    id: 'dlp-studios',
    name: 'Walt Disney Studios Park',
    timezone: 'Europe/Paris',
    center: { lat: 48.8683, lng: 2.7803 },
    destinationMatch: /disneyland paris/i,
    parkMatch: /walt disney studios/i,
  },
];

export const findPark = (id: string): ParkConfig | undefined => PARKS.find((p) => p.id === id);
