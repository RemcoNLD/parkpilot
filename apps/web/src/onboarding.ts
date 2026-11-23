import { ApiError, createRecoveryCode, getCreds, redeemRecoveryCode, setCreds } from './api';
import { h } from './dom';
import { lang, t as T } from './i18n';
import { icon } from './icons';

// ---- Rondleiding voor nieuwe gebruikers + helpscherm ----------------------------------------------
// Rondleiding: alleen bij de eerste start van een nieuwe gebruiker (geen `pp.tour` en nog geen profiel).
// Bestaande gebruikers (al een profiel) krijgen hem niet: de vlag wordt dan stil gezet.
// Help: via het menu (☰) in de kop, met uitklapbare onderwerpen en een knop terug naar de rondleiding.

const TOUR_KEY = 'pp.tour';
const getFlag = (): string | null => { try { return localStorage.getItem(TOUR_KEY); } catch { return null; } };
const setFlag = (): void => { try { localStorage.setItem(TOUR_KEY, 'done'); } catch { /* geen opslag */ } };

/** Moet de rondleiding getoond worden? Aanroepen vóór er een profiel wordt aangemaakt. */
export function tourWanted(): boolean {
  if (getFlag() === 'done') return false;
  if (getCreds()) { setFlag(); return false; }
  return true;
}

export interface TourHooks {
  /** Aantal favorieten op dit toestel (voor de waarschuwing bij een bestaande code). */
  favoriteCount: () => number;
  /** Na het inwisselen van een code: lijstje opnieuw laden. */
  reload: () => Promise<void>;
}

const isIosSafari = (): boolean => {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
  return ios && !standalone;
};

const mkMsg = (): { el: HTMLElement; say: (t: string, kind?: 'good' | 'err' | '') => void } => {
  const el = h('div', { class: 'msg', role: 'status' });
  return { el, say: (t, kind = '') => { el.className = `msg ${kind}`.trim(); el.textContent = t; } };
};

/**
 * Zelfgekozen code is al van een ander profiel: vragen of je dat lijstje wilt openen. De server is leidend:
 * dit toestel stapt over naar dat profiel, wat er nu op staat verdwijnt. Gebruikt in de rondleiding én in Instellingen.
 */
export function codeTakenOffer(code: string, done: (favoriteCount: number) => void | Promise<void>, other: () => void): HTMLElement {
  const err = h('p', { class: 'msg err' });
  err.hidden = true;
  const open = h('button', { class: 'btn sm', type: 'button' }, T.codeTakenOpen);
  const no = h('button', { class: 'btn secondary sm', type: 'button', onclick: other }, T.codeTakenOther);
  open.addEventListener('click', async () => {
    open.setAttribute('disabled', '');
    try {
      const r = await redeemRecoveryCode(code);
      setCreds({ deviceId: r.deviceId, token: r.token });
      await done(r.favoriteCount);
    } catch (e) {
      err.hidden = false;
      err.textContent = e instanceof ApiError && e.status === 429 ? T.tooMany : T.restoreFail;
      open.removeAttribute('disabled');
    }
  });
  return h('div', { class: 'code-taken' }, h('p', { class: 'code-warn' }, T.codeTakenAsk), h('div', { class: 'inline-actions' }, open, no), err);
}

