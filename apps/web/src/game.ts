import type { GameId, GameScore, GameScoresResponse } from '../../../packages/shared/src/index';
import { fetchGameScores, postGameScore } from './api';
import { h } from './dom';
import { t as T } from './i18n';

// ---- Spelletje tijdens het wachten: "Ballonvlucht" -------------------------------------------
// Tik = de ballon stijgt even; zwaartekracht trekt hem omlaag. Vlieg tussen de torens door; elke toren = 1 punt.
// Zuinig: één canvas, de animatie draait alleen tijdens een potje en stopt als de app naar de achtergrond gaat.
// De server krijgt alleen een score als die beter is dan je eigen record onder die naam (weinig schrijfacties).

const GAME: GameId = 'balloon';

export interface GameQueue { name: string; time: string; canTurn: boolean }
export interface GameHooks {
  /** Rij waar je nu in staat (voor de balk bovenin), of null. */
  queue: () => GameQueue | null;
  /** "Aan de beurt" vanuit het spel: spel sluit, rij gaat naar de volgende status. */
  onTurn: () => void;
}

const store = {
  get: (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* geen opslag */ } },
};
const json = <V>(k: string, fallback: V): V => { try { return (JSON.parse(store.get(k) ?? 'null') as V) ?? fallback; } catch { return fallback; } };

export const getGameName = (): string => store.get('pp.gameName') ?? '';
const setGameName = (n: string): void => store.set('pp.gameName', n);
/** Persoonlijk record per naam, op dit toestel. */
const bests = (): Record<string, number> => json<Record<string, number>>('pp.gameBest', {});
const bestFor = (name: string): number => bests()[name] ?? 0;
function setBest(name: string, score: number): void { store.set('pp.gameBest', JSON.stringify({ ...bests(), [name]: score })); }
/** Scores die niet verstuurd konden worden (geen bereik in de rij). Worden later opnieuw geprobeerd. */
type Pending = { name: string; score: number };
const pending = (): Pending[] => json<Pending[]>('pp.gamePending', []);
function addPending(p: Pending): void {
  const list = pending().filter((x) => x.name !== p.name || x.score > p.score);
  if (!list.some((x) => x.name === p.name)) list.push(p);
  store.set('pp.gamePending', JSON.stringify(list.slice(-5)));
}
function removePending(p: Pending): void { store.set('pp.gamePending', JSON.stringify(pending().filter((x) => !(x.name === p.name && x.score <= p.score)))); }

/** Naam zoals de server hem ook opschoont: geen stuurtekens, max 16 tekens. */
function cleanName(v: string): string {
  return [...v.replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '').replace(/\s+/g, ' ').trim()].slice(0, 16).join('');
}

/** Stuurt achtergebleven scores alsnog in. Geeft de laatste lijst terug als dat lukte. */
async function flushPending(): Promise<GameScoresResponse | null> {
  let last: GameScoresResponse | null = null;
  for (const p of pending()) {
    try { last = await postGameScore(GAME, p.name, p.score); removePending(p); } catch { break; }
  }
  return last;
}

// ---- Spelwereld --------------------------------------------------------------------------------

interface Tower { x: number; gapY: number; gap: number; passed: boolean }
interface Cloud { x: number; y: number; s: number; v: number }
type Phase = 'menu' | 'play' | 'paused' | 'over';

