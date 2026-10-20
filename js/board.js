/* «Баай» — круглое поле «Осуохай» на Phaser.
   Неподвижная часть поля (кольцо, узор, названия, дерево) собирается в одну картинку SVG.
   Поверх неё Phaser рисует то, что меняется: владельцев, дома, фишки, кубики, подсветку.
   Камера умеет показывать всё поле или приближать дугу с фишкой.
   © 2026 Евсеев А.В. */
(function (root) {
  'use strict';

  const { BOARD } = root.BAAI.data;
  const T = root.BAAI.theme;
  const C = T.C;

  // Мир поля: 720×720, центр 360,360. Холст 1080×1080, базовый зум 1.5 — чётко на телефонах.
  const W = 720, CX = 360, CY = 360;
  const CANVAS = 1080, BASE = CANVAS / W;
  const R = { rimOut: 356, rimIn: 332, out: 330, band: 304, icon: 287, text: 240, inn: 204, ring: 202, dots: 196, center: 188 };
  const STEP = 9;                                  // градусов на клетку
  const ang = i => 90 + i * STEP;                  // клетка 0 внизу, ход по часовой
  const rad = d => d * Math.PI / 180;
  const polar = (r, deg) => [CX + r * Math.cos(rad(deg)), CY + r * Math.sin(rad(deg))];
  const hex = h => parseInt(h.slice(1), 16);
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- неподвижная картинка поля ----------
  function sectorPath(r1, r2, a1, a2) {
    const [x1, y1] = polar(r2, a1), [x2, y2] = polar(r2, a2), [x3, y3] = polar(r1, a2), [x4, y4] = polar(r1, a1);
    const f = n => n.toFixed(1);
    return `M${f(x1)} ${f(y1)}A${r2} ${r2} 0 0 1 ${f(x2)} ${f(y2)}L${f(x3)} ${f(y3)}A${r1} ${r1} 0 0 0 ${f(x4)} ${f(y4)}Z`;
  }

  function cellFill(i) {
    const c = BOARD[i];
    if (c.type === 'start') return C.coral;
    if (c.type === 'jail') return C.deep;
    if (c.type === 'parking') return C.larch;
    if (c.type === 'gotojail') return C.silver;
    if (c.type === 'tyusyulge') return C.tyusyulge;
    if (c.type === 'bayanai') return C.bayanai;
    return C.paper;
  }

  function cellIconName(i) {
    const c = BOARD[i];
    if (c.type === 'prop') return T.GROUP_ICON[c.group];
    if (T.CELL_ICON[i]) return T.CELL_ICON[i];
    return T.TYPE_ICON[c.type];
  }

  function cellLabel(i) {
    const c = BOARD[i];
    return { start: 'СТАРТ', jail: 'ИЗОЛЯТОР', parking: 'ЫСЫАХ', gotojail: 'ЗИМНИК' }[c.type] || c.short.replace(/­/g, '');
  }

  function buildBoardSVG(px) {
    const o = [];
    o.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${px}" height="${px}" viewBox="0 0 ${W} ${W}">`);
    // лировидный узор (один мотив, повторённый 40 раз)
    o.push(`<defs><g id="ly"><path d="M360 13c-5.2 0-9.2 4-8.4 8.8.6 3.6 4.4 4.8 6.4 2.4M360 13c5.2 0 9.2 4 8.4 8.8-.6 3.6-4.4 4.8-6.4 2.4M360 18v9.2" fill="none" stroke="${C.rim}" stroke-width="2.2" stroke-linecap="round"/><circle cx="360" cy="9.2" r="2.4" fill="${C.coral}"/></g></defs>`);
    o.push(`<circle cx="${CX}" cy="${CY}" r="${R.rimOut}" fill="${C.ink}"/>`);
    o.push(`<circle cx="${CX}" cy="${CY}" r="${R.rimOut - 3}" fill="none" stroke="${C.silver}" stroke-width="1.5"/>`);
    for (let k = 0; k < 40; k++) o.push(`<use xlink:href="#ly" href="#ly" transform="rotate(${k * STEP + STEP / 2} ${CX} ${CY})"/>`);
    o.push(`<circle cx="${CX}" cy="${CY}" r="${R.out + 1}" fill="${C.ink}"/>`);

    for (let i = 0; i < 40; i++) {
      const c = BOARD[i], a = ang(i), a1 = a - STEP / 2 + 0.4, a2 = a + STEP / 2 - 0.4;
      const corner = i % 10 === 0;
      o.push(`<path d="${sectorPath(R.inn, R.out, a1, a2)}" fill="${cellFill(i)}"/>`);
      if (c.type === 'prop') o.push(`<path d="${sectorPath(R.band, R.out, a1, a2)}" fill="${T.GROUP[c.group]}"/>`);

      // иконка: верх смотрит в центр, чтобы в приближении у фишки она стояла прямо
      const icon = cellIconName(i);
      const isz = corner ? 36 : 24;
      const [ix, iy] = polar(corner ? 290 : (c.type === 'prop' ? 284 : 290), a);
      const icol = corner ? '#ffffff' : (c.type === 'prop' ? T.GROUP[c.group] : (c.type === 'tyusyulge' ? C.coral : c.type === 'bayanai' ? C.larch : C.ink));
      o.push(`<g transform="translate(${ix.toFixed(1)} ${iy.toFixed(1)}) rotate(${a - 90}) scale(${isz / 24}) translate(-12 -12)">${T.iconSVG(icon, icol, corner ? 2.2 : 2.3)}</g>`);

      // название по радиусу; на левой половине разворачиваем, чтобы читалось
      const name = cellLabel(i);
      const len = name.length;
      const fs = corner ? Math.min(16, 50 / (len * 0.6)) : Math.min(14.5, 56 / (len * 0.56));
      const [tx, ty] = polar(corner ? 230 : 238, a);
      const rot = Math.cos(rad(a)) >= -0.001 ? a : a + 180;
      o.push(`<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" transform="rotate(${rot.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)})" text-anchor="middle" dominant-baseline="central" font-family="PT Sans Narrow, Roboto Condensed, Arial Narrow, sans-serif-condensed, Arial, sans-serif" font-size="${fs.toFixed(1)}" font-weight="700" fill="${corner ? '#ffffff' : C.ink}">${esc(name)}</text>`);
    }

    o.push(`<circle cx="${CX}" cy="${CY}" r="${R.ring}" fill="${C.ink}"/>`);
    for (let k = 0; k < 40; k++) {
      const [x, y] = polar(R.dots, ang(k) + STEP / 2);
      o.push(`<rect x="${(x - 3).toFixed(1)}" y="${(y - 3).toFixed(1)}" width="6" height="6" fill="${C.silver}" transform="rotate(45 ${x.toFixed(1)} ${y.toFixed(1)})"/>`);
    }
    o.push(`<circle cx="${CX}" cy="${CY}" r="${R.center}" fill="${C.snow}"/>`);

    // Аал Луук Мас — дерево жизни
    o.push(`<g transform="translate(0 -34)"><g fill="none" stroke="${C.ink}" stroke-width="4" stroke-linecap="round">
      <path d="M360 236V464"/>
      <path d="M360 272c-16-8-44-4-48 18-2 14 12 20 20 10"/><path d="M360 272c16-8 44-4 48 18 2 14-12 20-20 10"/>
      <path d="M360 316c-20-10-60-6-64 22-2 18 16 24 24 12"/><path d="M360 316c20-10 60-6 64 22 2 18-16 24-24 12"/>
      <path d="M360 364c-24-12-76-8-80 26-2 20 18 28 28 14"/><path d="M360 364c24-12 76-8 80 26 2 20-18 28-28 14"/>
      <path d="M360 464c-12 8-32 8-40 20M360 464c12 8 32 8 40 20M360 464v22"/>
    </g>
    <circle cx="360" cy="208" r="18" fill="${C.coral}"/>
    <g fill="${C.coral}"><circle cx="332" cy="300" r="4.5"/><circle cx="388" cy="300" r="4.5"/><circle cx="320" cy="350" r="4.5"/><circle cx="400" cy="350" r="4.5"/><circle cx="308" cy="404" r="4.5"/><circle cx="412" cy="404" r="4.5"/></g></g>`);
    o.push('</svg>');
    return o.join('');
  }

  // ---------- загрузка SVG в текстуру ----------
  function svgTexture(scene, key, svg) {
    return new Promise(resolve => {
      if (scene.textures.exists(key)) return resolve();
      const img = new Image();
      img.onload = () => { scene.textures.addImage(key, img); resolve(); };
      img.onerror = () => resolve();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  // ---------- сцена ----------
  class BoardScene extends Phaser.Scene {
    constructor(view) { super('board'); this.view = view; }

    create() {
      const cam = this.cameras.main;
      cam.setZoom(BASE); cam.centerOn(CX, CY);
      this.input.addPointer(1);
      this.state = null;
      this.shown = [];          // где фишки нарисованы сейчас
      this.tokens = [];
      this.camMode = 'all';
      this.ready = svgTexture(this, 'board', buildBoardSVG(2048)).then(() => {
        this.add.image(CX, CY, 'board').setDisplaySize(W, W).setDepth(0);
        this.layer = this.add.graphics().setDepth(1);
        this.hl = this.add.graphics().setDepth(2);
        this.tweens.add({ targets: this.hl, alpha: { from: 1, to: 0.35 }, duration: 700, yoyo: true, repeat: -1 });
        this.makeDice();
        this.setupInput();
        if (this.view.pending) { const p = this.view.pending; this.view.pending = null; this.apply(p.G, p.opts); }
      });
    }

    update() {
      const r = -this.cameras.main.rotation;
      if (this.tokens) this.tokens.forEach(t => { if (t) t.rotation = r; });
      if (this.dice) this.dice.forEach(g => { g.rotation = r + Phaser.Math.DegToRad(g.wobble || 0); });
    }

    // ----- кубики в центре поля -----
    makeDice() {
      this.dice = [0, 1].map(k => {
        const g = this.add.graphics().setDepth(5);
        g.x = CX - 36 + k * 72; g.y = CY + 128;
        return g;
      });
      this.drawDie(this.dice[0], 0); this.drawDie(this.dice[1], 0);
    }

    drawDie(g, n) {
      const s = 54, h = s / 2;
      g.clear();
      g.fillStyle(hex(C.ink), 1); g.fillRoundedRect(-h + 2, -h + 5, s, s, 11);
      g.fillStyle(0xffffff, 1); g.fillRoundedRect(-h, -h, s, s, 11);
      g.lineStyle(3.5, hex(C.ink), 1); g.strokeRoundedRect(-h, -h, s, s, 11);
      const P = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
        5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] }[n] || [];
      P.forEach(([x, y]) => { g.fillStyle(hex(n === 1 ? C.coral : C.ink), 1); g.fillCircle(x * 14, y * 14, n === 1 ? 7 : 5.5); });
      g.setAlpha(n ? 1 : 0.35);
    }

    rollDice(d, done) {
      let t = 0;
      const tick = () => {
        t++;
        this.dice.forEach((g, k) => { this.drawDie(g, t < 9 ? 1 + Math.floor(Math.random() * 6) : d[k]); g.wobble = t < 9 ? (Math.random() * 50 - 25) : 0; });
        if (t < 9) this.time.delayedCall(55, tick); else if (done) done();
      };
      tick();
    }

    // ----- владельцы, дома, подсветка -----
    drawLayer(G) {
      const g = this.layer; g.clear();
      for (const k in G.own) {
        const i = Number(k), o = G.own[k], a = ang(i);
        const col = hex(G.players[o.owner].color);
        g.lineStyle(9, col, 1);
        g.beginPath(); g.arc(CX, CY, R.inn + 6, rad(a - STEP / 2 + 0.6), rad(a + STEP / 2 - 0.6), false); g.strokePath();
        if (BOARD[i].type === 'prop' && o.houses) {
          const n = o.houses;
          if (n === 5) this.quad(g, a, 317, 0, 11, 9, hex(C.coral));
          else for (let h = 0; h < n; h++) this.quad(g, a, 317, (h - (n - 1) / 2) * 3.4, 4.6, 4.6, 0xffffff);
        }
      }
      // клетка, где стоит тот, кто ходит
      const hl = this.hl; hl.clear();
      if (G.phase !== 'over') {
        const a = ang(G.players[G.turn].pos);
        hl.lineStyle(5, hex(C.coral), 1);
        hl.beginPath();
        hl.arc(CX, CY, R.out - 2, rad(a - STEP / 2 + 0.5), rad(a + STEP / 2 - 0.5), false);
        hl.arc(CX, CY, R.inn + 2, rad(a + STEP / 2 - 0.5), rad(a - STEP / 2 + 0.5), true);
        hl.closePath(); hl.strokePath();
      }
    }

    // Прямоугольник на кольце: центр на угле a (+ сдвиг da градусов), радиус r
    quad(g, a, r, da, w, h, fill) {
      const c = a + da, t = rad(c), n = [Math.cos(t), Math.sin(t)], tg = [-Math.sin(t), Math.cos(t)];
      const [x, y] = polar(r, c);
      const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([u, v]) =>
        new Phaser.Math.Vector2(x + tg[0] * u + n[0] * v, y + tg[1] * u + n[1] * v));
      g.fillStyle(fill, 1); g.fillPoints(pts, true);
      g.lineStyle(1.6, hex(C.ink), 1); g.strokePoints(pts, true);
    }

    // ----- фишки -----
    tokenXY(cell, slot) {
      const r = R.dots - slot * 25;
      return polar(r, ang(cell));
    }

    async ensureTokens(G) {
      for (let p = 0; p < G.players.length; p++) {
        const pl = G.players[p];
        const key = `tok-${pl.figure || 'horse'}-${pl.color}`;
        await svgTexture(this, key, T.tokenSVG(pl.figure || 'horse', pl.color, 96));
        if (!this.tokens[p]) {
          this.tokens[p] = this.add.image(0, 0, key).setDisplaySize(30, 30).setDepth(10 + p);
          this.shown[p] = pl.pos;
          this.placeTokens(G, true);
        }
      }
    }

    slotOf(G, p, cell) {
      let k = 0;
      for (let q = 0; q < p; q++) if (!G.players[q].bankrupt && this.shown[q] === cell) k++;
      return k;
    }

    placeTokens(G, instant) {
      G.players.forEach((pl, p) => {
        const s = this.tokens[p]; if (!s) return;
        s.setVisible(!pl.bankrupt);
        const [x, y] = this.tokenXY(this.shown[p], this.slotOf(G, p, this.shown[p]));
        if (instant) { s.x = x; s.y = y; }
        else this.tweens.add({ targets: s, x, y, duration: 180 });
        s.setDepth(p === G.turn ? 30 : 10 + p);
      });
    }

    // Пошаговое движение фишки
    walk(G, p, to, done) {
      const from = this.shown[p];
      const fwd = (to - from + 40) % 40, back = (from - to + 40) % 40;
      const s = this.tokens[p];
      const jump = () => {
        this.shown[p] = to;
        const [x, y] = this.tokenXY(to, 0);
        this.tweens.add({ targets: s, x, y, duration: 520, ease: 'Sine.easeInOut',
          onUpdate: tw => { const k = Math.sin(tw.progress * Math.PI); s.setDisplaySize(30 + 22 * k, 30 + 22 * k); },
          onComplete: () => { s.setDisplaySize(30, 30); done(); } });
      };
      if (to === from) return done();
      const steps = fwd <= 12 ? fwd : (back <= 3 ? -back : 0);
      if (!steps) return jump();
      const dir = Math.sign(steps);
      let left = Math.abs(steps);
      const one = () => {
        if (!left) return done();
        const start = this.shown[p], next = (start + dir + 40) % 40;
        const a0 = ang(start), a1 = a0 + dir * STEP;
        this.tweens.addCounter({ from: 0, to: 1, duration: 150, ease: 'Sine.easeInOut',
          onUpdate: tw => {
            const v = tw.getValue(); const [x, y] = polar(R.dots, a0 + (a1 - a0) * v);
            s.x = x; s.y = y; const k = Math.sin(v * Math.PI); s.setDisplaySize(30 + 10 * k, 30 + 10 * k);
          },
          onComplete: () => { this.shown[p] = next; left--; one(); } });
      };
      one();
    }

    // ----- камера -----
    camTo(zoom, cx, cy, rot, ms) {
      const cam = this.cameras.main;
      const z0 = cam.zoom, r0 = cam.rotation, m0 = cam.midPoint.clone();
      let dr = rot - r0; while (dr > Math.PI) dr -= 2 * Math.PI; while (dr < -Math.PI) dr += 2 * Math.PI;
      if (this.camTween) this.camTween.stop();
      this.camTween = this.tweens.addCounter({ from: 0, to: 1, duration: ms ?? 650, ease: 'Cubic.easeInOut',
        onUpdate: tw => {
          const v = tw.getValue();
          cam.setZoom(z0 + (zoom - z0) * v);
          cam.setRotation(r0 + dr * v);
          cam.centerOn(m0.x + (cx - m0.x) * v, m0.y + (cy - m0.y) * v);
        } });
    }

    showAll(ms) { this.camMode = 'all'; this.camTo(BASE, CX, CY, 0, ms); }

    followCell(cell, ms) {
      this.camMode = 'follow';
      const a = ang(cell);
      const [x, y] = polar(165, a);
      // поворачиваем мир так, чтобы клетка оказалась внизу экрана
      this.camTo(BASE * 1.95, x, y, rad(90 - a), ms);
    }

    // ----- жесты -----
    setupInput() {
      const cam = this.cameras.main;
      let down = null, pinch = null;
      this.input.on('pointerdown', p => {
        if (this.input.pointer1.isDown && this.input.pointer2.isDown) {
          const d = Phaser.Math.Distance.Between(this.input.pointer1.x, this.input.pointer1.y, this.input.pointer2.x, this.input.pointer2.y);
          pinch = { d, z: cam.zoom }; down = null;
        } else down = { x: p.x, y: p.y, moved: false, mid: cam.midPoint.clone() };
      });
      this.input.on('pointermove', p => {
        if (pinch && this.input.pointer1.isDown && this.input.pointer2.isDown) {
          const d = Phaser.Math.Distance.Between(this.input.pointer1.x, this.input.pointer1.y, this.input.pointer2.x, this.input.pointer2.y);
          cam.setZoom(Phaser.Math.Clamp(pinch.z * d / pinch.d, BASE * 0.95, BASE * 3.2));
          this.camMode = 'free';
          return;
        }
        if (!down || !p.isDown) return;
        const dx = p.x - down.x, dy = p.y - down.y;
        if (!down.moved && Math.hypot(dx, dy) < 10) return;
        down.moved = true;
        if (cam.zoom <= BASE * 1.02) return;          // всё поле — двигать нечего
        if (this.camTween) this.camTween.stop();
        this.camMode = 'free';
        const r = cam.rotation, z = cam.zoom;
        const wx = (dx * Math.cos(r) + dy * Math.sin(r)) / z, wy = (-dx * Math.sin(r) + dy * Math.cos(r)) / z;
        cam.centerOn(down.mid.x - wx, down.mid.y - wy);
      });
      this.input.on('pointerup', p => {
        if (pinch) { if (!this.input.pointer1.isDown && !this.input.pointer2.isDown) pinch = null; return; }
        if (down && !down.moved) this.tap(p);
        down = null;
      });
      this.input.on('wheel', (p, o, dx, dy) => {
        cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), BASE * 0.95, BASE * 3.2));
        this.camMode = 'free';
      });
    }

    tap(p) {
      const w = this.cameras.main.getWorldPoint(p.x, p.y);
      const dx = w.x - CX, dy = w.y - CY, r = Math.hypot(dx, dy);
      if (r < R.inn - 20 || r > R.out + 4) return;
      let d = Math.atan2(dy, dx) * 180 / Math.PI;
      const i = ((Math.round((d - 90) / STEP) % 40) + 40) % 40;
      if (this.view.onCellTap) this.view.onCellTap(i);
    }

    // ----- применить новое состояние партии -----
    async apply(G, opts = {}) {
      await this.ensureTokens(G);
      const prevTurn = this.lastTurn;
      this.lastTurn = G.turn;
      this.drawLayer(G);
      const finishMoves = () => {
        const movers = G.players.map((pl, p) => p).filter(p => !G.players[p].bankrupt && this.shown[p] !== G.players[p].pos);
        let left = movers.length;
        const after = () => {
          this.placeTokens(G);
          if (opts.turnChanged || prevTurn === undefined) this.showAll();
          else if (opts.rolled || movers.includes(G.turn)) this.followCell(G.players[G.turn].pos);
        };
        if (!left) return after();
        movers.forEach(p => this.walk(G, p, G.players[p].pos, () => { if (--left === 0) after(); }));
      };
      if (opts.rolled && G.dice) this.rollDice(G.dice, finishMoves);
      else {
        if (G.dice) this.dice.forEach((g, k) => this.drawDie(g, G.dice[k]));
        else this.dice.forEach(g => this.drawDie(g, 0));
        finishMoves();
      }
    }
  }

  // ---------- то, чем пользуется ui.js ----------
  class BoardView {
    constructor(parent, opts = {}) {
      this.onCellTap = opts.onCellTap;
      this.pending = null;
      this.scene = new BoardScene(this);
      this.game = new Phaser.Game({
        type: Phaser.AUTO, parent, width: CANVAS, height: CANVAS, transparent: true,
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        input: { activePointers: 3 }, banner: false, audio: { noAudio: true },
        scene: this.scene,
      });
    }
    update(G, opts) {
      const s = this.scene;
      if (!s.ready || !s.layer) { this.pending = { G, opts }; return; }
      s.apply(G, opts || {});
    }
    reset() {
      const s = this.scene;
      if (s.tokens) { s.tokens.forEach(t => t && t.destroy()); s.tokens = []; s.shown = []; s.lastTurn = undefined; }
    }
    showAll() { if (this.scene.layer) this.scene.showAll(); }
    focus(cell) { if (this.scene.layer) this.scene.followCell(cell); }
  }

  root.BAAI = root.BAAI || {};
  root.BAAI.BoardView = BoardView;
  root.BAAI.buildBoardSVG = buildBoardSVG;
})(window);