/** De keuzes bij de koppelcode-stap. Zelfde API en meldingen als in Instellingen. */
function codeChooser(hooks: TourHooks, made: { code: string | null }): HTMLElement {
  const box = h('div', { class: 'tour-code' });
  const panel = h('div', { class: 'tour-code-panel' });
  type Choice = 'have' | 'strong' | 'own' | 'later';
  let choice: Choice | null = null;
  const btns = new Map<Choice, HTMLElement>();

  const strongPanel = (): Node[] => {
    const msg = mkMsg();
    const out = h('div', {});
    const show = (code: string): void => {
      const copy = h('button', { class: 'btn sm', type: 'button' }, T.copy);
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(code); copy.textContent = T.copied; } catch { copy.textContent = T.copyFailCode; }
      });
      out.replaceChildren(h('div', { class: 'code-row' }, h('div', { class: 'code' }, code), copy), h('p', { class: 'code-warn' }, T.strongNote));
    };
    // Maar één keer per rondleiding maken, ook als je terugbladert of opnieuw kiest.
    if (made.code) show(made.code);
    else {
      out.append(h('p', { class: 'tour-small' }, T.busy));
      createRecoveryCode().then(({ code }) => { made.code = code; show(code); }).catch(() => { out.replaceChildren(); msg.say(T.strongFail, 'err'); });
    }
    return [out, msg.el];
  };

  const ownPanel = (): Node[] => {
    const msg = mkMsg();
    const input = h('input', { class: 'input', type: 'text', placeholder: T.codePlaceholder, autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: false, 'aria-label': T.ownCodeAria, maxlength: 24 }) as HTMLInputElement;
    const save = h('button', { class: 'btn sm', type: 'button' }, T.saveBtn);
    save.addEventListener('click', async () => {
      const value = input.value.trim();
      if (value.replace(/[^A-Za-z0-9]/g, '').length < 4) return msg.say(T.codeMin, 'err');
      save.setAttribute('disabled', '');
      try {
        const { code } = await createRecoveryCode(value);
        msg.say(T.codeSaved(code), 'good');
      } catch (err) {
        if (err instanceof ApiError && err.code === 'code_taken') {
          msg.el.className = 'msg';
          msg.el.replaceChildren(codeTakenOffer(value, (n) => { input.value = ''; msg.say(T.restored(n), 'good'); void hooks.reload(); }, () => { msg.say(''); input.focus(); }));
        } else if (err instanceof ApiError && err.code === 'invalid_code') msg.say(T.codeMin, 'err');
        else msg.say(T.errSave, 'err');
      }
      save.removeAttribute('disabled');
    });
    return [h('p', { class: 'code-warn' }, T.ownCodeWarn), h('p', { class: 'tour-small' }, T.tourCodeOwnHint), h('div', { class: 'code-line' }, input, save), msg.el];
  };

  const havePanel = (): Node[] => {
    const msg = mkMsg();
    const input = h('input', { class: 'input', type: 'text', placeholder: T.yourCode, autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: false, 'aria-label': T.linkCode, maxlength: 24 }) as HTMLInputElement;
    const go = h('button', { class: 'btn sm', type: 'button' }, T.retrieve);
    let warned = false;
    go.addEventListener('click', async () => {
      const code = input.value.trim();
      if (!code) return msg.say(T.enterCode, 'err');
      // Geen browser-popup: eerst waarschuwen in de tekst, tweede tik gaat door.
      const n = hooks.favoriteCount();
      if (n > 0 && !warned) { warned = true; return msg.say(T.tourCodeReplaceWarn(n), 'err'); }
      go.setAttribute('disabled', '');
      try {
        const r = await redeemRecoveryCode(code);
        setCreds({ deviceId: r.deviceId, token: r.token });
        input.value = '';
        msg.say(T.restored(r.favoriteCount), 'good');
        void hooks.reload();
      } catch (err) {
        if (err instanceof ApiError && err.status === 429) msg.say(T.tooMany, 'err');
        else if (err instanceof ApiError && err.code === 'invalid_code') msg.say(T.codeWrong, 'err');
        else msg.say(T.restoreFail, 'err');
      }
      go.removeAttribute('disabled');
    });
    return [h('div', { class: 'code-line' }, input, go), msg.el];
  };

  const pick = (c: Choice): void => {
    choice = c;
    for (const [k, b] of btns) b.setAttribute('aria-pressed', String(k === choice));
    panel.replaceChildren(...(c === 'have' ? havePanel() : c === 'strong' ? strongPanel() : c === 'own' ? ownPanel() : [h('p', { class: 'tour-small' }, T.tourCodeLaterNote)]));
    const first = panel.querySelector('input');
    if (first) setTimeout(() => (first as HTMLInputElement).focus(), 50);
  };

  const opts: [Choice, string][] = [['have', T.tourCodeHave], ['strong', T.tourCodeStrong], ['own', T.tourCodeOwn], ['later', T.tourCodeLater]];
  const list = h('div', { class: 'tour-choices', role: 'group', 'aria-label': T.tourCodeQ },
    ...opts.map(([k, label]) => {
      const b = h('button', { class: 'tour-choice', type: 'button', 'aria-pressed': false, onclick: () => pick(k) }, label);
      btns.set(k, b);
      return b;
    }));
  box.append(h('div', { class: 'tour-q' }, T.tourCodeQ), list, panel);
  return box;
}

/**
 * Schermafbeelding per stap (sleutel = icoon van de stap). Gemaakt met `bash tools/tour-shots.sh` in elke taal en elk
 * thema (apps/web/public/tour/<taal>-<thema>-<naam>.webp). Na elke UI-wijziging die in een stap te zien is opnieuw
 * maken. Geen afbeelding (zoals bij de koppelcode): dan het grote icoon.
 */
const SHOTS: Record<string, string> = {
  heart: 'welcome', grid: 'views', gauge: 'tap', stale: 'stale', swipe: 'swipe', timer: 'hold', warn: 'tiles', show: 'menu',
};

