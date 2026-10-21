/* «Баай» — тема оформления «Осуохай»: цвета, иконки, фигурки фишек.
   Всё, что касается внешнего вида, правится здесь.
   © 2026 Евсеев А.В. */
(function (root) {
  'use strict';

  const C = {
    snow: '#eef1f2',      // фон
    paper: '#f8f9fa',     // клетки
    ink: '#1d2430',       // чернёное серебро: линии, текст
    silver: '#8d99a6',
    rim: '#dfe4e8',
    coral: '#c8473d',     // коралл: главное действие, Старт
    larch: '#3f6b4a',     // лиственница: Байанай, Ысыах
    deep: '#23395d',      // глубокий синий: зимовьё
    gold: '#c9a23a',
    muted: '#6b7a86',
    tyusyulge: '#f3e2dc',
    bayanai: '#e2ebe1',
  };

  // Приглушённые цвета групп (заменяют яркие из data.js на поле)
  const GROUP = {
    1: '#8b6a4f', 2: '#5f8fa8', 3: '#9a5a7c', 4: '#c27a3a',
    5: '#b5473f', 6: '#c9a23a', 7: '#3f7a5a', 8: '#2f4f86',
  };

  // Цвета игроков: различимы и по светлоте
  const PLAYER = ['#c8473d', '#23395d', '#3f7a5a', '#c9a23a', '#7a4f8a', '#4f9fc0'];

  // Иконки 24×24. s — линии, f — заливка.
  const ICONS = {
    fish:   { s: 'M2 12c3-4.5 8-5.5 12-3l5-3.5v13L14 15c-4 2.5-9 1.5-12-3z', f: 'M6.2 11a.9.9 0 101.8 0 .9.9 0 10-1.8 0z' },
    boat:   { s: 'M3 14h18l-3 5H6zM12 14V4l6 8h-6' },
    urasa:  { s: 'M12 3L4 20h16zM12 3v17M9 20l3-6 3 6' },
    pick:   { s: 'M3 9c5-5 13-5 18 0M12 6.5L11 21h2z' },
    frost:  { s: 'M10 4a2 2 0 014 0v10.5a4 4 0 11-4 0zM12 9v8' },
    beacon: { s: 'M9 21l1.5-13h3L15 21zM7 21h10M10 8h4l-.5-3h-3zM3 4l5 3M21 4l-5 3' },
    diamond:{ s: 'M6 4h12l3 5-9 11L3 9zM3 9h18M9 4l3 16M15 4l-3 16' },
    serge:  { s: 'M12 2v20M8 5h8M8 8h8M9.5 12h5M7 21h10' },
    ship:   { s: 'M3 15h18l-2 4H5zM6 15V9h12v6M9 9V6h4v3' },
    ferry:  { s: 'M4 15l2-5h12l2 5zM8 10V7h8v3M2 19c2.5 1.3 4.5 1.3 7 0s4.5-1.3 7 0 4.5 1.3 6 .5' },
    train:  { s: 'M6 3h12v12H6zM6 10h12M8 19l-2 2M16 19l2 2M9 15v2M15 15v2' },
    plane:  { s: 'M21 13l-8-2.5V4.5a1 1 0 00-2 0v6L3 13v2l8-1.5v5L9 20v1.5h6V20l-2-1.5v-5l8 1.5z' },
    bolt:   { s: 'M13 2L5 14h6l-1 8 8-12h-6z' },
    flame:  { s: 'M12 2c1 4 6 6 6 12a6 6 0 01-12 0c0-3 2-4 2-7 2 1 3 3 3 5 1-3 1-6 1-10z' },
    coin:   { s: 'M4 12a8 8 0 1016 0 8 8 0 10-16 0zM10 7v10M10 7h3a2.5 2.5 0 010 5h-3M8.5 14.5h5' },
    bow:    { s: 'M6 3c7 3 7 15 0 18M6 3v18M3 12h18M18 9l3 3-3 3' },
    bowl:   { s: 'M3 10h18c0 5-4 8-9 8s-9-3-9-8zM7 18l-1 3h12l-1-3M8 13h8' },
    start:  { s: 'M20 12H4M10 6l-6 6 6 6' },
    jail:   { s: 'M5 4v16M9.7 4v16M14.3 4v16M19 4v16M3 4h18M3 20h18' },
    sun:    { s: 'M8 12a4 4 0 108 0 4 4 0 10-8 0zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2' },
    snow:   { s: 'M12 2v20M3 7l18 10M21 7L3 17M9 3l3 3 3-3M9 21l3-3 3 3' },
    hut:    { s: 'M4.2 21l1.9-10h11.8l1.9 10zM3 21h18M5.5 14.2h13M5 17.6h14M10.4 21v-4.6h3.2V21M15.4 8.3V5.2h2.2v3.1M16.8 3.6c-.9-.7-.2-1.6-.6-2.4',
              f: 'M4.4 11.1c1.4-2 4.3-3 7.6-3s6.2 1 7.6 3z' },
    ysyakh: { s: 'M12 6.5V21M9.6 9h4.8M9.6 12.2h4.8M10.2 15.6h3.6M2 21h20M2.6 13.5h5.2l-.9 3.2H3.5zM4.2 16.7l-.7 3.3M6.2 16.7l.7 3.3M16.2 13.5h5.2l-.9 3.2h-3.4zM17.8 16.7l-.7 3.3M19.8 16.7l.7 3.3',
              f: 'M10.4 4.6a1.6 1.6 0 103.2 0 1.6 1.6 0 10-3.2 0zM3.2 6.2a1.9 1.9 0 103.8 0 1.9 1.9 0 10-3.8 0z' },
    blizzard:{ s: 'M3 8h10a3 3 0 10-3-3M3 13h15a3 3 0 11-3 3M3 18h7', f: 'M18 4.2a1 1 0 102 0 1 1 0 10-2 0zM19.5 9a1 1 0 102 0 1 1 0 10-2 0zM13 19.5a1 1 0 102 0 1 1 0 10-2 0z' },
    swap:   { s: 'M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4' },
    house:  { s: 'M3.5 11L12 4l8.5 7M6 9.5V20h12V9.5M10 20v-5h4v5' },
    card:   { s: 'M3 6h18v12H3zM3 10h18M6.5 14.5h4' },
    grow:   { s: 'M3 20h18M4 16l5-5 4 3 7-8M15 6h5v5' },
    eye:    { s: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12zM9 12a3 3 0 106 0 3 3 0 10-6 0z' },
    mask:   { s: 'M4 5c5 1.5 11 1.5 16 0v6c0 5-3.6 9-8 9s-8-4-8-9zM7.5 10.5c1-1 2.5-1 3.5 0M13 10.5c1-1 2.5-1 3.5 0M9 15.5c2 1.4 4 1.4 6 0' },
    drum:   { s: 'M4 12a8 8 0 1016 0 8 8 0 10-16 0zM12 4v16M4 12h16M7 7l10 10M17 7 7 17', f: 'M10.4 12a1.6 1.6 0 103.2 0 1.6 1.6 0 10-3.2 0z' },
    anvil:  { s: 'M3 7h13c0 3 2 4 5 4-3 1-5 2-6 4H9c-1-2-3-3-6-3zM9 15l-2 5h10l-2-5' },
    scales: { s: 'M12 3v18M8 21h8M4 6h16M6 6l-3 7h6zM18 6l-3 7h6z' },
    sled:   { s: 'M3 17h15c2 0 3-1 3-3M6 17v-4h10v4M8 13l1-4h5l1 4M2 20h17' },
    crown:  { s: 'M3 8l4 4 5-7 5 7 4-4-2 11H5zM5 19h14' },
    scroll: { s: 'M7 4h11a2 2 0 010 4H7zM7 4a2 2 0 00-2 2v12a2 2 0 002 2h10V8M9 12h6M9 15h4' },
    gavel:  { s: 'M13.5 3.5l6 6M11 6l6 6M10 12.5l-6.5 6.5M8.5 8.5l6 6M4 21h9' },
    bank:   { s: 'M3 9l9-5 9 5M5 9v8M9.7 9v8M14.3 9v8M19 9v8M3 20h18' },
    sound:  { s: 'M4 9.5h3.5L12 5v14l-4.5-4.5H4zM15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11' },
    mute:   { s: 'M4 9.5h3.5L12 5v14l-4.5-4.5H4zM16 9.5l5 5M21 9.5l-5 5' },
    vibe:   { s: 'M8.5 3h7v18h-7zM11 18h2M4.5 8v8M2 10v4M19.5 8v8M22 10v4' },
  };
  const GROUP_ICON = { 1: 'fish', 2: 'boat', 3: 'urasa', 4: 'pick', 5: 'frost', 6: 'beacon', 7: 'diamond', 8: 'serge' };
  const CELL_ICON = { 5: 'ship', 15: 'ferry', 25: 'train', 35: 'plane', 12: 'bolt', 28: 'flame' };
  const TYPE_ICON = { tax: 'coin', bayanai: 'bow', tyusyulge: 'bowl', start: 'start', jail: 'hut', parking: 'ysyakh', gotojail: 'blizzard' };

  // Фигурки фишек 24×24: f — белый силуэт (одна или несколько фигур, дырки через evenodd),
  // s — белые линии, d — детали цветом фишки поверх силуэта (глаза, нос, кайма).
  const FIGURES = [
    { id: 'horse', name: 'Конь',
      f: ['M17.2 22.5c.6-4.6.4-9.6-2.2-13.6l-.9-1.4.3-3.6-1.9 2.1C10.3 6 7.6 8.6 5.3 12c-.8 1.2-.6 2.6.6 3.1 1.3.5 2.6.1 3.8-.7l1.4-.9c.3 3.4-.4 6.4-1.4 9z',
        'M14.4 3.9c4 1.2 6.4 5.1 6.9 10.6l-2-1.3.3 2.9-2.1-1.5-.1 3-1.9-1.7c.2-4.2-.4-8.2-1.1-12z'],
      d: 'M10.1 8.6a.95.95 0 101.9 0 .95.95 0 10-1.9 0zM5.9 12.9a.6.6 0 101.2 0 .6.6 0 10-1.2 0z' },
    { id: 'deer', name: 'Олень',
      f: ['M12 9.2c2.6 0 4.2 1.5 4.2 3.7 0 2.5-1.9 4.7-2.7 7.5-.3 1-.8 1.6-1.5 1.6s-1.2-.6-1.5-1.6c-.8-2.8-2.7-5-2.7-7.5 0-2.2 1.6-3.7 4.2-3.7z',
        'M8.5 11 4 9.9c.9 1.8 2.5 2.7 4.4 2.9zM15.5 11l4.5-1.1c-.9 1.8-2.5 2.7-4.4 2.9z'],
      s: 'M10.6 9.4C9.2 7.3 8.7 5 9 2.4M9.1 6.3 6.6 4.9M8.9 4.1 6.9 2.1M13.4 9.4c1.4-2.1 1.9-4.4 1.6-7M14.9 6.3l2.5-1.4M15.1 4.1l2-2',
      d: 'M9.6 12.9a.85.85 0 101.7 0 .85.85 0 10-1.7 0zM12.7 12.9a.85.85 0 101.7 0 .85.85 0 10-1.7 0zM11 19.6h2l-1 1.3z' },
    { id: 'choron', name: 'Чорон',
      f: ['M4.2 3h15.6c0 5.8-1.9 9.7-5.2 11.2V16H9.4v-1.8C6.1 12.7 4.2 8.8 4.2 3z'],
      s: 'M10 16.2l-2.6 5.6M14 16.2l2.6 5.6M12 16.2v5.9',
      d: 'M5.9 5.6h12.2v1.1H5.9zM7.4 8.2l1.2 1.3 1.2-1.3 1.1 1.3 1.1-1.3 1.1 1.3 1.1-1.3 1.2 1.3 1.2-1.3v.9l-1.2 1.3-1.2-1.3-1.1 1.3-1.1-1.3-1.1 1.3-1.1-1.3-1.2 1.3-1.2-1.3z' },
    { id: 'khomus', name: 'Хомус',
      f: ['M12 1.4a5.6 5.6 0 110 11.2 5.6 5.6 0 110-11.2zM12 4.1a2.9 2.9 0 100 5.8 2.9 2.9 0 100-5.8z', 'M8.6 10.4h1.8v11.6H8.6zM13.6 10.4h1.8v11.6h-1.8zM11.3 8.6h1.4v12.2l2.4-1.6.8 1.1-4.6 3z'], },
    { id: 'bear', name: 'Медведь',
      f: ['M3.6 6.8a3.1 3.1 0 106.2 0 3.1 3.1 0 10-6.2 0zM14.2 6.8a3.1 3.1 0 106.2 0 3.1 3.1 0 10-6.2 0z',
        'M12 6.4c4.6 0 8 3.2 8 7.6 0 4.6-3.6 7.6-8 7.6s-8-3-8-7.6c0-4.4 3.4-7.6 8-7.6z'],
      d: 'M5.4 6.8a1.3 1.3 0 102.6 0 1.3 1.3 0 10-2.6 0zM16 6.8a1.3 1.3 0 102.6 0 1.3 1.3 0 10-2.6 0zM8.2 12.4a1.05 1.05 0 102.1 0 1.05 1.05 0 10-2.1 0zM13.7 12.4a1.05 1.05 0 102.1 0 1.05 1.05 0 10-2.1 0zM10.2 15.4c0-1 .8-1.5 1.8-1.5s1.8.5 1.8 1.5-.9 1.6-1.8 1.6-1.8-.6-1.8-1.6z' },
    { id: 'crane', name: 'Стерх',
      f: ['M5.5 12.4c.4-2.6 3.3-4 6.8-3.8 2.6.1 4.6 1.2 5.6 2.9l3.6 3.3c-1.7.3-3.5.1-5-.4-1.7 1.2-4.1 1.8-6.4 1.6-3-.3-4.9-1.6-4.6-3.6z',
        'M6.4 1.9a1.5 1.5 0 102.9.6 1.5 1.5 0 10-2.9-.6z'],
      s: 'M8.1 2.8c-.6 2.4-.3 4.7 1 6.6M7 2.6 2.6 4.4M11 15.8l-.6 6.4M13.6 15.6l1.2 6.6M9.4 22.2h2M14 22.2h2',
      d: 'M7 2.1a.55.55 0 101.1 0 .55.55 0 10-1.1 0z' },
  ];

  function iconSVG(name, color, sw) {
    const ic = ICONS[name]; if (!ic) return '';
    let h = `<path d="${ic.s}" fill="none" stroke="${color}" stroke-width="${sw || 2}" stroke-linecap="round" stroke-linejoin="round"/>`;
    if (ic.f) h += `<path d="${ic.f}" fill="${color}"/>`;
    return h;
  }

  function figureSVG(id, color, bg) {
    const f = FIGURES.find(x => x.id === id) || FIGURES[0];
    let h = '';
    (Array.isArray(f.f) ? f.f : [f.f]).forEach(d => { if (d) h += `<path d="${d}" fill="${color}" fill-rule="evenodd"/>`; });
    if (f.s) h += `<path d="${f.s}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
    if (f.d && bg) h += `<path d="${f.d}" fill="${bg}"/>`;
    return h;
  }

  // Фишка: цветной диск с белой фигуркой и тонкой бусинной каймой (для экрана и для поля)
  function tokenSVG(id, color, size) {
    const s = size || 64;
    let dots = '';
    for (let k = 0; k < 16; k++) {
      const a = k * Math.PI / 8;
      dots += `<circle cx="${(32 + 25.6 * Math.cos(a)).toFixed(1)}" cy="${(32 + 25.6 * Math.sin(a)).toFixed(1)}" r="1.05"/>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 64 64">` +
      `<circle cx="32" cy="32" r="29" fill="${color}" stroke="${C.ink}" stroke-width="4"/>` +
      `<g fill="#ffffff" fill-opacity=".6">${dots}</g>` +
      `<g transform="translate(14 13) scale(1.5)">${figureSVG(id, '#ffffff', color)}</g></svg>`;
  }

  // Аал Луук Мас — дерево жизни. Рисуется вокруг точки 0,0, высота около 250.
  // Корни уходят в нижний мир, крона — в верхний; ветви закручены как лировидный узор.
  function treeSVG() {
    const o = [];
    const ink = C.ink, coral = C.coral, larch = C.larch, gold = C.gold;
    // солнечный круг за кроной
    o.push(`<circle cx="0" cy="-22" r="104" fill="#e4eaee"/>`);
    o.push(`<circle cx="0" cy="-22" r="104" fill="none" stroke="${C.rim}" stroke-width="3" stroke-dasharray="2 9" stroke-linecap="round"/>`);
    // земля Орто дойду: полоса узора
    o.push(`<path d="M-92 92c30-12 62-16 92-16s62 4 92 16" fill="none" stroke="${C.silver}" stroke-width="3" stroke-linecap="round"/>`);
    // ствол
    o.push(`<path d="M-9 96C-7 60-5 10-3-104h6C5 10 7 60 9 96z" fill="${ink}"/>`);
    // корни: закручиваются вниз
    const root = m => `<path d="M${m * 4} 84c${m * 10} 4 ${m * 22} 10 ${m * 30} 20 ${m * 6} 8 ${m * 2} 16 ${m * -5} 14 ${m * -6}-2 ${m * -5}-9 ${m * 1}-10" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round"/>
      <path d="M${m * 3} 90c${m * 4} 8 ${m * 6} 16 ${m * 2} 24" fill="none" stroke="${ink}" stroke-width="4.5" stroke-linecap="round"/>`;
    o.push(root(1), root(-1));
    // ветви по ярусам: высота, длина, подъём
    const tiers = [[-78, 34, 14], [-50, 52, 18], [-18, 70, 22], [16, 82, 24], [48, 76, 20]];
    tiers.forEach(([y, len, up], k) => {
      [1, -1].forEach(m => {
        const x2 = m * len, y2 = y - up;
        // ветка с завитком-лирой на конце
        o.push(`<path d="M0 ${y + 8}C${m * len * 0.35} ${y} ${m * len * 0.75} ${y - up * 0.2} ${x2} ${y2}c${m * 6}-8 ${m * 2}-17 ${m * -6}-16 ${m * -7} 1 ${m * -8} 9 ${m * -2} 11" fill="none" stroke="${ink}" stroke-width="${5.6 - k * 0.35}" stroke-linecap="round"/>`);
        // хвоя лиственницы: веер из трёх штрихов под веткой
        const nx = m * len * 0.55, ny = y - up * 0.05 + 2;
        o.push(`<path d="M${nx} ${ny}l${m * 3} 11M${nx} ${ny}l${m * -3} 11M${nx} ${ny}v12" stroke="${larch}" stroke-width="3" stroke-linecap="round"/>`);
        // коралловая бусина на завитке
        o.push(`<circle cx="${x2 + m * 1}" cy="${y2 - 6}" r="${4.6 - k * 0.2}" fill="${coral}"/>`);
      });
    });
    // верхушка: солнце-бусина с лучами
    o.push(`<circle cx="0" cy="-114" r="13" fill="${coral}"/>`);
    o.push(`<circle cx="0" cy="-114" r="6" fill="${gold}"/>`);
    let rays = '';
    for (let k = 0; k < 12; k++) {
      const a = k * Math.PI / 6;
      rays += `M${(19 * Math.cos(a)).toFixed(1)} ${(-114 + 19 * Math.sin(a)).toFixed(1)}L${(25 * Math.cos(a)).toFixed(1)} ${(-114 + 25 * Math.sin(a)).toFixed(1)}`;
    }
    o.push(`<path d="${rays}" stroke="${coral}" stroke-width="3" stroke-linecap="round"/>`);
    return o.join('');
  }

  const T = { C, GROUP, PLAYER, ICONS, GROUP_ICON, CELL_ICON, TYPE_ICON, FIGURES, iconSVG, figureSVG, tokenSVG, treeSVG };
  root.BAAI = root.BAAI || {};
  root.BAAI.theme = T;
  if (typeof module !== 'undefined') module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