export function openGame(hooks: GameHooks): void {
  if (document.querySelector('.game')) return;
  const css = getComputedStyle(document.documentElement);
  const col = (name: string, fb: string): string => css.getPropertyValue(name).trim() || fb;
  const C = {
    bg: col('--bg', '#0f1233'), raised: col('--raised', '#1a1f4d'), raised2: col('--raised2', '#232963'), line: col('--line', '#2f3880'),
    text: col('--text', '#ffffff'), muted: col('--muted', '#aab2dc'), accent: col('--accent', '#ffc861'), high: col('--high', '#ff7a6b'), art: col('--art', '#8a94f0'),
  };
  const dark = document.documentElement.dataset.theme !== 'light';
  /** Torens: duidelijk zichtbaar tegen de lucht, in beide thema's. */
  const stone = dark ? C.line : C.muted;

  // ---- DOM
  const qTime = h('span', { class: 'game-qtime' });
  const qName = h('span', { class: 'game-qname' });
  const turnBtn = h('button', { class: 'game-turn', onclick: () => { close(); hooks.onTurn(); } }, T.qTurn);
  const qInfo = h('div', { class: 'game-q' }, qName, qTime);
  const top = h('div', { class: 'game-top' },
    h('button', { class: 'game-x', 'aria-label': T.gameClose, onclick: () => close() }, '✕'),
    qInfo, turnBtn);
  const canvas = h('canvas', { class: 'game-canvas', 'aria-label': T.gameName });
  const panel = h('div', { class: 'game-panel' });
  const stage = h('div', { class: 'game-stage' }, canvas, panel);
  const overlay = h('div', { class: 'game', role: 'dialog', 'aria-label': T.gameAria }, top, stage);
  document.body.append(overlay);
  document.documentElement.classList.add('game-open');
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  function paintTop(): void {
    const q = hooks.queue();
    qInfo.style.visibility = q ? 'visible' : 'hidden';
    turnBtn.style.display = q?.canTurn ? '' : 'none';
    if (q) { qName.textContent = q.name; qTime.textContent = q.time; }
  }
  paintTop();
  const topTimer = window.setInterval(paintTop, 1000);

  // ---- Afmetingen (CSS-pixels; canvas scherp tot 2× pixeldichtheid)
  let W = 0, H = 0;
  function resize(): void {
    const r = stage.getBoundingClientRect();
    W = Math.max(200, r.width); H = Math.max(200, r.height);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (phase !== 'play') draw();
  }

  // ---- Spelstatus
  let phase: Phase = 'menu';
  let y = 0, vy = 0, score = 0, dist = 0;
  let towers: Tower[] = [];
  const clouds: Cloud[] = Array.from({ length: 5 }, (_, i) => ({ x: Math.random() * 500, y: 0.08 + i * 0.13, s: 0.6 + Math.random() * 0.8, v: 0.25 + Math.random() * 0.35 }));
  const R = 15; // straal ballon
  const TW = 56; // torenbreedte
  const bx = (): number => Math.min(110, W * 0.28); // vaste x van de ballon
  const speed = (): number => Math.min(250, 145 + score * 4); // px/s, wordt langzaam sneller
  const gapSize = (): number => Math.max(H * 0.21, H * 0.31 - score * H * 0.004);
  const spacing = (): number => Math.max(190, Math.min(260, W * 0.62));
  const ground = (): number => H - 26;

  function reset(): void {
    y = H * 0.42; vy = 0; score = 0; dist = 0; towers = [];
    let x = W + 40;
    for (let i = 0; i < 4; i++) { towers.push(newTower(x)); x += spacing(); }
  }
  function newTower(x: number): Tower {
    const gap = gapSize();
    const margin = 40;
    const gapY = margin + Math.random() * Math.max(10, ground() - margin * 2 - gap);
    return { x, gapY, gap, passed: false };
  }
  function flap(): void { vy = -H * 0.62; }

  // ---- Lus: alleen tijdens een potje, met tijdstap zodat 60 en 120 Hz even snel zijn
  let raf = 0, last = 0;
  function loop(now: number): void {
    const dt = Math.min(0.033, (now - last) / 1000 || 0.016);
    last = now;
    step(dt);
    draw();
    if (phase === 'play') raf = requestAnimationFrame(loop);
  }
  function startLoop(): void { cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(loop); }

  function step(dt: number): void {
    const v = speed();
    dist += v * dt;
    vy += H * 2.2 * dt;
    y += vy * dt;
    if (y < R) { y = R; vy = Math.max(0, vy); }
    for (const c of clouds) { c.x -= v * c.v * dt; if (c.x < -80) { c.x = W + 40 + Math.random() * 120; c.y = 0.06 + Math.random() * 0.5; } }
    for (const t of towers) t.x -= v * dt;
    if (towers.length && towers[0].x < -TW - 10) {
      towers.shift();
      towers.push(newTower(towers[towers.length - 1].x + spacing()));
    }
    const x = bx();
    for (const t of towers) {
      if (!t.passed && t.x + TW < x - R) { t.passed = true; score++; }
      if (hitsTower(x, y, t)) { gameOver(); return; }
    }
    if (y + R >= ground()) { y = ground() - R; gameOver(); }
  }
  /** Cirkel tegen de twee rechthoeken van een toren (boven en onder de opening). Iets vergevingsgezind. */
  function hitsTower(cx: number, cy: number, t: Tower): boolean {
    const r = R - 3;
    const rects = [[t.x, -1000, TW, t.gapY + 1000], [t.x, t.gapY + t.gap, TW, 2000]];
    return rects.some(([rx, ry, rw, rh]) => {
      const nx = Math.max(rx, Math.min(cx, rx + rw)), ny = Math.max(ry, Math.min(cy, ry + rh));
      return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
    });
  }

  // ---- Tekenen
  function draw(): void {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, dark ? C.bg : C.raised2);
    g.addColorStop(1, dark ? C.raised2 : C.raised);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // wolken
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.9)';
    for (const c of clouds) cloud(c.x, c.y * H, 22 * c.s);
    // torens
    for (const t of towers) tower(t);
    // grond
    ctx.fillStyle = C.line;
    ctx.fillRect(0, ground(), W, H - ground());
    ctx.fillStyle = C.art;
    const off = dist % 24;
    for (let x = -off; x < W; x += 24) ctx.fillRect(x, ground(), 12, 3);
    balloon(bx(), y);
    if (phase === 'play' || phase === 'paused' || phase === 'over') {
      ctx.fillStyle = C.text;
      ctx.font = '800 46px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(score), W / 2, 62);
    }
  }
  function cloud(x: number, cy: number, s: number): void {
    ctx.beginPath();
    ctx.arc(x, cy, s, 0, Math.PI * 2); ctx.arc(x + s, cy - s * 0.4, s * 0.9, 0, Math.PI * 2); ctx.arc(x + s * 2, cy, s * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  function tower(t: Tower): void {
    ctx.fillStyle = stone;
    // boven: hangt omlaag, kantelen aan de onderkant
    ctx.fillRect(t.x, 0, TW, t.gapY - 10);
    battlements(t.x, t.gapY - 10, 1);
    // onder: staat op de grond, kantelen bovenop, met puntdak-raampje
    const by = t.gapY + t.gap;
    ctx.fillRect(t.x, by + 10, TW, ground() - by - 10);
    battlements(t.x, by + 10, -1);
    ctx.fillStyle = C.accent;
    ctx.globalAlpha = 0.8;
    window_(t.x + TW / 2, by + 40);
    if (t.gapY > 70) window_(t.x + TW / 2, t.gapY - 52);
    ctx.globalAlpha = 1;
  }
  /** Kantelen: dir 1 = naar beneden (bovenste toren), -1 = naar boven (onderste toren). */
  function battlements(x: number, y0: number, dir: 1 | -1): void {
    ctx.fillStyle = stone;
    const n = 4, w = TW / (n * 2 - 1);
    for (let i = 0; i < n; i++) {
      const bx0 = x + i * w * 2;
      if (dir === 1) ctx.fillRect(bx0, y0, w, 10); else ctx.fillRect(bx0, y0 - 10, w, 10);
    }
  }
  function window_(cx: number, cy: number): void {
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy + 10); ctx.lineTo(cx - 6, cy); ctx.arc(cx, cy, 6, Math.PI, 0); ctx.lineTo(cx + 6, cy + 10); ctx.closePath();
    ctx.fill();
  }
  function balloon(x: number, cy: number): void {
    const tilt = Math.max(-0.35, Math.min(0.35, vy / (H * 2.5)));
    ctx.save();
    ctx.translate(x, cy);
    ctx.rotate(tilt);
    // touwtjes en mandje
    ctx.strokeStyle = C.muted; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-8, R * 0.7); ctx.lineTo(-5, R + 10); ctx.moveTo(8, R * 0.7); ctx.lineTo(5, R + 10); ctx.stroke();
    ctx.fillStyle = '#a0703c';
    ctx.fillRect(-6, R + 9, 12, 8);
    // ballon met strepen
    const grad = ctx.createRadialGradient(-5, -6, 2, 0, 0, R + 4);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.25, C.accent);
    grad.addColorStop(1, C.accent);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.ellipse(0, 0, R, R * 1.12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, 0, R * 0.4, R * 1.12, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // ---- Panelen (menu, pauze, einde)
  let scores: GameScore[] | null = null; // null = (nog) niet geladen
  let scoresFailed = false;
  let lastResult: { score: number; newBest: boolean; rank: number | null; saving: boolean; offline: boolean } | null = null;
  let editingName = !getGameName();

  function scoreList(): HTMLElement {
    const me = getGameName();
    const body = scores === null
      ? h('p', { class: 'game-muted' }, scoresFailed ? T.gameScoresOffline : '…')
      : scores.length === 0
        ? h('p', { class: 'game-muted' }, T.gameNoScores)
        : h('ol', { class: 'game-hs' }, ...scores.map((s, i) => h('li', { class: s.name === me ? 'me' : '' },
          h('span', { class: 'hs-n' }, `${i + 1}`), h('span', { class: 'hs-name' }, s.name), h('b', {}, String(s.score)))));
    return h('div', { class: 'game-hs-box' }, h('div', { class: 'game-hs-title' }, T.gameHiscores), body);
  }

  function nameRow(): HTMLElement {
    const name = getGameName();
    if (!editingName && name) {
      return h('div', { class: 'game-player' },
        h('span', {}, T.gamePlayer(name)),
        h('button', { class: 'game-link', onclick: () => { editingName = true; renderPanel(); } }, T.gameChange));
    }
    const input = h('input', { class: 'game-input', type: 'text', maxlength: '16', placeholder: T.gameNamePh, value: name, autocomplete: 'nickname', enterkeyhint: 'done' });
    const save = (): void => {
      const n = cleanName(input.value);
      if (!n) { input.focus(); return; }
      setGameName(n); editingName = false; renderPanel();
    };
    input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') save(); });
    setTimeout(() => input.focus(), 50);
    return h('div', { class: 'game-name' },
      h('label', { class: 'game-muted' }, T.gameNameLabel),
      h('div', { class: 'game-name-row' }, input, h('button', { class: 'game-btn small', onclick: save }, T.gameSave)));
  }

  function renderPanel(): void {
    panel.replaceChildren();
    panel.style.display = phase === 'play' ? 'none' : '';
    if (phase === 'play') return;
    const name = getGameName();
    const startBtn = (label: string): HTMLElement => h('button', { class: 'game-btn', disabled: editingName || !name ? true : null, onclick: () => start() }, label);
    if (phase === 'paused') {
      panel.append(h('div', { class: 'game-card' },
        h('div', { class: 'game-title' }, T.gamePaused),
        h('button', { class: 'game-btn', onclick: () => resume() }, T.gameResume)));
      return;
    }
    if (phase === 'menu') {
      const best = name ? bestFor(name) : 0;
      panel.append(h('div', { class: 'game-card' },
        h('div', { class: 'game-title' }, T.gameName),
        h('p', { class: 'game-muted' }, T.gameTapHint),
        nameRow(),
        best ? h('p', { class: 'game-muted' }, T.gameYourBest(best)) : null,
        startBtn(T.gameStart),
        scoreList()));
      return;
    }
    const r = lastResult;
    panel.append(h('div', { class: 'game-card' },
      h('div', { class: 'game-title' }, T.gameOver),
      h('div', { class: 'game-big' }, r ? T.gameScore(r.score) : ''),
      r?.newBest ? h('p', { class: 'game-good' }, T.gameNewBest) : name && bestFor(name) ? h('p', { class: 'game-muted' }, T.gameYourBest(bestFor(name))) : null,
      r?.saving ? h('p', { class: 'game-muted' }, T.gameSaving) : null,
      r?.offline ? h('p', { class: 'game-muted' }, T.gamePending) : null,
      r?.rank ? h('p', { class: 'game-muted' }, T.gameRank(r.rank)) : null,
      nameRow(),
      h('div', { class: 'game-actions' },
        h('button', { class: 'game-btn ghost', onclick: () => close() }, T.gameClose),
        startBtn(T.gameAgain)),
      scoreList()));
  }

  async function loadScores(): Promise<void> {
    const flushed = await flushPending();
    if (flushed) { scores = flushed.top; scoresFailed = false; renderPanel(); return; }
    try { scores = (await fetchGameScores(GAME)).top; scoresFailed = false; } catch { scoresFailed = scores === null; }
    if (phase !== 'play') renderPanel();
  }

  // ---- Verloop
  function start(): void {
    if (!getGameName() || editingName) return;
    reset();
    phase = 'play';
    renderPanel();
    flap();
    startLoop();
  }
  function pause(): void {
    if (phase !== 'play') return;
    cancelAnimationFrame(raf);
    phase = 'paused';
    renderPanel();
  }
  function resume(): void {
    if (phase !== 'paused') return;
    phase = 'play';
    renderPanel();
    startLoop();
  }
  function gameOver(): void {
    phase = 'over';
    cancelAnimationFrame(raf);
    const name = getGameName();
    const prev = bestFor(name);
    const newBest = score > prev;
    if (newBest) setBest(name, score);
    lastResult = { score, newBest, rank: null, saving: newBest, offline: false };
    draw();
    // Even wachten, zodat een tik die nog onderweg was niet meteen een nieuw potje start.
    panel.style.pointerEvents = 'none';
    setTimeout(() => { panel.style.pointerEvents = ''; }, 500);
    renderPanel();
    if (!newBest) return;
    const res = lastResult;
    const p = { name, score };
    void postGameScore(GAME, name, score)
      .then((data) => { scores = data.top; scoresFailed = false; res.rank = data.rank ?? null; removePending(p); })
      .catch(() => { addPending(p); res.offline = true; })
      .finally(() => { res.saving = false; if (phase === 'over' && lastResult === res) renderPanel(); });
  }

  // ---- Invoer: tik ergens op het speelveld (of spatie op een toetsenbord)
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (phase === 'play') flap();
  });
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== ' ' || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    e.preventDefault();
    if (phase === 'play') flap(); else if (phase === 'paused') resume(); else if (phase !== 'menu' || getGameName()) start();
  };
  const onVis = (): void => { if (document.visibilityState !== 'visible') pause(); };
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('resize', resize);

  function close(): void {
    cancelAnimationFrame(raf);
    clearInterval(topTimer);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('resize', resize);
    document.documentElement.classList.remove('game-open');
    overlay.remove();
  }

  resize();
  reset();
  draw();
  renderPanel();
  void loadScores();
}