function shotNode(stepIcon: string): HTMLElement | null {
  const name = SHOTS[stepIcon];
  if (!name) return null;
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const img = h('img', { class: 'tour-shot', src: `/tour/${lang}-${theme}-${name}.webp`, alt: '', decoding: 'async' }) as HTMLImageElement;
  const frame = h('div', { class: 'tour-shot-frame' }, img);
  // Afbeelding ontbreekt (bijv. offline zonder cache): dan het icoon tonen.
  img.addEventListener('error', () => frame.replaceWith(h('div', { class: 'tour-icon' }, icon(stepIcon, 44))));
  return frame;
}

/**
 * Rondleiding op volledig scherm. Stap 0 = welkom + koppelcode, met de keuze Meteen beginnen of Rondleiding.
 * Daarna de uitlegstappen met stippen, Overslaan, Terug/Volgende. Sluiten (ook Overslaan) zet de vlag.
 * `start` = 1 slaat het welkom over (rondleiding opnieuw bekijken via menu of Help).
 */
export function openTour(hooks: TourHooks, start = 0): void {
  const steps = T.tourSteps;
  const made = { code: null as string | null };
  let i = Math.min(Math.max(start, 0), steps.length - 1);
  let codeBox: HTMLElement | null = null;
  const root = h('div', { class: 'tour', role: 'dialog', 'aria-modal': 'true', 'aria-label': T.tour });
  const close = (): void => { setFlag(); root.remove(); };
  const n = steps.length - 1; // aantal uitlegstappen (zonder welkom)

  const paint = (): void => {
    const s = steps[i];
    const intro = i === 0;
    const last = i === steps.length - 1;
    if (intro && !codeBox) codeBox = codeChooser(hooks, made);
    const parts: (HTMLElement | null)[] = [
      intro ? null : h('div', { class: 'tour-top' },
        h('div', { class: 'tour-dots', role: 'img', 'aria-label': T.tourStepAria(i, n) },
          ...steps.slice(1).map((_, k) => h('span', { class: k + 1 === i ? 'on' : k + 1 < i ? 'seen' : '' }))),
        last ? null : h('button', { class: 'tour-skip', type: 'button', onclick: close }, T.tourSkip)),
      h('div', { class: `tour-body${intro ? ' intro' : ''}` },
        intro ? h('div', { class: 'tour-icon' }, icon(s.icon, 44)) : shotNode(s.icon) ?? h('div', { class: 'tour-icon' }, icon(s.icon, 44)),
        h('h2', {}, s.title),
        ...s.body.map((p) => h('p', {}, p)),
        intro && isIosSafari() ? h('p', { class: 'tour-tip' }, T.tourIosTip) : null,
        intro ? codeBox : null),
      intro
        ? h('div', { class: 'tour-nav two' },
            h('button', { class: 'btn secondary', type: 'button', onclick: close }, T.tourGoNow),
            h('button', { class: 'btn', type: 'button', onclick: () => { i = 1; paint(); } }, T.tourTake))
        : h('div', { class: 'tour-nav' },
            i > (start > 0 ? 1 : 0) ? h('button', { class: 'btn secondary', type: 'button', onclick: () => { i--; paint(); } }, T.tourBack) : h('span', {}),
            h('button', { class: 'btn', type: 'button', onclick: () => { if (last) close(); else { i++; paint(); } } }, last ? T.tourStart : T.tourNext))];
    root.replaceChildren(...parts.filter((x): x is HTMLElement => x !== null));
    root.scrollTop = 0;
  };
  paint();
  document.body.append(root);
}

export interface HelpHooks {
  replayTour: () => void;
  openCodeSettings: () => void;
}

/** Helpscherm in de stijl van Instellingen: uitklapbare onderwerpen. */
export function openHelp(hooks: HelpHooks): void {
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-label': T.help });
  const close = (): void => sheet.remove();
  sheet.append(
    h('div', { class: 'sheet-head' }, h('h2', {}, T.help), h('button', { class: 'icon-btn', 'aria-label': T.close, onclick: close }, '✕')),
    h('button', { class: 'btn secondary help-replay', type: 'button', onclick: () => { close(); hooks.replayTour(); } }, T.helpReplay),
    h('section', { class: 'set-sec' }, h('div', { class: 'set-group' },
      ...T.helpTopics.map((topic) => h('details', { class: 'set-more help-topic' },
        h('summary', {}, topic.title),
        ...topic.body.map((p) => h('p', { class: 'set-note' }, p)),
        topic.id === 'code' ? h('button', { class: 'btn secondary sm', type: 'button', onclick: () => { close(); hooks.openCodeSettings(); } }, T.helpToCode) : null)))));
  document.body.append(sheet);
}
