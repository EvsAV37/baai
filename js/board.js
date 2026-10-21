/* «Баай» — круглое поле «Осуохай» на Phaser.
   Неподвижная часть поля (кольцо, узор, иконки, дерево) собирается в одну картинку SVG.
   Названия клеток — текстом Phaser, тем же шрифтом, что и остальной экран.
   Поверх Phaser рисует то, что меняется: владельцев, дома, фишки, подсветку.
   Камера показывает всё поле или приближает клетку с фишкой.
   © 2026 Евсеев А.В. */
(function (root) {
  'use strict';

  const { BOARD } = root.BAAI.data;
  const T = root.BAAI.theme;
  const C = T.C;

  // Мир поля 720×720, центр 360,360. Холст 1080×1080, базовый зум 1.5 — чётко на телефонах.
  const W = 720, CX = 360, CY = 360;
  const CANVAS = 1080, BASE = CANVAS / W;
  // клетка от inn до out; у внутреннего края — полоса владельца; дальше к центру тёмное кольцо (dots) и белый круг
  const R = { rimOut: 356, out: 330, band: 306, icon: 292, text: 228, ownW: 21, flake: 318, inn: 150, dots: 142, center: 134 };

  // Угловые клетки вдвое шире обычных
  const SC = 16, SN = (360 - 4 * SC) / 36;
  const SPAN = BOARD.map((_, i) => (i % 10 === 0 ? SC : SN));
  const START = [];
  { let a = 90 - SC / 2; for (let i = 0; i < 40; i++) { START.push(a); a += SPAN[i]; } }
  const ang = i => START[i] + SPAN[i] / 2;          // клетка 0 внизу, ход по часовой

  const CORNER = { 0: ['СТАРТ', '+200 ₽'], 10: ['ЗИМОВЬЁ', 'в гостях'], 20: ['ЫСЫАХ', 'приз'], 30: ['ПУРГА!', '→ в зимовьё'] };
  const TOKEN_R = [116];                             // где стоит фишка перед клеткой, внутри круга
  const TOKEN_STEP = 20, TOKEN_MIN = 52;              // столбик: шаг между фишками и ближе к центру не заходим
  const TOK = 33;
  const ICE = 0x1fa9f2;                              // ярко-голубой для снежинки залога
  const FONT = '"PT Sans Narrow", "Roboto Condensed", "Arial Narrow", sans-serif';

  const rad = d => d * Math.PI / 180;
  const polar = (r, deg) => [CX + r * Math.cos(rad(deg)), CY + r * Math.sin(rad(deg))];
  const hex = h => parseInt(h.slice(1), 16);

  function cellAt(deg) {
    const rel = (((deg - START[0]) % 360) + 360) % 360;
    for (let i = 0; i < 40; i++) if (rel < START[i] - START[0] + SPAN[i]) return i;
    return 0;
  }

  // ---------- неподвижная картинка поля ----------
  function sectorPath(r1, r2, a1, a2) {
    const f = n => n.toFixed(1);
    const [x1, y1] = polar(r2, a1), [x2, y2] = polar(r2, a2), [x3, y3] = polar(r1, a2), [x4, y4] = polar(r1, a1);
    const big = a2 - a1 > 180 ? 1 : 0;
    return `M${f(x1)} ${f(y1)}A${r2} ${r2} 0 ${big} 1 ${f(x2)} ${f(y2)}L${f(x3)} ${f(y3)}A${r1} ${r1} 0 ${big} 0 ${f(x4)} ${f(y4)}Z`;
  }

  function cellFill(i) {
    const t = BOARD[i].type;
    return { start: C.coral, jail: C.deep, parking: C.larch, gotojail: C.silver, tyusyulge: C.tyusyulge, bayanai: C.bayanai }[t] || C.paper;
  }

  function cellIconName(i) {
    const c = BOARD[i];
    if (c.type === 'prop') return T.GROUP_ICON[c.group];
    return T.CELL_ICON[i] || T.TYPE_ICON[c.type];
  }

  function buildBoardSVG(px) {
    const o = [];
    o.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${px}" height="${px}" viewBox="0 0 ${W} ${W}">`);
    // лировидный узор с коралловой бусиной, 40 раз по кругу
    o.push(`<defs><g id="ly"><path d="M360 13c-5.2 0-9.2 4-8.4 8.8.6 3.6 4.4 4.8 6.4 2.4M360 13c5.2 0 9.2 4 8.4 8.8-.6 3.6-4.4 4.8-6.4 2.4M360 18v9.2" fill="none" stroke="${C.rim}" stroke-width="2.2" stroke-linecap="round"/><circle cx="360" cy="9.2" r="2.4" fill="${C.coral}"/></g></defs>`);
    o.push(`<circle cx="${CX}" cy="${CY}" r="${R.rimOut}" fill="${C.ink}"/>`);
    o.push(`<circle cx="${CX}" cy="${CY}" r="${R.rimOut - 3}" fill="none" stroke="${C.silver}" stroke-width="1.5"/>`);
    for (let k = 0; k < 40; k++) o.push(`<use xlink:href="#ly" href="#ly" transform="rotate(${k * 9 + 4.5} ${CX} ${CY})"/>`);
    o.push(`<circle cx="${CX}" cy="${CY}" r="${R.out + 1}" fill="${C.ink}"/>`);

    for (let i = 0; i < 40; i++) {
      const c = BOARD[i], a = ang(i), a1 = START[i] + 0.35, a2 = START[i] + SPAN[i] - 0.35;
      const corner = i % 10 === 0;
      o.push(`<path d="${sectorPath(R.inn, R.out, a1, a2)}" fill="${cellFill(i)}"/>`);
      if (c.type === 'prop') o.push(`<path d="${sectorPath(R.band, R.out, a1, a2)}" fill="${T.GROUP[c.group]}"/>`);
      // иконка: верх смотрит в центр — в приближении у фишки она стоит прямо
      const isz = corner ? 44 : 22;
      const [ix, iy] = polar(R.icon, a);
      const icol = corner ? '#ffffff'
        : c.type === 'prop' ? T.GROUP[c.group]
        : c.type === 'tyusyulge' ? C.coral
        : c.type === 'bayanai' ? C.larch : C.ink;
      o.push(`<g transform="translate(${ix.toFixed(1)} ${iy.toFixed(1)}) rotate(${(a - 90).toFixed(2)}) scale(${isz / 24}) translate(-12 -12)">${T.iconSVG(cellIconName(i), icol, corner ? 1.6 : 2.3)}</g>`);
    }

    // тёмное внутреннее кольцо с ромбиками на границах клеток
    o.push(`<circle cx="${CX}" cy="${CY}" r="${R.inn}" fill="${C.ink}"/>`);
    for (let i = 0; i < 40; i++) {
      const [x, y] = polar(R.dots, START[i]);
      o.push(`<rect x="${(x - 3).toFixed(1)}" y="${(y - 3).toFixed(1)}" width="6" height="6" fill="${C.silver}" transform="rotate(45 ${x.toFixed(1)} ${y.toFixed(1)})"/>`);
    }
    o.push(`<circle cx="${CX}" cy="${CY}" r="${R.center}" fill="${C.snow}"/>`);

    // Аал Луук Мас — дерево жизни, по центру круга
    o.push(`<g transform="translate(${CX} ${CY + 6}) scale(0.56)">${T.treeSVG()}</g>`);
    o.push('</svg>');
    return o.join('');
  }

  function svgTexture(scene, key, svg) {
    return new Promise(resolve => {
      if (scene.textures.exists(key)) return resolve();
      const img = new Image();
      img.onload = () => { scene.textures.addImage(key, img); resolve(); };
      img.onerror = () => resolve();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  // Ждём шрифт для названий, но не дольше 1,5 с (без интернета будет системный)
  function fontReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const wait = Promise.all([document.fonts.load(`700 16px "PT Sans Narrow"`), document.fonts.load(`400 12px "PT Sans Narrow"`)]);
    return Promise.race([wait, new Promise(r => setTimeout(r, 1500))]).catch(() => {});
  }

  // ---------- сцена ----------
  class BoardScene extends Phaser.Scene {
    constructor(view) { super('board'); this.view = view; }

    create() {
      const cam = this.cameras.main;
      cam.setZoom(BASE); cam.centerOn(CX, CY);
      this.input.addPointer(1);
      this.tokens = [];
      this.shown = [];
      this.moving = false;
      this.queued = null;
      this.zoomed = false;
      this.ready = Promise.all([svgTexture(this, 'board', buildBoardSVG(2048)), fontReady()]).then(() => {
        this.add.image(CX, CY, 'board').setDisplaySize(W, W).setDepth(0);
        this.makeLabels();
        this.frost = this.add.graphics().setDepth(0.5);   // иней на заложенных клетках (под названиями)
        this.layer = this.add.graphics().setDepth(2);
        this.hl = this.add.graphics().setDepth(3);
        this.marks = this.add.graphics().setDepth(3.5);
        this.tweens.add({ targets: this.marks, alpha: { from: 1, to: 0.25 }, duration: 520, yoyo: true, repeat: -1 });
        this.tweens.add({ targets: this.hl, alpha: { from: 1, to: 0.35 }, duration: 700, yoyo: true, repeat: -1 });
        this.setupInput();
        if (this.view.pendingMark) { this.mark(this.view.pendingMark); this.view.pendingMark = null; }
        if (this.view.pending) { const p = this.view.pending; this.view.pending = null; this.apply(p.G, p.opts); }
      });
    }

    update() {
      const cam = this.cameras.main;
      const r = -cam.rotation;
      this.tokens.forEach(t => { if (t) t.rotation = r; });
      const z = cam.zoom > BASE * 1.03;
      if (z !== this.zoomed) { this.zoomed = z; this.view.setZoomed(z); }
    }

    // ----- названия клеток -----
    makeLabels() {
      // fit — сжать надпись, если не влезает (на телефоне без шрифта PT Sans Narrow буквы шире)
      const txt = (x, y, s, size, rot, color, bold, fit) => {
        const t = this.add.text(x, y, s, {
          fontFamily: FONT, fontSize: size.toFixed(1) + 'px', fontStyle: bold ? 'bold' : 'normal', color,
        }).setOrigin(0.5).setAngle(rot).setResolution(3).setDepth(1);
        if (t.width > fit) t.setScale(fit / t.width);
        return t;
      };
      const chord = (r, span) => 2 * r * Math.sin(rad(span / 2));
      this.labels = [];

      for (let i = 0; i < 40; i++) {
        const a = ang(i);
        if (i % 10) {
          const name = BOARD[i].short.replace(/\u00AD/g, '');
          const fs = Math.min(19, 104 / (name.length * 0.53));
          const [x, y] = polar(R.text, a);
          const rot = Math.cos(rad(a)) >= -0.001 ? a : a + 180;   // на левой половине разворачиваем
          const t = txt(x, y, name, fs, rot, C.ink, true, 104);
          this.labels[i] = { t, x, y, rot, a, fs, sx: t.scaleX };
        } else {
          // угол: две строки поперёк радиуса, читаются прямо, когда угол внизу или вверху
          const [main, sub] = CORNER[i];
          const low = Math.sin(rad(a)) >= -0.01;
          const rot = low ? a - 90 : a + 90;
          const rm = low ? 214 : 250, rs = low ? 246 : 218;
          const [mx, my] = polar(rm, a), [sx, sy] = polar(rs, a);
          txt(mx, my, main, 18, rot, '#ffffff', true, chord(rm, SC) - 10);
          const st = txt(sx, sy, sub, 12.5, rot, '#ffffff', false, chord(rs, SC) - 10);
          if (i === 20) { this.prizeLabel = st; this.prizeFit = chord(rs, SC) - 10; }
        }
      }
    }

    // ----- владельцы, дома, подсветка -----
    drawLayer(G) {
      const g = this.layer; g.clear();
      const f = this.frost; f.clear();
      for (const k in G.own) {
        const i = Number(k), o = G.own[k], a = ang(i);
        if (o.mortgaged) {
          // заложенная клетка «вмёрзла»: белёсый налёт поверх иконки и крупная снежинка
          const a1 = rad(START[i] + 0.35), a2 = rad(START[i] + SPAN[i] - 0.35);
          f.fillStyle(0xeef5fa, 0.78);
          f.beginPath(); f.arc(CX, CY, R.out, a1, a2, false); f.arc(CX, CY, R.inn, a2, a1, true); f.closePath(); f.fillPath();
          // снежинка — на цветной полоске группы у внешнего края (у клеток без полоски — там же)
          this.snowflake(f, ...polar(R.flake, a), a);
        }
        // полоса владельца: заливает низ клетки целиком — до тёмного кольца и до боковых стенок
        g.fillStyle(hex(G.players[o.owner].color), o.mortgaged ? 0.4 : 1);
        g.beginPath();
        g.arc(CX, CY, R.inn + R.ownW, rad(START[i] + 0.35), rad(START[i] + SPAN[i] - 0.35), false);
        g.arc(CX, CY, R.inn, rad(START[i] + SPAN[i] - 0.35), rad(START[i] + 0.35), true);
        g.closePath(); g.fillPath();
        if (BOARD[i].type === 'prop' && o.houses) {
          const n = o.houses;
          if (n === 5) this.balagan(g, a, R.flake);
          else for (let h = 0; h < n; h++) this.house(g, a + (h - (n - 1) / 2) * 1.9, R.flake);
        }
      }
      this.styleLabels(G);
      if (this.prizeLabel) {
        const t = this.prizeLabel;
        t.setScale(1).setText(G.prize ? 'приз ' + root.BAAI.engine.rub(G.prize) : 'приз');
        if (t.width > this.prizeFit) t.setScale(this.prizeFit / t.width);
      }
      const hl = this.hl; hl.clear();
      if (G.phase !== 'over') {
        const i = G.players[G.turn].pos;
        const a1 = rad(START[i] + 0.4), a2 = rad(START[i] + SPAN[i] - 0.4);
        hl.lineStyle(5, hex(C.coral), 1);
        hl.beginPath();
        hl.arc(CX, CY, R.out - 2.5, a1, a2, false);
        hl.arc(CX, CY, R.inn + 2.5, a2, a1, true);
        hl.closePath(); hl.strokePath();
      }
    }

    // Название заложенной клетки бледнеет, рядом строка «выкуп N ₽»
    styleLabels(G) {
      const E = root.BAAI.engine;
      (this.labels || []).forEach((L, i) => {
        if (!L) return;
        const m = !!(G.own[i] && G.own[i].mortgaged);
        if (L.m === m) return;
        L.m = m;
        // заложенная: две строки помельче и чуть ближе к внешнему краю, где клетка шире — не касаются стенок
        const dn = [-Math.sin(rad(L.rot)), Math.cos(rad(L.rot))];   // «вниз» для строки текста
        const [bx, by] = m ? polar(R.text + 10, L.a) : [L.x, L.y];
        const sh = m ? -6 : 0;
        L.t.setScale(m ? Math.min(L.sx, 13.5 / L.fs, 76 / L.t.width) : L.sx);
        L.t.setPosition(bx + dn[0] * sh, by + dn[1] * sh).setColor(m ? '#8aa3b5' : C.ink);
        if (m && !L.sub) {
          L.sub = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '10.5px', fontStyle: 'bold', color: C.deep })
            .setOrigin(0.5).setAngle(L.rot).setResolution(3).setDepth(1);
        }
        if (L.sub) {
          L.sub.setVisible(m);
          if (m) {
            L.sub.setScale(1).setText('выкуп ' + E.rub(E.unmortgageCost(i)));
            if (L.sub.width > 76) L.sub.setScale(76 / L.sub.width);
            L.sub.setPosition(bx + dn[0] * 7, by + dn[1] * 7);
          }
        }
      });
    }

    // золотая рамка вокруг клеток, где можно строить
    mark(cells) {
      const g = this.marks; g.clear();
      (cells || []).forEach(i => {
        g.lineStyle(6, hex(C.gold), 1); this.sector(g, i); g.strokePath();
        g.fillStyle(hex(C.gold), 0.22); this.sector(g, i); g.fillPath();
      });
    }

    // Фигура на кольце: точки [u, v] — u вдоль кольца, v от центра наружу; центр на угле c, радиус r
    shape(g, c, r, pts, fill, line) {
      const t = rad(c), n = [Math.cos(t), Math.sin(t)], tg = [-Math.sin(t), Math.cos(t)];
      const [x, y] = polar(r, c);
      const v2 = pts.map(([u, v]) => new Phaser.Math.Vector2(x + tg[0] * u + n[0] * v, y + tg[1] * u + n[1] * v));
      g.fillStyle(fill, 1); g.fillPoints(v2, true);
      if (line !== false) { g.lineStyle(1.4, hex(C.ink), 1); g.strokePoints(v2, true); }
    }

    // Домик: крыша смотрит к центру круга, как иконки (в приближении стоит прямо)
    house(g, c, r) {
      this.shape(g, c, r, [[-4.8, 6.5], [4.8, 6.5], [4.8, -0.5], [0, -6.5], [-4.8, -0.5]], 0xffffff);
      this.shape(g, c, r, [[-1.4, 6.5], [1.4, 6.5], [1.4, 2.4], [-1.4, 2.4]], hex(C.ink), false);   // дверь
    }

    // Отель — коралловый балаган: стены сходятся кверху, плоская крыша со снегом, дверь
    balagan(g, c, r) {
      this.shape(g, c, r, [[-11, 7.5], [11, 7.5], [8, -3], [-8, -3]], hex(C.coral));
      this.shape(g, c, r, [[-10, -3], [10, -3], [8.5, -7.5], [-8.5, -7.5]], 0xffffff);
      this.shape(g, c, r, [[-2, 7.5], [2, 7.5], [2, 1.5], [-2, 1.5]], hex(C.ink), false);
    }

    // Ярко-голубая снежинка с тонкой белой обводкой
    snowflake(f, x, y, a) {
      const rays = (w, col) => {
        f.lineStyle(w, col, 1);
        for (let k = 0; k < 3; k++) {
          const t = rad(k * 60 + a), cx = Math.cos(t), sy = Math.sin(t);
          f.lineBetween(x - 9 * cx, y - 9 * sy, x + 9 * cx, y + 9 * sy);
          for (const e of [-1, 1]) {     // усики на концах лучей
            const ex = x + e * 6 * cx, ey = y + e * 6 * sy, t2 = e > 0 ? t : t + Math.PI;   // веточки смотрят к кончику луча
            f.lineBetween(ex, ey, ex + 3.6 * Math.cos(t2 + 0.7), ey + 3.6 * Math.sin(t2 + 0.7));
            f.lineBetween(ex, ey, ex + 3.6 * Math.cos(t2 - 0.7), ey + 3.6 * Math.sin(t2 - 0.7));
          }
        }
      };
      rays(4.6, 0xffffff);
      rays(2.4, ICE);
      f.fillStyle(ICE, 1); f.fillCircle(x, y, 2.2);
    }

    // ----- фишки: стоят внутри круга перед своей клеткой, столбиком по лучу -----
    // Первой (ближе всех к клетке и поверх) — фишка того, кто ходит, дальше — по порядку игроков
    slotOf(G, p) {
      const cell = this.shown[p];
      const here = G.players.map((_, q) => q).filter(q => !G.players[q].bankrupt && this.shown[q] === cell)
        .sort((a, b) => (a === G.turn ? -1 : b === G.turn ? 1 : a - b));
      return { k: Math.max(0, here.indexOf(p)), n: here.length };
    }

    // k-я фишка из n на клетке: на луче клетки, от края круга к центру, внахлёст, как стопка монет
    tokenXY(cell, k, n) {
      const step = n > 1 ? Math.min(TOKEN_STEP, (TOKEN_R[0] - TOKEN_MIN) / (n - 1)) : 0;
      return polar(TOKEN_R[0] - k * step, ang(cell));
    }

    async ensureTokens(G) {
      for (let p = 0; p < G.players.length; p++) {
        const pl = G.players[p];
        const key = `tok-${pl.figure || 'horse'}-${pl.color}`;
        await svgTexture(this, key, T.tokenSVG(pl.figure || 'horse', pl.color, 96));
        if (!this.tokens[p]) {
          this.tokens[p] = this.add.image(0, 0, key).setDisplaySize(TOK, TOK).setDepth(10 + p);
          this.shown[p] = pl.pos;
        }
      }
    }

    placeTokens(G, instant) {
      G.players.forEach((pl, p) => {
        const s = this.tokens[p]; if (!s) return;
        s.setVisible(!pl.bankrupt);
        const { k, n } = this.slotOf(G, p);
        const [x, y] = this.tokenXY(this.shown[p], k, n);
        if (instant) { s.x = x; s.y = y; } else this.tweens.add({ targets: s, x, y, duration: 180 });
        s.setDepth(30 - k);   // ближняя к клетке — сверху
      });
    }

    // Пошаговое движение фишки; далеко (пурга, карточки) — прыжок через центр
    walk(G, p, to, done) {
      const from = this.shown[p], s = this.tokens[p];
      if (to === from) return done();
      const fwd = (to - from + 40) % 40, back = (from - to + 40) % 40;
      const steps = fwd <= 12 ? fwd : (back <= 3 ? -back : 0);
      s.setDepth(40);
      if (!steps) {
        this.shown[p] = to;
        const snow = G.players[p].inJail;
        const [x, y] = this.tokenXY(to, 0, 1);
        let last = 0;
        this.tweens.add({ targets: s, x, y, duration: 900, ease: 'Sine.easeInOut',
          onUpdate: tw => {
            const k = Math.sin(tw.progress * Math.PI); s.setDisplaySize(TOK + 26 * k, TOK + 26 * k);
            if (snow && tw.progress - last > 0.04) { last = tw.progress; this.flake(s.x, s.y); }
          },
          onComplete: () => { s.setDisplaySize(TOK, TOK); done(); } });
        return;
      }
      const dir = Math.sign(steps);
      let left = Math.abs(steps);
      const one = () => {
        if (!left) return done();
        const cur = this.shown[p], next = (cur + dir + 40) % 40;
        const a0 = ang(cur);
        let a1 = ang(next);
        if (dir > 0 && a1 < a0) a1 += 360;
        if (dir < 0 && a1 > a0) a1 -= 360;
        this.tweens.addCounter({ from: 0, to: 1, duration: 150, ease: 'Sine.easeInOut',
          onUpdate: tw => {
            const v = tw.getValue(); const [x, y] = polar(TOKEN_R[0], a0 + (a1 - a0) * v);
            s.x = x; s.y = y; const k = Math.sin(v * Math.PI); s.setDisplaySize(TOK + 8 * k, TOK + 8 * k);
          },
          onComplete: () => { this.shown[p] = next; left--; if (this.view.onStep) this.view.onStep(left); one(); } });
      };
      one();
    }

    // снежинка в хвосте у фишки, которую унесло пургой
    flake(x, y) {
      const f = this.add.circle(x + (Math.random() - 0.5) * 18, y + (Math.random() - 0.5) * 18, 2.5 + Math.random() * 2.5, 0xffffff)
        .setStrokeStyle(1.2, hex(C.silver)).setDepth(35);
      this.tweens.add({ targets: f, alpha: 0, scale: 0.2, duration: 700, onComplete: () => f.destroy() });
    }


    // ----- эффекты: вспышка клетки, пыль от стройки, иней, бусы-салют -----
    sector(g, i) {
      const a1 = rad(START[i] + 0.35), a2 = rad(START[i] + SPAN[i] - 0.35);
      g.beginPath(); g.arc(CX, CY, R.out, a1, a2, false); g.arc(CX, CY, R.inn, a2, a1, true); g.closePath();
    }

    flash(i, color) {
      const g = this.add.graphics().setDepth(1.5);
      g.fillStyle(hex(color), 0.42); this.sector(g, i); g.fillPath();
      g.lineStyle(5, hex(color), 1); this.sector(g, i); g.strokePath();
      this.tweens.add({ targets: g, alpha: { from: 1, to: 0 }, duration: 520, repeat: 2, onComplete: () => g.destroy() });
    }

    // разлёт кружков из точки: цвета, число, дальность, время, размер
    burst(x, y, colors, n, dist, ms, size, delay) {
      for (let k = 0; k < n; k++) {
        const t = (k / n) * Math.PI * 2 + Math.random() * 0.4;
        const d = dist * (0.55 + Math.random() * 0.6);
        const c = this.add.circle(x, y, size * (0.6 + Math.random() * 0.7), hex(colors[k % colors.length])).setDepth(36).setAlpha(0);
        if (colors[k % colors.length] === '#ffffff') c.setStrokeStyle(1, hex(C.silver));
        this.tweens.add({ targets: c, x: x + Math.cos(t) * d, y: y + Math.sin(t) * d, alpha: { from: 1, to: 0 }, scale: { from: 1, to: 0.4 },
          duration: ms * (0.8 + Math.random() * 0.4), delay: delay || 0, ease: 'Cubic.easeOut', onComplete: () => c.destroy() });
      }
    }

    // дом вырос: пыль и кольцо; отель — коралловые искры
    puff(i, hotel) {
      const [x, y] = polar(R.flake, ang(i));
      const ring = this.add.circle(x, y, 8).setStrokeStyle(3, hex(hotel ? C.coral : C.ink)).setDepth(36);
      this.tweens.add({ targets: ring, scale: 4, alpha: 0, duration: 650, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
      this.burst(x, y, hotel ? [C.coral, C.gold, '#ffffff'] : ['#ffffff', C.silver, '#ffffff'], hotel ? 18 : 12, hotel ? 58 : 42, 750, 4.5);
    }

    // клетка вмерзает в лёд: белая волна и снежинки
    freeze(i) {
      const g = this.add.graphics().setDepth(0.6);
      g.fillStyle(0xffffff, 0.9); this.sector(g, i); g.fillPath();
      this.tweens.add({ targets: g, alpha: { from: 0, to: 0.9 }, duration: 260, yoyo: true, onComplete: () => g.destroy() });
      const a = ang(i);
      for (let k = 0; k < 9; k++) {
        const r = R.inn + 20 + Math.random() * (R.out - R.inn - 40), d = a + (Math.random() - 0.5) * SPAN[i] * 0.7;
        const [x, y] = polar(r, d);
        const f = this.add.star(x, y, 6, 2.2, 8, 0xffffff).setStrokeStyle(1, hex(C.deep)).setDepth(36).setAlpha(0).setScale(0.3);
        this.tweens.add({ targets: f, alpha: { from: 0, to: 1 }, scale: 1.3, angle: 60, duration: 420, delay: k * 50, yoyo: true, hold: 200, onComplete: () => f.destroy() });
      }
    }

    // лёд тает: капли стекают к центру круга
    melt(i) {
      const a = ang(i);
      for (let k = 0; k < 10; k++) {
        const d = a + (Math.random() - 0.5) * SPAN[i] * 0.7;
        const [x, y] = polar(R.out - 20 - Math.random() * 60, d);
        const [x2, y2] = polar(R.inn - 10 - Math.random() * 30, d);
        const c = this.add.circle(x, y, 4 + Math.random() * 3, 0x8fc1e3).setDepth(36);
        this.tweens.add({ targets: c, x: x2, y: y2, alpha: { from: 1, to: 0 }, duration: 700 + Math.random() * 300, delay: k * 40, ease: 'Quad.easeIn', onComplete: () => c.destroy() });
      }
    }

    // салют из бус над клеткой (приз Ысыаха) или над деревом (победа)
    fireworks(i) {
      const [x, y] = i === undefined || i === null ? [CX, CY - 40] : polar(R.text + 10, ang(i));
      const cols = [C.coral, C.gold, C.larch, '#ffffff', C.deep];
      for (let w = 0; w < 3; w++) {
        const ox = (Math.random() - 0.5) * 50, oy = (Math.random() - 0.5) * 50;
        this.burst(x + ox, y + oy, cols, 26, 110 + w * 20, 1100, 7, w * 320);
      }
    }

    // ----- камера -----
    camTo(zoom, cx, cy, rot, ms) {
      const cam = this.cameras.main;
      const z0 = cam.zoom, r0 = cam.rotation, m0 = cam.midPoint.clone();
      let dr = rot - r0;
      while (dr > Math.PI) dr -= 2 * Math.PI;
      while (dr < -Math.PI) dr += 2 * Math.PI;
      if (this.camTween) this.camTween.stop();
      this.camTween = this.tweens.addCounter({ from: 0, to: 1, duration: ms ?? 650, ease: 'Cubic.easeInOut',
        onUpdate: tw => {
          const v = tw.getValue();
          cam.setZoom(z0 + (zoom - z0) * v);
          cam.setRotation(r0 + dr * v);
          cam.centerOn(m0.x + (cx - m0.x) * v, m0.y + (cy - m0.y) * v);
        } });
    }

    showAll(ms) { this.camTo(BASE, CX, CY, 0, ms); }

    followCell(cell, ms) {
      const a = ang(cell);
      const [x, y] = polar(165, a);
      this.camTo(BASE * 1.9, x, y, rad(90 - a), ms);     // клетка внизу экрана
    }

    clampCam() {
      const cam = this.cameras.main;
      if (cam.zoom <= BASE * 1.02) { cam.setZoom(BASE); cam.centerOn(CX, CY); return; }
      const m = cam.midPoint, dx = m.x - CX, dy = m.y - CY, d = Math.hypot(dx, dy);
      const max = 360 - 360 * BASE / cam.zoom + 30;
      if (d > max) cam.centerOn(CX + dx * max / d, CY + dy * max / d);
    }

    // ----- жесты -----
    setupInput() {
      const cam = this.cameras.main;
      const p1 = this.input.pointer1, p2 = this.input.pointer2;
      let down = null;
      // щипок двумя пальцами ведёт BoardView по событиям касания (this.pinching), здесь только один палец
      this.input.on('pointerdown', p => {
        if (this.pinching || (p1.isDown && p2.isDown)) { down = null; return; }
        down = { x: p.x, y: p.y, moved: false, mid: cam.midPoint.clone() };
      });
      this.input.on('pointermove', p => {
        if (this.pinching) { down = null; return; }
        if (!down || !p.isDown) return;
        const dx = p.x - down.x, dy = p.y - down.y;
        if (!down.moved && Math.hypot(dx, dy) < 10) return;
        down.moved = true;
        if (cam.zoom <= BASE * 1.02) return;           // весь круг виден — палец листает страницу
        if (this.camTween) this.camTween.stop();
        const r = cam.rotation, z = cam.zoom;
        const wx = (dx * Math.cos(r) + dy * Math.sin(r)) / z, wy = (-dx * Math.sin(r) + dy * Math.cos(r)) / z;
        cam.centerOn(down.mid.x - wx, down.mid.y - wy);
        this.clampCam();
      });
      this.input.on('pointerup', p => {
        if (this.pinching) { down = null; return; }
        if (down && !down.moved) this.tap(p);
        down = null;
      });
      this.input.on('wheel', (p, o, dx, dy) => {
        cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), BASE, BASE * 3.2));
        this.clampCam();
      });
    }

    // Щипок: точка поля под пальцами остаётся под пальцами
    pinchStart(x, y) {
      const cam = this.cameras.main;
      if (this.camTween) this.camTween.stop();
      cam.preRender();
      this.pinching = { z: cam.zoom, w: cam.getWorldPoint(x, y) };
    }
    pinchMove(k, x, y) {
      const P = this.pinching; if (!P) return;
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(P.z * k, BASE, BASE * 3.2));
      cam.preRender();
      const w = cam.getWorldPoint(x, y), m = cam.midPoint;
      cam.centerOn(m.x + P.w.x - w.x, m.y + P.w.y - w.y);
      this.clampCam();
    }
    pinchEnd() { this.pinching = null; }

    tap(p) {
      // одно касание может прийти дважды (касание и мышь) — второе не считаем
      const now = Date.now();
      if (now - (this.lastTap || 0) < 400) return;
      this.lastTap = now;
      const w = this.cameras.main.getWorldPoint(p.x, p.y);
      const dx = w.x - CX, dy = w.y - CY, r = Math.hypot(dx, dy);
      if (r < R.inn - 50 || r > R.out + 4) return;     // клетка или фишки перед ней
      const i = cellAt(Math.atan2(dy, dx) * 180 / Math.PI);
      if (this.view.onCellTap) this.view.onCellTap(i);
    }

    // ----- применить новое состояние партии -----
    async apply(G, opts = {}) {
      if (this.moving) {
        // не теряем то, что ждало окончания хода (карточка, звуки, монеты)
        const prev = this.queued && this.queued.opts.onSettled;
        if (prev) { const next = opts.onSettled; opts = Object.assign({}, opts, { onSettled: () => { prev(); if (next) next(); } }); }
        this.queued = { G, opts }; return;
      }
      this.moving = true;
      await this.ensureTokens(G);
      const first = this.lastTurn === undefined;
      this.lastTurn = G.turn;
      this.drawLayer(G);
      if (first) this.placeTokens(G, true);
      const movers = G.players.map((_, p) => p).filter(p => !G.players[p].bankrupt && this.shown[p] !== G.players[p].pos);
      const finish = () => {
        this.placeTokens(G);
        if (opts.turnChanged || first) this.showAll();
        else if (opts.rolled || movers.includes(G.turn)) this.followCell(G.players[G.turn].pos);
        this.moving = false;
        if (opts.onSettled) this.time.delayedCall(opts.rolled ? 450 : 0, opts.onSettled);
        if (this.queued) { const q = this.queued; this.queued = null; this.apply(q.G, q.opts); }
      };
      const go = () => {
        let left = movers.length;
        if (!left) return finish();
        movers.forEach(p => this.walk(G, p, G.players[p].pos, () => { if (--left === 0) finish(); }));
      };
      // кубики катятся на экране под полем — ждём их
      if (opts.rolled) this.time.delayedCall(650, go); else go();
    }
  }

  // ---------- то, чем пользуется ui.js ----------
  class BoardView {
    constructor(parent, opts = {}) {
      this.el = parent;
      // Phaser меряет внутренний слой без рамки — иначе холст шире места и край кольца обрезается
      const inner = document.createElement('div');
      inner.className = 'board-in';
      parent.appendChild(inner);
      this.onCellTap = opts.onCellTap;
      this.onStep = opts.onStep;
      this.pending = null;
      this.scene = new BoardScene(this);
      this.game = new Phaser.Game({
        type: Phaser.AUTO, parent: inner, width: CANVAS, height: CANVAS, transparent: true,
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        // touch.capture: false — Phaser не мешает листать страницу пальцем по полю
        input: { activePointers: 3, touch: { capture: false } },
        banner: false, audio: { noAudio: true },
        scene: this.scene,
      });
      this.pinchTouch(inner);
      // поворот экрана, клавиатура, панель браузера — пересчитать размер холста
      if (window.ResizeObserver) new ResizeObserver(() => this.game.scale && this.game.scale.refresh()).observe(inner);
    }
    // Два пальца на поле всегда приближают поле, а не страницу (Яндекс Браузер, Chrome, Safari).
    // Ловим касания сами и не отдаём их браузеру; один палец по-прежнему листает страницу.
    pinchTouch(el) {
      let d0 = 0;
      const two = e => e.touches.length >= 2;
      const pts = e => {
        const sc = this.game.scale, a = e.touches[0], b = e.touches[1];
        const ax = sc.transformX(a.pageX), ay = sc.transformY(a.pageY), bx = sc.transformX(b.pageX), by = sc.transformY(b.pageY);
        return { d: Math.hypot(ax - bx, ay - by) || 1, x: (ax + bx) / 2, y: (ay + by) / 2 };
      };
      const start = e => {
        if (!two(e) || !this.scene.layer) return;
        if (e.cancelable) e.preventDefault();
        const p = pts(e); d0 = p.d;
        this.scene.pinchStart(p.x, p.y);
      };
      const move = e => {
        if (!this.scene.pinching) return;
        if (e.cancelable) e.preventDefault();
        if (!two(e)) return;
        const p = pts(e);
        this.scene.pinchMove(p.d / d0, p.x, p.y);
      };
      const end = e => {
        if (!this.scene.pinching) return;
        if (e.cancelable) e.preventDefault();
        if (two(e)) { const p = pts(e); d0 = p.d; this.scene.pinchStart(p.x, p.y); return; }
        // последний палец отпущен — только тогда снова можно тапать и листать
        if (!e.touches.length) setTimeout(() => this.scene.pinchEnd(), 50);
      };
      el.addEventListener('touchstart', start, { passive: false });
      el.addEventListener('touchmove', move, { passive: false });
      el.addEventListener('touchend', end, { passive: false });
      el.addEventListener('touchcancel', end, { passive: false });
      // жест-зум страницы в Safari
      el.addEventListener('gesturestart', e => e.preventDefault());
    }
    // Подсветить клетки (где можно строить); пустой список — убрать
    mark(cells) { if (this.scene.layer) this.scene.mark(cells); else this.pendingMark = cells; }
    setZoomed(z) { this.el.classList.toggle('zoomed', z); }
    update(G, opts) {
      const s = this.scene;
      if (!s.layer) { this.pending = { G, opts }; return; }
      s.apply(G, opts || {});
    }
    reset() {
      const s = this.scene;
      if (s.tokens) { s.tokens.forEach(t => t && t.destroy()); s.tokens = []; s.shown = []; s.lastTurn = undefined; s.moving = false; s.queued = null; }
    }
    showAll() { if (this.scene.layer) this.scene.showAll(); }
    focus(cell) { if (this.scene.layer) this.scene.followCell(cell); }
    // эффект на поле: flash, puff, freeze, melt, fireworks
    fx(name, ...args) { const s = this.scene; if (s.layer && s[name]) s[name](...args); }
  }

  root.BAAI = root.BAAI || {};
  root.BAAI.BoardView = BoardView;
  root.BAAI.buildBoardSVG = buildBoardSVG;
})(window);
