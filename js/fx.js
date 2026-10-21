/* «Баай» — звуки, вибрация и эффекты поверх экрана.
   Все звуки синтезируются Web Audio прямо в игре: никаких аудиофайлов,
   работает без интернета, чужих записей нет.
   Настройки «Звук» и «Вибрация» хранятся в телефоне.
   © 2026 Евсеев А.В. */
(function (root) {
  'use strict';

  const KEY = 'baai.fx.v1';
  const cfg = (() => {
    try { return Object.assign({ sound: true, vibe: true }, JSON.parse(localStorage.getItem(KEY)) || {}); }
    catch (e) { return { sound: true, vibe: true }; }
  })();
  const saveCfg = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* без сохранения */ } };

  // ---------- Web Audio ----------
  let ctx = null, out = null, noiseBuf = null;

  function audio() {
    if (!cfg.sound) return null;
    if (!ctx) {
      const A = root.AudioContext || root.webkitAudioContext;
      if (!A) return null;
      try { ctx = new A(); } catch (e) { return null; }
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      out = ctx.createGain(); out.gain.value = 0.55;
      out.connect(comp); comp.connect(ctx.destination);
      // белый шум на 2 секунды — для кубиков, ветра, бересты
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // Браузер разрешает звук только после касания — включаем при первом нажатии
  function unlock() {
    if (ctx && ctx.state === 'running') return;
    const a = audio();
    if (a) { const g = a.createGain(); g.gain.value = 0; g.connect(a.destination); const o = a.createOscillator(); o.connect(g); o.start(); o.stop(a.currentTime + 0.01); }
  }
  if (root.document) {
    ['pointerdown', 'touchend', 'keydown'].forEach(ev => root.document.addEventListener(ev, unlock, { once: false, passive: true }));
  }

  // Огибающая: быстрое нарастание, плавный спад
  function env(g, t, vol, att, dec) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t + att + dec);
  }

  // Тон: частота f (можно скользить к f2), форма волны, громкость
  function tone(f, at, dur, o) {
    o = o || {};
    const a = ctx, t = a.currentTime + at;
    const osc = a.createOscillator(), g = a.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
    env(g, t, o.vol ?? 0.3, o.att ?? 0.005, dur);
    osc.connect(g);
    if (o.filter) { const fl = a.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = o.filter; g.connect(fl); fl.connect(out); }
    else g.connect(out);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  // Колокольчик: основной тон и негармонические призвуки
  function bell(f, at, vol, dur) {
    tone(f, at, dur || 0.9, { vol: vol ?? 0.22 });
    tone(f * 2.76, at, (dur || 0.9) * 0.45, { vol: (vol ?? 0.22) * 0.35 });
    tone(f * 5.4, at, (dur || 0.9) * 0.2, { vol: (vol ?? 0.22) * 0.12 });
  }

  // Шум через фильтр: тип, частота (можно скользить), добротность
  function noise(at, dur, o) {
    o = o || {};
    const a = ctx, t = a.currentTime + at;
    const src = a.createBufferSource(); src.buffer = noiseBuf;
    const fl = a.createBiquadFilter(); fl.type = o.type || 'bandpass';
    fl.frequency.setValueAtTime(o.f || 1500, t);
    if (o.f2) fl.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
    fl.Q.value = o.q ?? 1;
    const g = a.createGain();
    if (o.swell) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(o.vol ?? 0.3, t + dur * 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    } else env(g, t, o.vol ?? 0.3, o.att ?? 0.003, dur);
    src.connect(fl); fl.connect(g); g.connect(out);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }

  // Удар дерева о дерево (молоток аукциона, стройка)
  function knock(at, f, vol) {
    tone(f || 150, at, 0.16, { f2: (f || 150) * 0.55, vol: vol ?? 0.5 });
    tone((f || 150) * 3.1, at, 0.05, { vol: (vol ?? 0.5) * 0.4, type: 'triangle' });
    noise(at, 0.04, { f: 2200, q: 0.8, vol: (vol ?? 0.5) * 0.5 });
  }

  // Хомус: гудящий тон, который «поёт» за счёт движения фильтра (как губы и рот)
  function khomus(at, dur, f) {
    const a = ctx, t = a.currentTime + at;
    const osc = a.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = f || 98;
    const fl = a.createBiquadFilter(); fl.type = 'bandpass'; fl.Q.value = 9;
    const lfo = a.createOscillator(); lfo.frequency.value = 5.5;
    const lg = a.createGain(); lg.gain.value = 700;
    fl.frequency.setValueAtTime(1100, t);
    lfo.connect(lg); lg.connect(fl.frequency);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(fl); fl.connect(g); g.connect(out);
    osc.start(t); lfo.start(t); osc.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  }

  // Ноты пентатоники (якутские напевы держатся на ней)
  const N = { C4: 261.6, D4: 293.7, E4: 329.6, G4: 392, A4: 440, C5: 523.3, D5: 587.3, E5: 659.3, G5: 784, A5: 880, C6: 1046.5 };

  const SOUNDS = {
    // кубики: несколько стуков о дерево и шорох
    dice() {
      for (let k = 0; k < 7; k++) {
        const at = k * 0.055 + Math.random() * 0.03;
        noise(at, 0.03, { f: 2600 + Math.random() * 1500, q: 2, vol: 0.35 - k * 0.03 });
        tone(380 + Math.random() * 260, at, 0.04, { type: 'triangle', vol: 0.12 });
      }
      tone(420, 0.48, 0.06, { type: 'triangle', vol: 0.18 });
      tone(330, 0.56, 0.06, { type: 'triangle', vol: 0.14 });
    },
    // шаг фишки: хруст снега
    step(k) {
      noise(0, 0.05, { type: 'highpass', f: 2800 + (k % 2) * 600, vol: 0.12 });
      tone(k % 2 ? 620 : 560, 0, 0.035, { type: 'triangle', vol: 0.06 });
    },
    coin() { bell(N.E5 * 2, 0, 0.16, 0.5); bell(N.A5 * 2, 0.07, 0.14, 0.6); },
    pay() { tone(N.E5, 0, 0.16, { type: 'triangle', vol: 0.16 }); tone(N.C5, 0.1, 0.24, { type: 'triangle', vol: 0.14 }); },
    buy() { [N.C5, N.E5, N.G5].forEach((f, k) => bell(f, k * 0.09, 0.17, 0.7)); },
    build() { knock(0, 210, 0.38); knock(0.14, 230, 0.34); bell(N.G5, 0.3, 0.12, 0.5); },
    hotel() { knock(0, 200, 0.4); knock(0.12, 220, 0.36); knock(0.24, 240, 0.32); [N.C5, N.G5, N.C6].forEach((f, k) => bell(f, 0.36 + k * 0.08, 0.13, 0.7)); },
    sell() { knock(0, 170, 0.32); tone(N.G4, 0.08, 0.2, { type: 'triangle', vol: 0.12 }); },
    // залог: потрескивание льда; выкуп: капель
    frost() {
      noise(0, 0.6, { type: 'highpass', f: 3000, f2: 7000, vol: 0.12, swell: true });
      for (let k = 0; k < 6; k++) tone(2600 + Math.random() * 2400, 0.05 + k * 0.07, 0.12, { vol: 0.05 });
    },
    melt() { [N.G5, N.E5, N.C5].forEach((f, k) => tone(f * 1.5, k * 0.11, 0.12, { f2: f, vol: 0.12 })); },
    // карточки: шелест бересты / мягкий взмах вышитой ткани
    bayanai() {
      for (let k = 0; k < 5; k++) noise(k * 0.04, 0.07, { f: 3200 + k * 300, q: 3, vol: 0.14 });
      bell(N.D5, 0.2, 0.08, 0.6);
    },
    tyusyulge() { noise(0, 0.3, { type: 'lowpass', f: 900, f2: 2400, vol: 0.18, swell: true }); bell(N.A4 * 2, 0.22, 0.1, 0.6); },
    gavel() { knock(0, 140, 0.55); },
    sold() { knock(0, 140, 0.5); knock(0.22, 140, 0.5); knock(0.44, 120, 0.6); bell(N.C5, 0.55, 0.12, 0.6); },
    bid() { tone(N.A5, 0, 0.06, { type: 'triangle', vol: 0.14 }); tone(N.E5 * 2, 0.05, 0.08, { vol: 0.08 }); },
    tick() { tone(1400, 0, 0.03, { type: 'square', vol: 0.05, filter: 3000 }); },
    // пурга: ветер, который налетает и стихает
    wind() {
      noise(0, 1.6, { f: 300, f2: 1300, q: 4, vol: 0.32, swell: true });
      noise(0.25, 1.3, { f: 700, f2: 350, q: 6, vol: 0.2, swell: true });
    },
    calm() { [N.C5, N.D5, N.G5].forEach((f, k) => bell(f, k * 0.12, 0.12, 0.6)); },
    prize() { khomus(0, 1.6, 98); [N.C5, N.D5, N.E5, N.G5, N.A5].forEach((f, k) => bell(f * 2, 0.3 + k * 0.08, 0.1, 0.5)); },
    turn() { bell(N.G5, 0, 0.13, 0.5); bell(N.C6, 0.12, 0.13, 0.7); },
    offer() { bell(N.E5, 0, 0.13, 0.5); bell(N.A5, 0.12, 0.13, 0.6); bell(N.E5, 0.24, 0.1, 0.5); },
    bankrupt() { tone(220, 0, 1.1, { f2: 60, type: 'triangle', vol: 0.3 }); noise(0, 0.9, { type: 'lowpass', f: 500, f2: 120, vol: 0.2 }); },
    win() {
      const tune = [N.C5, N.E5, N.G5, N.A5, N.G5, N.C6];
      tune.forEach((f, k) => { bell(f, k * 0.14, 0.16, 0.8); tone(f / 2, k * 0.14, 0.2, { type: 'triangle', vol: 0.08 }); });
      khomus(0.9, 1.8, 131);
    },
  };

  function play(name, arg) {
    if (!cfg.sound || !SOUNDS[name]) return;
    const a = audio(); if (!a || a.state !== 'running') return;
    try { SOUNDS[name](arg); } catch (e) { /* звук не обязателен */ }
  }

  // ---------- вибрация (Android; iPhone в браузере её не поддерживает) ----------
  const canVibe = !!(root.navigator && root.navigator.vibrate);
  function vibe(pattern) {
    if (!cfg.vibe || !canVibe) return;
    try { root.navigator.vibrate(pattern); } catch (e) { /* нет вибрации */ }
  }

  // ---------- эффекты поверх экрана ----------
  const reduce = () => root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let layer = null;
  function fxLayer() {
    if (!layer || !layer.isConnected) {
      layer = document.createElement('div');
      layer.className = 'fx-layer';
      layer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(layer);
    }
    return layer;
  }
  const centerOf = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; };
  const onScreen = p => p.y > -40 && p.y < root.innerHeight + 40;

  // Всплывающая сумма над плашкой игрока
  function floatText(el, text, good) {
    if (!el) return;
    const c = centerOf(el); if (!onScreen(c)) return;
    const s = document.createElement('span');
    s.className = 'fx-float ' + (good ? 'good' : 'bad');
    s.textContent = text;
    s.style.left = c.x + 'px'; s.style.top = (c.y - c.h * 0.2) + 'px';
    fxLayer().appendChild(s);
    if (!s.animate || reduce()) { setTimeout(() => s.remove(), 1400); return; }
    s.animate([
      { transform: 'translate(-50%, 0) scale(.7)', opacity: 0 },
      { transform: 'translate(-50%, -18px) scale(1.08)', opacity: 1, offset: 0.2 },
      { transform: 'translate(-50%, -44px) scale(1)', opacity: 0 },
    ], { duration: 1500, easing: 'ease-out' }).onfinish = () => s.remove();
  }

  // Монеты летят от одного места к другому по дуге
  function coins(from, to, n) {
    if (!from || !to || reduce()) return;
    const a = from.nodeType ? centerOf(from) : from, b = to.nodeType ? centerOf(to) : to;
    if (!onScreen(a) && !onScreen(b)) return;
    n = Math.max(1, Math.min(7, n || 3));
    for (let k = 0; k < n; k++) {
      const c = document.createElement('span');
      c.className = 'fx-coin';
      c.style.left = a.x + 'px'; c.style.top = a.y + 'px';
      fxLayer().appendChild(c);
      const dx = b.x - a.x, dy = b.y - a.y, lift = -60 - Math.random() * 40, jit = (Math.random() - 0.5) * 30;
      if (!c.animate) { c.remove(); continue; }
      c.animate([
        { transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 },
        { transform: `translate(calc(-50% + ${dx * 0.5 + jit}px), calc(-50% + ${dy * 0.5 + lift}px)) scale(1.1)`, opacity: 1, offset: 0.5 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.8)`, opacity: 0.2 },
      ], { duration: 750, delay: k * 70, easing: 'cubic-bezier(.3,.1,.4,1)', fill: 'both' }).onfinish = () => c.remove();
    }
  }

  // Бусины-конфетти по всему экрану (победа)
  function beads(count) {
    if (reduce()) return;
    const colors = ['#c8473d', '#c9a23a', '#3f6b4a', '#23395d', '#ffffff'];
    for (let k = 0; k < (count || 46); k++) {
      const b = document.createElement('span');
      b.className = 'fx-bead';
      const size = 6 + Math.random() * 8;
      b.style.width = b.style.height = size + 'px';
      b.style.background = colors[k % colors.length];
      b.style.left = (Math.random() * 100) + 'vw';
      fxLayer().appendChild(b);
      if (!b.animate) { b.remove(); continue; }
      const drift = (Math.random() - 0.5) * 120;
      b.animate([
        { transform: 'translate(0,-20px)', opacity: 1 },
        { transform: `translate(${drift}px, ${root.innerHeight + 40}px)`, opacity: 0.9 },
      ], { duration: 2200 + Math.random() * 1800, delay: Math.random() * 900, easing: 'cubic-bezier(.3,.2,.6,1)', fill: 'both' }).onfinish = () => b.remove();
    }
  }

  const FX = {
    get sound() { return cfg.sound; },
    get vibe() { return cfg.vibe; },
    canVibe,
    toggle(k) { cfg[k] = !cfg[k]; saveCfg(); if (k === 'sound' && cfg.sound) { audio(); setTimeout(() => play('turn'), 60); } if (k === 'vibe' && cfg.vibe) vibe(40); },
    play, vibe, floatText, coins, beads,
  };
  root.BAAI = root.BAAI || {};
  root.BAAI.fx = FX;
})(typeof window !== 'undefined' ? window : globalThis);
