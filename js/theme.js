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
    hut:    { s: 'M3 11l9-7 9 7M5 9.5V20h14V9.5M5 13.5h14M5 16.8h14M10 20v-3.2h4V20M16.5 6.4V3h2.2v5.1' },
    blizzard:{ s: 'M3 8h10a3 3 0 10-3-3M3 13h15a3 3 0 11-3 3M3 18h7', f: 'M18 4.2a1 1 0 102 0 1 1 0 10-2 0zM19.5 9a1 1 0 102 0 1 1 0 10-2 0zM13 19.5a1 1 0 102 0 1 1 0 10-2 0z' },
  };
  const GROUP_ICON = { 1: 'fish', 2: 'boat', 3: 'urasa', 4: 'pick', 5: 'frost', 6: 'beacon', 7: 'diamond', 8: 'serge' };
  const CELL_ICON = { 5: 'ship', 15: 'ferry', 25: 'train', 35: 'plane', 12: 'bolt', 28: 'flame' };
  const TYPE_ICON = { tax: 'coin', bayanai: 'bow', tyusyulge: 'bowl', start: 'start', jail: 'hut', parking: 'sun', gotojail: 'blizzard' };

  // Фигурки фишек: белый силуэт 24×24
  const FIGURES = [
    { id: 'horse',  name: 'Конь',    f: 'M8 22v-6l-3-2 1-4 4-5 1-3 2 2h2c3 1 5 4 5 8l-1 2-2-1-1-2-2 1 2 4v6z' },
    { id: 'deer',   name: 'Олень',   f: 'M10 22l-1-8c-1-2 0-4 3-4s4 2 3 4l-1 8z', s: 'M10.5 10L7 5M7 5L4.5 6M7 5V2M13.5 10L17 5M17 5l2.5 1M17 5V2' },
    { id: 'choron', name: 'Чорон',   f: 'M5 3h14l-1.5 8c-.5 3-3 5-5.5 5s-5-2-5.5-5z', s: 'M9 15.5l-2 5.5M15 15.5l2 5.5M12 16v5' },
    { id: 'khomus', name: 'Хомус',   f: 'M12 2.5a5 5 0 00-5 5c0 3 1.8 5 4 5.4V22h2v-9.1c2.2-.4 4-2.4 4-5.4a5 5 0 00-5-5zm0 2.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5z' },
    { id: 'bear',   name: 'Медведь', f: 'M5 13a7 7 0 1014 0 7 7 0 10-14 0zM3 7.5a3 3 0 106 0 3 3 0 10-6 0zM15 7.5a3 3 0 106 0 3 3 0 10-6 0z' },
    { id: 'crane',  name: 'Стерх',   f: 'M5 14c0-3 4-5 8-4l2-6 3-1-1 2-2 6c1 3-1 5-4 5-3 0-6 0-6-2z', s: 'M13 17l1 5M10 17l-1 5' },
  ];

  function iconSVG(name, color, sw) {
    const ic = ICONS[name]; if (!ic) return '';
    let h = `<path d="${ic.s}" fill="none" stroke="${color}" stroke-width="${sw || 2}" stroke-linecap="round" stroke-linejoin="round"/>`;
    if (ic.f) h += `<path d="${ic.f}" fill="${color}"/>`;
    return h;
  }

  function figureSVG(id, color) {
    const f = FIGURES.find(x => x.id === id) || FIGURES[0];
    let h = '';
    if (f.f) h += `<path d="${f.f}" fill="${color}" fill-rule="evenodd"/>`;
    if (f.s) h += `<path d="${f.s}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>`;
    return h;
  }

  // Фишка: цветной диск с белой фигуркой (для экрана и для поля)
  function tokenSVG(id, color, size) {
    const s = size || 64;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 64 64">` +
      `<circle cx="32" cy="32" r="29" fill="${color}" stroke="${C.ink}" stroke-width="4"/>` +
      `<circle cx="32" cy="32" r="23.5" fill="none" stroke="#ffffff" stroke-opacity=".55" stroke-width="1.5"/>` +
      `<g transform="translate(14 14) scale(1.5)">${figureSVG(id, '#ffffff')}</g></svg>`;
  }

  const T = { C, GROUP, PLAYER, ICONS, GROUP_ICON, CELL_ICON, TYPE_ICON, FIGURES, iconSVG, figureSVG, tokenSVG };
  root.BAAI = root.BAAI || {};
  root.BAAI.theme = T;
  if (typeof module !== 'undefined') module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
