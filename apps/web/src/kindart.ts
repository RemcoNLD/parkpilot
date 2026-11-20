import { svg } from './dom';

/**
 * Eigen getekende illustratie per soort attractie voor het detailvenster. Geen foto's en geen Disney-ontwerpen:
 * foto's en officieel beeld zijn auteursrechtelijk beschermd, en dit blijft licht en werkt offline.
 */
const S = (name: string, attrs: Record<string, string | number>, ...kids: SVGElement[]): SVGElement => svg(name, attrs, ...kids);
const line = (d: string, w = 4, extra: Record<string, string | number> = {}): SVGElement =>
  S('path', { d, fill: 'none', stroke: 'var(--accent)', 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...extra });
const solid = (name: string, attrs: Record<string, string | number>, o = 0.9): SVGElement =>
  S(name, { fill: 'var(--accent)', 'fill-opacity': o, ...attrs });
const soft = (name: string, attrs: Record<string, string | number>): SVGElement =>
  S(name, { fill: 'var(--art)', 'fill-opacity': 0.28, ...attrs });
const star = (x: number, y: number, r = 2): SVGElement => solid('circle', { cx: x, cy: y, r }, 0.7);

function scene(kind: string): SVGElement[] {
  switch (kind) {
    case 'Achtbaan':
      return [
        soft('path', { d: 'M0 110V90Q40 20 90 62T170 62Q205 14 240 62T320 84V110Z' }),
        line('M0 92Q40 22 90 62T170 62Q205 14 240 62T320 84', 4),
        solid('rect', { x: 36, y: 38, width: 18, height: 10, rx: 4, transform: 'rotate(-35 45 43)' }),
        solid('rect', { x: 196, y: 24, width: 18, height: 10, rx: 4, transform: 'rotate(-20 205 29)' }),
        star(280, 24), star(120, 22), star(18, 20),
      ];
    case 'Boottocht':
      return [
        soft('path', { d: 'M0 70Q40 54 80 70T160 70T240 70T320 70V110H0Z' }),
        line('M0 84Q40 68 80 84T160 84T240 84T320 84', 3),
        line('M105 62h110l-18 20h-74z', 4),
        line('M160 62V24', 3), solid('path', { d: 'M160 26l34 28h-34z' }),
        star(40, 24), star(280, 30), star(250, 14, 1.6),
      ];
    case 'Donkere rit':
      return [
        soft('path', { d: 'M40 110V60Q160-30 280 60V110Z' }),
        line('M60 110V64Q160-12 260 64V110', 4), line('M92 110V70Q160 10 228 70V110', 3, { 'stroke-opacity': 0.6 }),
        solid('rect', { x: 130, y: 82, width: 60, height: 20, rx: 8 }),
        S('circle', { cx: 146, cy: 76, r: 5, fill: 'var(--bg)' }), S('circle', { cx: 174, cy: 76, r: 5, fill: 'var(--bg)' }),
        star(24, 26), star(296, 30), star(300, 74, 1.6),
      ];
    case 'Draairit':
    case 'Kinderen':
      return [
        soft('ellipse', { cx: 160, cy: 92, rx: 120, ry: 12 }),
        line('M160 92V30', 4),
        line('M160 36L70 56M160 36L250 56M160 36L100 24M160 36L220 24', 3),
        solid('circle', { cx: 70, cy: 62, r: 11 }), solid('circle', { cx: 250, cy: 62, r: 11 }),
        solid('circle', { cx: 100, cy: 28, r: 8 }, 0.6), solid('circle', { cx: 220, cy: 28, r: 8 }, 0.6),
        star(26, 24), star(296, 30),
      ];
    case 'Valtoren':
      return [
        soft('rect', { x: 118, y: 6, width: 84, height: 104 }),
        S('rect', { x: 118, y: 6, width: 84, height: 104, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 4 }),
        ...[26, 52, 78].map((y) => S('rect', { x: 140, y, width: 14, height: 12, fill: 'var(--accent)', 'fill-opacity': 0.5 })),
        solid('rect', { x: 166, y: 48, width: 24, height: 24, rx: 4 }),
        line('M232 28v46M220 62l12 14 12-14', 4), line('M88 28v46M76 62l12 14 12-14', 4, { 'stroke-opacity': 0.5 }),
        star(30, 24), star(296, 26),
      ];
    case 'Show':
      return [
        soft('path', { d: 'M0 0h120Q96 50 120 110H0Z' }), soft('path', { d: 'M320 0H200Q224 50 200 110h120Z' }),
        line('M120 0Q96 50 120 110', 3), line('M200 0Q224 50 200 110', 3),
        S('path', { d: 'M160 0L120 110h80z', fill: 'var(--accent)', 'fill-opacity': 0.22 }),
        solid('ellipse', { cx: 160, cy: 100, rx: 34, ry: 6 }, 0.5), star(140, 30), star(184, 40), star(160, 14, 2.4),
      ];
    case 'Simulator':
    case 'Interactief':
      return [
        soft('rect', { x: 70, y: 14, width: 180, height: 82, rx: 12 }),
        S('rect', { x: 70, y: 14, width: 180, height: 82, rx: 12, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 4 }),
        S('circle', { cx: 160, cy: 55, r: 22, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 3 }),
        line('M160 22v14M160 74v14M110 55h14M196 55h14', 3), solid('circle', { cx: 160, cy: 55, r: 4 }),
        star(40, 26), star(284, 76), star(100, 80, 1.6), star(222, 30, 1.6),
      ];
    case 'Workshop':
    case 'Wandeling':
    case 'Familie':
    default:
      return [
        soft('path', { d: 'M0 110V84Q80 54 160 84T320 70V110Z' }),
        line('M0 90Q80 60 160 90T320 76', 4),
        solid('circle', { cx: 60, cy: 54, r: 14 }, 0.5), solid('circle', { cx: 252, cy: 44, r: 18 }, 0.5),
        solid('rect', { x: 58, y: 62, width: 4, height: 18 }, 0.6), solid('rect', { x: 250, y: 56, width: 4, height: 22 }, 0.6),
        star(150, 20), star(110, 34, 1.6), star(200, 30, 1.6), star(290, 16),
      ];
  }
}

export function kindArt(kind: string): SVGElement {
  return S('svg', { class: 'kindart', viewBox: '0 0 320 110', preserveAspectRatio: 'xMidYMid slice', role: 'presentation', 'aria-hidden': 'true' }, ...scene(kind));
}
