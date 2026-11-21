import { svg } from './dom';

const twinkle = (x: number, y: number, r: number, delay: number): SVGElement =>
  svg('circle', { cx: x, cy: y, r, class: 'art-fill twinkle', style: `animation-delay:${delay}s` });

const sparkle = (x: number, y: number, scale: number, delay: number): SVGElement =>
  svg('path', {
    d: 'M0 -10Q1 -1 10 0Q1 1 0 10Q-1 1 -10 0Q-1 -1 0 -10Z', class: 'art-fill twinkle',
    transform: `translate(${x} ${y}) scale(${scale})`, style: `animation-delay:${delay}s`,
  });

/** Algemeen sprookjeskasteel als silhouet: torens, kantelen en vlaggetjes. Geen bestaand Disney-ontwerp. */
function fairytaleSkyline(): SVGElement {
  const f = (name: string, attrs: Record<string, string | number>): SVGElement => svg(name, { class: 'art-fill', ...attrs });
  const crenels: SVGElement[] = [];
  for (let x = 44; x < 256; x += 16) crenels.push(f('rect', { x, y: 74, width: 8, height: 7 }));
  return svg('svg', { class: 'hero-art', viewBox: '0 0 300 124', 'aria-hidden': 'true' },
    f('rect', { x: 40, y: 80, width: 220, height: 44 }), ...crenels,
    f('rect', { x: 130, y: 40, width: 40, height: 84 }), f('polygon', { points: '125,40 150,6 175,40' }),
    f('rect', { x: 149, y: -4, width: 2, height: 12 }), f('polygon', { points: '151,-4 163,0 151,4' }),
    f('rect', { x: 70, y: 56, width: 26, height: 68 }), f('polygon', { points: '66,56 83,28 100,56' }),
    f('rect', { x: 204, y: 56, width: 26, height: 68 }), f('polygon', { points: '200,56 217,28 234,56' }),
    f('rect', { x: 30, y: 66, width: 16, height: 58 }), f('polygon', { points: '27,66 38,46 49,66' }),
    f('rect', { x: 254, y: 66, width: 16, height: 58 }), f('polygon', { points: '251,66 262,46 273,66' }),
    svg('path', { class: 'art-hole', d: 'M143 96a7 7 0 0 1 14 0v28h-14z' }),
    svg('rect', { class: 'art-hole', x: 79, y: 74, width: 8, height: 12, rx: 4 }),
    svg('rect', { class: 'art-hole', x: 213, y: 74, width: 8, height: 12, rx: 4 }),
    sparkle(246, 20, 1.1, 0), sparkle(52, 24, 0.8, 0.9), twinkle(98, 12, 1.8, 0.4), twinkle(200, 10, 1.6, 1.4), twinkle(286, 52, 1.6, 0.7));
}

/** Bergen, golven en een ijskristal voor het tweede park. */
function iceAndWater(): SVGElement {
  const f = (name: string, attrs: Record<string, string | number>): SVGElement => svg(name, { class: 'art-fill', ...attrs });
  const arm = (deg: number): SVGElement =>
    svg('g', { transform: `rotate(${deg})` },
      svg('path', { class: 'art-stroke', d: 'M-17 0H17M-11 -5L-6 0L-11 5M11 -5L6 0L11 5', fill: 'none' }));
  return svg('svg', { class: 'hero-art', viewBox: '0 0 300 124', 'aria-hidden': 'true' },
    f('polygon', { points: '0,124 46,66 78,98 128,38 184,104 222,72 262,112 300,92 300,124', 'fill-opacity': 0.55 }),
    f('polygon', { points: '128,38 142,58 134,56 128,66 122,56 114,58', 'fill-opacity': 0.9 }),
    svg('g', { transform: 'translate(236 36)' }, arm(0), arm(60), arm(120)),
    f('path', { d: 'M0 104Q25 92 50 104T100 104T150 104T200 104T250 104T300 104V124H0Z' }),
    svg('path', { class: 'art-stroke', fill: 'none', d: 'M0 114Q25 104 50 114T100 114T150 114T200 114T250 114T300 114', 'stroke-opacity': 0.5 }),
    twinkle(60, 22, 1.8, 0.2), twinkle(110, 12, 1.4, 1.1), twinkle(180, 20, 1.8, 0.6), twinkle(280, 20, 1.5, 1.6), sparkle(24, 40, 0.7, 0.9));
}

export function parkArt(parkId: string): SVGElement {
  return parkId === 'dlp-studios' ? iceAndWater() : fairytaleSkyline();
}

/** Klein parkicoontje (lijnicoon, kleurt mee met de tekst): kasteel voor Disneyland Park, ijskristal voor Adventure World. */
export function parkIcon(parkId: string, size = 18): SVGElement {
  const d = parkId === 'dlp-studios'
    ? ['M12 3v18', 'M4.2 7.5l15.6 9', 'M4.2 16.5l15.6-9', 'M9.5 4.5L12 7l2.5-2.5', 'M9.5 19.5L12 17l2.5 2.5']
    : ['M4 21V11l2-2 2 2v3h2V7l2-4 2 4v7h2v-3l2-2 2 2v10z', 'M10.5 21v-3a1.5 1.5 0 0 1 3 0v3'];
  return svg('svg', { class: 'ico park-ico', width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    ...d.map((p) => svg('path', { d: p })));
}
