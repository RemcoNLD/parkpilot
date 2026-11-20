import { svg } from './dom';

const PATHS: Record<string, string[]> = {
  coaster: ['M2 19c4 0 3-13 7-13s3 11 7 11 3-8 6-8', 'M2 21h20'],
  boat: ['M3 15h18l-2.5 4.5h-13z', 'M12 4v10', 'M12 5l6 8h-6'],
  spin: ['M20 12a8 8 0 1 1-2.6-5.9', 'M20 4v5h-5'],
  drop: ['M12 3v13', 'M7 12l5 5 5-5', 'M5 21h14'],
  dark: ['M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z'],
  interactive: ['M12 3a9 9 0 1 0 0.01 0z', 'M12 8a4 4 0 1 0 0.01 0z', 'M12 12h.01'],
  family: ['M12 3a9 9 0 1 0 0.01 0z', 'M8 14c1 2.2 7 2.2 8 0', 'M9 9.5h.01', 'M15 9.5h.01'],
  pin: ['M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z', 'M12 8a2.5 2.5 0 1 0 0.01 0z'],
  show: ['M12 3l2.3 5.7L20 10l-4.5 3.9L17 20l-5-3.2L7 20l1.5-6.1L4 10l5.7-1.3z'],
  simulator: ['M5 19c0-6.5 5-12.5 14-14 0 9-7.5 14-14 14z', 'M9 15l-3.5 3.5', 'M14.5 9.5h.01'],
  warn: ['M12 3l10 18H2z', 'M12 10v5', 'M12 18h.01'],
  moon: ['M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z'],
  wrench: ['M14.5 6.5a4 4 0 0 0 5 5L13 18a2.8 2.8 0 0 1-4-4z', 'M7 21l3-3'],
  sun: ['M12 8a4 4 0 1 0 0.01 0z', 'M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M2 12h2', 'M20 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4'],
  refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 4v7h-7'],
  gear: ['M12 9a3 3 0 1 0 0.01 0z', 'M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z'],
  door: ['M5 21V4h9l5 2v15', 'M3 21h18', 'M11 12h.01'],
  gauge: ['M4 17a8 8 0 1 1 16 0', 'M12 17l4-5'],
  bolt: ['M13 2L5 14h6l-1 8 8-12h-6z'],
};

const KIND_ICON: Record<string, string> = {
  Achtbaan: 'coaster', Boottocht: 'boat', Draairit: 'spin', Valtoren: 'drop', 'Donkere rit': 'dark',
  Interactief: 'interactive', Kinderen: 'family', Familie: 'family', Wandeling: 'pin', Show: 'show', Simulator: 'simulator',
};

export const iconForKind = (kind: string | undefined): string => (kind && KIND_ICON[kind]) || 'pin';

export function icon(name: string, size = 16): SVGElement {
  return svg('svg', {
    class: 'ico', width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  }, ...(PATHS[name] ?? PATHS.pin).map((d) => svg('path', { d })));
}
