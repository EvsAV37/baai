/* «Баай» — экран игры на одном телефоне.
   Рисует состояние из движка, отправляет ему действия. Поле рисует board.js.
   Правил здесь нет.
   © 2026 Евсеев А.В. */
(function () {
  'use strict';

  const { BOARD, GROUPS, RULES, ROLES, BAYANAI } = BAAI.data;
  const T = BAAI.theme;
  const E = BAAI.engine;
  const FX = BAAI.fx || { play() {}, vibe() {}, floatText() {}, coins() {}, beads() {}, toggle() {}, sound: false, vibe: false, canVibe: false };
  const rub = E.rub;
  const BANK = E.BANK;
  const $ = id => document.getElementById(id);
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const icon = (name, color, sw) => `<svg viewBox="0 0 24 24" aria-hidden="true">${T.iconSVG(name, color, sw)}</svg>`;
  const token = (p, size) => T.tokenSVG(p.figure, p.color, size || 64).replace('<svg ', '<svg aria-hidden="true" ');
  const laps = n => `${n} ${n === 1 ? 'круг' : n < 5 ? 'круга' : 'кругов'}`;

  const NET = BAAI.net || { inGame: false, isClient: () => false, isHost: () => false, canHost: false, hasSave: () => false };
  const netGame = () => NET.inGame;
  const BOT = BAAI.bot;
  const isBot = i => !!(G && G.players[i] && G.players[i].bot);
  const humans = () => G.players.filter(p => !p.bot).length;
  // У кого сейчас телефон (одна игра на телефоне): человек, которому его передали последним
  let holder = null;
  function viewer() {
    if (holder !== null && G.players[holder] && !isBot(holder)) return holder;
    const a = E.actor(G);
    if (!isBot(a)) return a;
    const h = G.players.findIndex(p => !p.bot);
    return h < 0 ? a : h;
  }
  // Чей это телефон: в сетевой игре — свой игрок, на одном телефоне — тот, у кого он в руках
  const me = () => netGame() ? NET.me : viewer();
  // Действует ли сейчас владелец этого телефона (за ботов ходит сам телефон)
  const myMove = () => netGame() ? E.actor(G) === NET.me : !isBot(E.actor(G));
  const SAVE_KEY = 'baai.save.v2';
  const SETUP_KEY = 'baai.setup.v2';
  const DECK_ABOUT = {
    bayanai: 'Колода «Байанай» — дух охоты и удачи. Перемещения, находки и неприятности в дороге.',
    tyusyulge: 'Колода «Тюсюлгэ» — место праздника Ысыах. Деньги, выплаты и события в улусе.',
  };

  let G = null;
  let shownCard = 0;
  let board = null;
  let setup = { count: 3, bots: 0, minutes: 0, names: [], figures: ['horse', 'deer', 'choron', 'khomus', 'bear', 'crane'], rules: null };
  let botT = 0;        // таймер хода бота
  let trade = null;   // черновик обмена
  let loan = null;    // черновик кредита
  let lastSnap = null; // что было на экране в прошлый раз — по разнице играем звуки и анимации
  let heldMoney = null; // пока фишка идёт, на плашках старые суммы
  let lastTick = -1;
  let shownRent = 0;   // какую плашку аренды уже показали
  let rentT = 0;

  // ---------- сохранение ----------
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* без сохранения */ } },
  };
  // Пять ячеек сохранения (только на одном телефоне). В каждой — партия и её описание для списка.
  // Текущая партия сама сохраняется в свою ячейку после каждого действия.
  const SLOTS_KEY = 'baai.slots.v1', SLOT_N = 5;
  const slotKey = k => 'baai.slot.' + k;
  let curSlot = -1;
  function slots() {
    const m = store.get(SLOTS_KEY);
    return Array.isArray(m) && m.length === SLOT_N ? m : Array(SLOT_N).fill(null);
  }
  function slotMeta(g, old) {
    let name = old && old.name;
    if (!name) { const n = (Number(store.get('baai.slotn')) || 0) + 1; store.set('baai.slotn', n); name = `Партия ${n}`; }
    return {
      name, date: Date.now(), round: g.round || 0,
      players: g.players.map(p => ({ name: p.name, figure: p.figure, color: p.color, bot: !!p.bot })),
      over: g.phase === 'over', winner: g.phase === 'over' && g.winner !== null ? g.players[g.winner].name : '',
    };
  }
  function save() {
    if (netGame() || !G || curSlot < 0) return;
    store.set(slotKey(curSlot), G);
    const m = slots(); m[curSlot] = slotMeta(G, m[curSlot]); store.set(SLOTS_KEY, m);
  }
  // Сохранение прошлой версии (одна партия) переезжает в первую свободную ячейку
  function migrateSave() {
    const old = store.get(SAVE_KEY);
    if (!old || !old.players) return;
    const m = slots(), k = m.findIndex(x => !x);
    if (k < 0) return;
    store.set(slotKey(k), old);
    m[k] = slotMeta(old, null); store.set(SLOTS_KEY, m);
    store.set(SAVE_KEY, null);
  }
  const slotDate = d => new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  function slotsHTML() {
    const m = slots();
    if (!m.some(Boolean)) return '';
    return `<h2 class="h2">Сохранённые партии</h2><div class="slots">${m.map((x, k) => !x ? '' : `
      <div class="slot${x.over ? ' over' : ''}">
        <div class="slot-figs" aria-hidden="true">${x.players.map(p => T.tokenSVG(p.figure, p.color, 26)).join('')}</div>
        <div class="slot-tx"><b>${esc(x.name)}</b>
          <span>${esc(slotDate(x.date))} · ${x.over ? `окончена${x.winner ? ', победил ' + esc(x.winner) : ''}` : `круг ${x.round + 1}`}</span>
          <span>${x.players.map(p => esc(p.name) + (p.bot ? ' (бот)' : '')).join(', ')}</span></div>
        <div class="slot-btns">${btn(x.over ? 'Открыть' : 'Продолжить', 'slotLoad', 'primary sm', false, `data-k="${k}"`)}
          ${btn('✎', 'slotRename', 'sm', false, `data-k="${k}" aria-label="Переименовать ${esc(x.name)}"`)}
          ${btn('✕', 'slotDel', 'sm', false, `data-k="${k}" aria-label="Удалить ${esc(x.name)}"`)}</div>
      </div>`).join('')}</div>`;
  }
  function loadSlot(k) {
    const g = store.get(slotKey(k));
    if (!g || !g.players) { const m = slots(); m[k] = null; store.set(SLOTS_KEY, m); renderSetup(); toast('Сохранение повреждено'); return; }
    G = E.migrate(g); curSlot = k; holder = null; undo = []; tradeSnap = null;
    buildMode = false; buildHinted.clear(); hintsSeen.clear();
    shownCard = G.card ? G.card.seq : 0; shownRent = G.rentNote ? G.rentNote.seq : 0;
    showGame(true);
    if (G.phase === 'over') setTimeout(showVictory, 300);   // окончена — сразу итоги
    else maybeHandoff();
  }

  // ---------- отмена «↶» (только на одном телефоне) ----------
  // Перед покупкой, стройкой, залогом и обменом запоминаем копию партии.
  // Бросок, карточка, аукцион и передача хода стирают историю.
  let undo = [];          // [{ g: копия партии до действия, label, turn }]
  let tradeSnap = null;   // копия до предложения обмена — пригодится, если обмен примут
  const canUndo = () => !netGame() && G && undo.length && undo[undo.length - 1].turn === G.turn && !isBot(G.turn)
    && ['roll', 'end', 'buy', 'debt'].includes(G.phase) && !G.players[G.turn].bankrupt;
  function doUndo() {
    if (!canUndo()) return;
    const u = undo.pop(), seq = G.seq;
    G = E.migrate(JSON.parse(u.g));
    G.seq = seq + 1;
    G.log.push(`↶ Отменено — ${u.label}`);
    lastSnap = snap(G);      // без звуков и летящих монет
    buildMode = false; trade = null;
    holder = G.turn;
    save();
    closeSheet();
    render({});
    toast(`Отменено — ${u.label}`);
  }

  // ---------- правила партии ----------
  const RULE_UI = [
    { k: 'auction', icon: 'gavel', title: 'Аукцион', opts: [['open', 'Открытый'], ['sealed', 'Тайный']],
      hint: { open: 'Ставки по кругу, все видят цену. Кто поставил больше всех, тот и покупает.',
              sealed: 'Каждый один раз пишет ставку втайне. Потом ставки открываются, покупает самый щедрый.' } },
    { k: 'money', icon: 'eye', title: 'Деньги соперников', opts: [['open', 'Видны'], ['hidden', 'Скрыты']],
      hint: { open: 'Деньги каждого видны всем.', hidden: 'Каждый видит только свои деньги. Сколько у соперников — угадывайте.' } },
    { k: 'growth', icon: 'grow', title: 'Цены', opts: [['flat', 'Постоянные'], ['grow', 'Растут']],
      hint: { flat: 'Цены весь матч одни и те же.',
              grow: `Каждые ${E.GROW_EVERY} кругов покупка, аренда, дома и налоги дорожают на 10%, до +50%. Партия не затягивается.` } },
    { k: 'roles', icon: 'mask', title: 'Тайные роли', opts: [['off', 'Нет'], ['pick', 'Выбор'], ['random', 'Случайно']],
      hint: { off: 'Все играют по одним правилам.',
              pick: 'Перед партией каждый втайне выбирает роль: у неё есть плюс, способность раз за игру и минус. Роль раскрывается, когда сработает.',
              random: 'Роли раздаются случайно и втайне: плюс, способность раз за игру и минус. Роль раскрывается, когда сработает.' } },
    { k: 'prize', icon: 'ysyakh', title: 'Приз Ысыаха', opts: [['on', 'Есть'], ['off', 'Нет']],
      hint: { on: 'Налоги и проценты банку копятся в призе. Кто встал на «Ысыах», забирает всё.',
              off: 'Налоги уходят банку, «Ысыах» — просто отдых.' } },
  ];

  // Панель правил; attr — имя data-атрибута для кнопок (на экране настройки и в комнате хоста разные)
  function rulesHTML(rules, attr, readOnly) {
    rules = E.normRules(rules);
    return RULE_UI.map(r => `<div class="rule">
      <h3 class="rule-h">${icon(r.icon, T.C.coral, 2.2)}${r.title}</h3>
      ${readOnly ? `<p class="rule-v">${r.opts.find(o => o[0] === rules[r.k])[1]}</p>` : `<div class="seg" role="radiogroup" aria-label="${r.title}">${r.opts.map(([v, t]) =>
        `<button type="button" role="radio" aria-checked="${v === rules[r.k]}" ${attr}="${r.k}" data-v="${v}">${t}</button>`).join('')}</div>`}
      <p class="hint">${r.hint[rules[r.k]]}</p></div>`).join('');
  }

  // Видно ли сейчас деньги игрока i
  function seesMoney(i) {
    if (!G || G.rules.money !== 'hidden' || G.phase === 'over') return true;
    return i === me();
  }
  const moneyOf = (i, v) => seesMoney(i) ? rub(v === undefined ? G.players[i].money : v) : '••• ₽';

  // ---------- тайные роли ----------
  const ROLE_BTN = { uus: 'Дом без группы', bulchut: 'Засада', atyyhyt: 'Забрать по стартовой цене', kayur: 'Упряжка на транспорт', toyon: 'Созвать сход', olonkhosut: 'Забрать приз сказанием' };
  const roleOf = i => (G.players[i] && E.ROLE[G.players[i].role]) || null;
  // Чья роль видна этому телефону: своя всегда, чужая — когда раскрыта
  const seesRole = i => G.players[i].roleShown || G.phase === 'over' || i === me();

  function roleCardHTML(r, used, act) {
    return `<div class="role-card">
      <div class="role-top">${icon(r.icon, T.C.coral, 2)}<div><b>${esc(r.name)}</b><span>${esc(r.who)}</span></div></div>
      <p class="rp plus">${esc(r.plus)}</p>
      <p class="rp once${used ? ' used' : ''}">${esc(r.once)}${used ? ' <em>(потрачено)</em>' : ''}</p>
      <p class="rp minus">${esc(r.minus)}</p>${act || ''}</div>`;
  }

  function showRole(p) {
    const r = roleOf(p); if (!r) return;
    openKind('role', `<p class="sub center">Тайная роль · ${esc(G.players[p].name)}</p>${roleCardHTML(r, G.players[p].roleUsed)}
      <p class="sub">${G.players[p].roleShown ? 'Роль уже раскрыта — её знают все.' : 'Роль видите только вы. Она раскроется, когда сработает.'}</p>
      ${btn('Закрыть', 'close', 'ghost')}`);
  }

  // Выбор клетки для способности (Уус — участок, Каюр — транспорт)
  function showAbilityCells(p) {
    const r = roleOf(p), pl = G.players[p];
    const cells = pl.role === 'kayur' ? [5, 15, 25, 35].filter(i => i !== pl.pos)
      : Object.keys(G.own).map(Number).filter(i => { const o = G.own[i], c = BOARD[i]; return o.owner === p && c.type === 'prop' && !o.mortgaged && !o.houses && !E.ownsGroup(G, p, c.group); });
    openKind('ability', `<p class="sub center">${esc(r.name)} · раз за игру</p><h3>${esc(ROLE_BTN[pl.role])}</h3><p>${esc(r.once)}</p>
      <div class="chips">${cells.map(i => `<button type="button" class="chip" data-act="abilityCell" data-cell="${i}" style="--gc:${cellColor(BOARD[i])}"><i></i>${esc(BOARD[i].name)}</button>`).join('')}</div>
      ${btn('Отмена', 'close', 'ghost')}`);
  }

  function abilityBtn() {
    const p = E.actor(G);
    if (!myMove() || !E.canAbility(G, p)) return '';
    return `<div class="act-row">${btn(`${icon('mask', 'currentColor', 2)}${esc(ROLE_BTN[G.players[p].role])}`, 'ability', 'sm ic role-btn')}</div>`;
  }

  function rolesPickHTML() {
    return `<div class="notice">Выберите тайную роль. Её видите только вы, она раскроется, когда сработает.</div>
      <div class="roles-pick">${ROLES.map(r => roleCardHTML(r, false, btn(`Я — ${esc(r.name)}`, 'pickRole', 'primary', false, `data-role="${r.id}"`))).join('')}</div>`;
  }

  // ---------- настройка партии ----------
  function renderSetup() {
    $('rules-box').innerHTML = rulesHTML(setup.rules, 'data-rule');
    $('setup-medals').innerHTML = T.FIGURES.map((f, i) => T.tokenSVG(f.id, T.PLAYER[i], 34)).join('');
    $('count-seg').innerHTML = [1, 2, 3, 4, 5, 6].map(n =>
      `<button type="button" role="radio" aria-checked="${n === setup.count}" data-n="${n}">${n}</button>`).join('');
    $('bots-seg').innerHTML = [0, 1, 2, 3, 4, 5].map(n =>
      `<button type="button" role="radio" aria-checked="${n === setup.bots}" data-b="${n}" ${n + setup.count > 6 || n + setup.count < 2 ? 'disabled' : ''}>${n}</button>`).join('');
    $('bot-names').innerHTML = botNames().map((nm, k) => {
      const i = setup.count + k, fig = T.FIGURES.find(f => f.id === setup.figures[i]);
      return `<div class="bot-row"><button type="button" class="fig" data-fig="${i}" aria-label="Фишка бота ${esc(nm)}: ${fig.name}. Сменить">${T.tokenSVG(setup.figures[i], T.PLAYER[i], 46)}</button>
        <span class="nm">${esc(nm)}</span><em>бот</em></div>`;
    }).join('');
    $('time-seg').innerHTML = [[0, 'Нет'], [30, '30 мин'], [60, '60 мин'], [90, '90 мин']].map(([m, t]) =>
      `<button type="button" role="radio" aria-checked="${m === setup.minutes}" data-m="${m}">${t}</button>`).join('');
    $('hints-seg').innerHTML = [[true, 'Показывать'], [false, 'Не нужно']].map(([v, t]) =>
      `<button type="button" role="radio" aria-checked="${v === hintsOn}" data-h="${v}">${t}</button>`).join('');
    let html = '';
    for (let i = 0; i < setup.count; i++) {
      const v = setup.names[i] || `Игрок ${i + 1}`;
      const fig = T.FIGURES.find(f => f.id === setup.figures[i]);
      html += `<div class="name-row">
        <button type="button" class="fig" data-fig="${i}" aria-label="Фишка игрока ${i + 1}: ${fig.name}. Сменить">${T.tokenSVG(setup.figures[i], T.PLAYER[i], 46)}</button>
        <input id="name-${i}" type="text" maxlength="14" value="${esc(v)}" aria-label="Имя игрока ${i + 1}">
      </div>`;
    }
    $('names').innerHTML = html;
    const sl = slotsHTML();
    $('resume-box').innerHTML = sl;
    $('resume-box').hidden = !sl;
    $('net-box').hidden = !NET.canHost;
    $('btn-net-resume').hidden = !NET.hasSave();
  }

  // Имена ботов: якутские, не совпадают с именами людей
  function botNames() {
    const taken = setup.names.slice(0, setup.count).map(n => (n || '').toLowerCase());
    return BOT.NAMES.filter(n => !taken.includes(n.toLowerCase())).slice(0, setup.bots);
  }

  // Людей 1–6, ботов 0–5, всего от 2 до 6
  function fixCounts(changed) {
    if (changed === 'count' && setup.count + setup.bots > 6) setup.bots = 6 - setup.count;
    if (changed === 'bots' && setup.count + setup.bots > 6) setup.count = 6 - setup.bots;
    if (setup.count + setup.bots < 2) setup.bots = 2 - setup.count;
  }

  function readNames() {
    for (let i = 0; i < setup.count; i++) {
      const el = $('name-' + i);
      if (el) setup.names[i] = el.value.trim() || `Игрок ${i + 1}`;
    }
  }

  // Следующая фигурка, которую не взял никто из играющих
  function nextFigure(i) {
    const ids = T.FIGURES.map(f => f.id);
    const taken = setup.figures.slice(0, setup.count + setup.bots).filter((_, k) => k !== i);
    let k = ids.indexOf(setup.figures[i]);
    for (let n = 0; n < ids.length; n++) {
      k = (k + 1) % ids.length;
      if (!taken.includes(ids[k])) break;
    }
    // если фигурка занята кем-то из «лишних» мест — меняемся
    const other = setup.figures.indexOf(ids[k]);
    if (other >= 0) setup.figures[other] = setup.figures[i];
    setup.figures[i] = ids[k];
  }

  // Новая партия занимает свободную ячейку; если все заняты — спрашиваем, какую заменить
  function startGame(slot) {
    readNames();
    if (slot === undefined) {
      const m = slots(), free = m.findIndex(x => !x);
      if (free < 0) {
        openKind('ask', `<h3>Все ${SLOT_N} ячеек заняты</h3><p>Какую партию заменить новой?</p>
          <div class="slot-pick">${m.map((x, k) => btn(`<b>${esc(x.name)}</b><span>${x.over ? 'окончена' : 'круг ' + (x.round + 1)} · ${esc(slotDate(x.date))}</span>`, 'slotNew', 'slot-choice', false, `data-k="${k}"`)).join('')}</div>
          ${btn('Отмена', 'close', 'ghost')}`);
        return;
      }
      slot = free;
    }
    closeSheet();
    store.set(slotKey(slot), null);
    const m = slots(); m[slot] = null; store.set(SLOTS_KEY, m);
    curSlot = slot; undo = []; tradeSnap = null;
    store.set(SETUP_KEY, setup);
    const players = [];
    for (let i = 0; i < setup.count; i++) players.push({ name: setup.names[i] || `Игрок ${i + 1}`, color: T.PLAYER[i], figure: setup.figures[i] });
    botNames().forEach((name, k) => { const i = setup.count + k; players.push({ name, color: T.PLAYER[i], figure: setup.figures[i], bot: true }); });
    G = E.create(players, { minutes: setup.minutes, rules: setup.rules });
    hintsSeen.clear(); shownRent = 0;
    G.log.push(`— Ход: ${G.players[0].name}`);
    shownCard = 0;
    holder = G.phase === 'roles' && humans() > 1 ? null : 0;
    save();
    showGame(true);
    maybeHandoff();
  }

  function showGame(fresh) {
    $('setup').hidden = true;
    $('lobby').hidden = true;
    $('game').hidden = false;
    closeSheet();
    if (!board) BAAI.board = board = new BAAI.BoardView($('board'), { onCellTap: onBoardTap, onStep: k => FX.play('step', k) });
    else if (fresh) board.reset();
    lastSnap = null; heldMoney = null;
    render({ turnChanged: true });
    botTick();
  }

  function showSetup() {
    $('game').hidden = true;
    $('lobby').hidden = true;
    $('setup').hidden = false;
    closeSheet();
    renderSetup();
  }

  // ---------- экран игры ----------
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  function dieHTML(n) {
    let h = '';
    for (let k = 0; k < 9; k++) h += `<i${PIPS[n].includes(k) ? '' : ' class="o"'}></i>`;
    return `<span class="die${n === 1 ? ' one' : ''}" aria-label="${n}">${h}</span>`;
  }

  function statusHTML() {
    const who = E.actor(G);
    const pl = G.players[who];
    let msg = '';
    if (G.phase === 'over') msg = 'Партия окончена';
    else if (G.phase === 'auction') msg = `Аукцион: ${BOARD[G.auction.cell].name}`;
    else if (G.phase === 'offer') msg = G.offer.kind === 'trade' ? 'Ответ на обмен' : 'Ответ на просьбу о кредите';
    else if (G.phase === 'buy') msg = `${BOARD[G.pending.cell].name}: можно купить`;
    else if (G.phase === 'debt') msg = `Нужно заплатить ${rub(G.pending.amount)}`;
    else if (G.phase === 'roles') msg = 'Выбирает тайную роль';
    else if (G.phase === 'omen') msg = 'Шаманский бросок: идти или перебросить';
    else if (G.phase === 'pick2') msg = 'Выбирает карточку «Байанай»';
    else if (G.phase === 'roll' && pl.inJail) msg = 'Пережидает пургу в зимовье';
    else if (G.phase === 'roll' && G.extra) msg = 'Дубль! Бросай ещё раз';
    else if (G.phase === 'roll') msg = 'Бросай кубики';
    else msg = BOARD[pl.pos].name;
    const dice = G.dice && G.phase !== 'auction' && G.phase !== 'offer' ? `<div class="dice" id="dice">${dieHTML(G.dice[0])}${dieHTML(G.dice[1])}</div>` : '';
    const you = netGame() && who === NET.me ? ' <em class="you">ваш ход</em>' : pl.bot ? ' <em class="you bot">бот</em>' : '';
    return `${token(pl, 40)}<div class="col"><div class="who">${esc(pl.name)}${you}</div><div class="msg">${esc(msg)}</div></div>${dice}`;
  }

  // Кубики катятся: несколько случайных граней, потом выпавшие
  function rollDice(d) {
    const el = $('dice'); if (!el) return;
    FX.play('dice'); FX.vibe(25);
    el.classList.add('roll');
    let t = 0;
    const tick = () => {
      t++;
      if (t < 8) { el.innerHTML = dieHTML(1 + Math.floor(Math.random() * 6)) + dieHTML(1 + Math.floor(Math.random() * 6)); setTimeout(tick, 70); }
      else { el.innerHTML = dieHTML(d[0]) + dieHTML(d[1]); el.classList.remove('roll'); }
    };
    tick();
  }

  function btn(label, action, cls = '', disabled = false, extra = '') {
    return `<button type="button" class="btn ${cls}" data-act="${action}" ${extra} ${disabled ? 'disabled' : ''}>${label}</button>`;
  }

  // ----- стройка -----
  // Может ли игрок p сейчас строить на клетке i; если нет — понятная причина
  const calmPhase = () => G.phase === 'roll' || G.phase === 'end';
  function buildWhy(p, i) {
    const c = BOARD[i], o = G.own[i];
    if (!c || c.type !== 'prop' || !o || o.owner !== p) return null;
    const cells = E.groupCells(c.group), g = GROUPS[c.group];
    const lack = cells.filter(j => !G.own[j] || G.own[j].owner !== p);
    if (lack.length) return { why: `Дома можно ставить, когда у вас вся группа «${g.name}». Не хватает: ${lack.map(j => BOARD[j].name).join(', ')}.` };
    const frozen = cells.filter(j => G.own[j].mortgaged);
    if (frozen.length) return { why: `В группе заложена клетка: ${frozen.map(j => BOARD[j].name).join(', ')}. Сначала выкупите её.` };
    if (o.houses >= 5) return { why: 'Здесь уже стоит отель — больше строить некуда.' };
    const min = Math.min(...cells.map(j => G.own[j].houses));
    if (o.houses > min) {
      const next = cells.filter(j => G.own[j].houses === min).map(j => BOARD[j].name);
      return { why: `Дома ставятся поровну по всей группе. Сначала постройте на: ${next.join(', ')}.` };
    }
    const cost = E.houseCost(G, c.group, p);
    if (G.players[p].money < cost) return { why: `Не хватает денег: ${o.houses === 4 ? 'отель' : 'дом'} стоит ${rub(cost)}, у вас ${rub(G.players[p].money)}.` };
    if (!myMove() || E.actor(G) !== p || !calmPhase()) return { why: 'Строить можно в свой ход — до броска кубиков или после.' };
    return { ok: true };
  }
  // Клетки, где игрок может поставить дом прямо сейчас
  function buildable(p) {
    if (!G || G.phase === 'over' || !myMove() || E.actor(G) !== p || !calmPhase() || G.players[p].bankrupt) return [];
    return Object.keys(G.own).map(Number).filter(i => E.canBuild(G, p, i));
  }
  const houseWord = (i, p) => {
    const c = BOARD[i], hotel = G.own[i] && G.own[i].houses === 4;
    return `Построить ${hotel ? 'отель' : 'дом'} · ${rub(E.houseCost(G, c.group, p))}`;
  };
  const sellWord = i => `Продать ${G.own[i].houses === 5 ? 'отель' : 'дом'} · ${rub(E.sellValue(i, G))}`;
  let glowBuild = false;          // подсветить кнопку «Строить» (после «Группа собрана!»)
  let buildMode = false;          // режим «Строить»: на поле подсвечены клетки, нажатие ставит дом
  const buildHinted = new Set();  // кому уже показали «Группа собрана»
  function syncMarks() {
    if (!board) return;
    const p = G && me();
    const cells = G && buildMode ? buildable(p) : [];
    if (buildMode && !cells.length) buildMode = false;
    board.mark(cells);
  }
  function onBoardTap(i) {
    if (buildMode && buildable(me()).includes(i)) { send('build', { cell: i }); return; }
    showCell(i);
  }

  // Кнопки «Обмен» и «Кредит» — доступны в спокойные моменты своего хода
  function sideRow(pl) {
    const canTrade = G.phase === 'roll' || G.phase === 'end';
    const canLoan = ['roll', 'end', 'debt', 'buy'].includes(G.phase);
    const parts = [];
    if (canUndo()) parts.push(btn('<span class="u" aria-hidden="true">↶</span>Отменить', 'undo', 'sm ic undo', false, `aria-label="Отменить: ${esc(undo[undo.length - 1].label)}"`));
    if (buildable(G.turn).length) parts.push(btn(`${icon('house', 'currentColor', 2.2)}Строить`, 'buildMode', `sm ic gold${glowBuild ? ' glow' : ''}`));
    if (canTrade) parts.push(btn(`${icon('swap', 'currentColor', 2.2)}Обмен`, 'tradeOpen', 'sm ic'));
    if (canLoan) parts.push(btn(`${icon('card', 'currentColor', 2.2)}${pl.loan ? 'Кредит · ' + rub(pl.loan.owe) : 'Кредит'}`, 'loanOpen', 'sm ic'));
    return parts.length ? `<div class="act-row side">${parts.join('')}</div>` : '';
  }

  function leftHTML() {
    return netGame() && NET.deadline ? '<p class="sub left" id="t-left"></p>' : '';
  }

  // Тайный аукцион: каждый пишет одну ставку, её не видит никто
  function sealedHTML(watch) {
    const A = G.auction, c = BOARD[A.cell], pl = G.players[A.at];
    const done = A.bidders.filter(i => A.bids[i] !== undefined).map(i => esc(G.players[i].name));
    let h = `<div class="auction"><div class="a-head" style="--gc:${cellColor(c)}">${icon('gavel', '#ffffff', 2.2)}<div><b>Тайный аукцион</b><span>${esc(c.name)}</span></div></div>
      <p>Ставки от <b>${rub(A.start)}</b>, цена клетки ${rub(E.price(G, A.cell))}. Каждый пишет одну ставку втайне — покупает тот, кто дал больше.</p>
      <p class="sub">${done.length ? `Уже поставили: ${done.join(', ')}. ` : ''}Сейчас ставит ${esc(pl.name)}.</p>${leftHTML()}</div>`;
    if (watch) return h + `<div class="act-row">${btn('О клетке', 'info', 'ghost', false, `data-cell="${A.cell}"`)}</div>`;
    const top = Math.floor(pl.money / RULES.bidStep) * RULES.bidStep;
    h += `<label class="money bid-in"><span>Ваша ставка</span><input id="sealed-bid" type="number" inputmode="numeric" min="${A.start}" step="${RULES.bidStep}" max="${pl.money}" value="${A.start}"><em>у вас ${rub(pl.money)}</em></label>
      <div class="act-row bids">${[A.start, Math.min(top, E.price(G, A.cell)), top].filter((v, k, a) => v >= A.start && a.indexOf(v) === k)
        .map(v => `<button type="button" class="btn sm" data-act="sealedSet" data-v="${v}">${rub(v)}</button>`).join('')}</div>
      <div class="act-row">${btn('Поставить втайне', 'sealedBid', 'primary big')}</div>
      <div class="act-row">${btn('Пас', 'pass', 'dark')}${btn('О клетке', 'info', 'ghost', false, `data-cell="${A.cell}"`)}</div>`;
    return h;
  }

  function auctionHTML(watch) {
    if (G.auction.sealed) return sealedHTML(watch);
    const A = G.auction, c = BOARD[A.cell], pl = G.players[A.at];
    const min = E.minBid(G);
    const steps = A.leader === null ? [0, 50, 100] : [0, 40, 90];
    const lead = A.leader === null
      ? `Торги открываются с <b>${rub(A.start)}</b> (половина цены ${rub(E.price(G, A.cell))}).`
      : `Ставка сейчас: <b>${rub(A.price)}</b> — ${esc(G.players[A.leader].name)}.`;
    const bidders = A.bidders.map(i => esc(G.players[i].name)).join(', ');
    let h = `<div class="auction"><div class="a-head" style="--gc:${cellColor(c)}">${icon('gavel', '#ffffff', 2.2)}<div><b>Аукцион</b><span>${esc(c.name)}</span></div></div>
      <p>${lead}</p><p class="sub">Торгуются: ${bidders}. Ставит ${esc(pl.name)}${watch ? '' : `, денег: ${rub(pl.money)}`}.</p>${leftHTML()}</div>`;
    if (watch) return h + `<div class="act-row">${btn('О клетке', 'info', 'ghost', false, `data-cell="${A.cell}"`)}</div>`;
    h += `<div class="act-row bids">${steps.map(d => {
      const v = min + d;
      return btn(A.leader === null ? rub(v) : `+${v - A.price} → ${rub(v)}`, 'bid', d ? '' : 'primary', v > pl.money, `data-amount="${v}"`);
    }).join('')}</div>`;
    h += `<div class="act-row">${btn('Пас', 'pass', 'dark')}${btn('О клетке', 'info', 'ghost', false, `data-cell="${A.cell}"`)}</div>`;
    return h;
  }

  function offerHTML() {
    const o = G.offer, from = G.players[o.from], to = G.players[o.to];
    let body;
    if (o.kind === 'trade') {
      body = `<p><b>${esc(from.name)}</b> предлагает обмен.</p>
        <div class="swap"><div><span class="sub">Вы получаете</span><b>${esc(E.describeSide(G, o.give))}</b></div>
        <div><span class="sub">Вы отдаёте</span><b>${esc(E.describeSide(G, o.get))}</b></div></div>`;
      const mort = o.give.cells.filter(i => G.own[i].mortgaged);
      if (mort.length) body += `<p class="sub">Заложенные клетки: ${mort.map(i => esc(BOARD[i].name)).join(', ')}. За них вы заплатите банку 10% залога: ${rub(mort.reduce((n, i) => n + E.mortgageFee(i), 0))}.</p>`;
    } else {
      const owe = Math.round(o.amount * (1 + o.rate / 100));
      body = `<p><b>${esc(from.name)}</b> просит в долг <b>${rub(o.amount)}</b> под ${o.rate}%.</p>
        <p>Вернёт вам <b>${rub(owe)}</b> через ${laps(o.laps)}. Если не сможет — получите его имущество.</p>
        <p class="sub">У вас ${rub(to.money)}.</p>`;
    }
    return `<div class="notice">${body}${leftHTML()}</div><div class="act-row">${btn('Принять', 'accept', 'primary big')}${btn('Отказаться', 'reject', 'big')}</div>`;
  }

  // Сетевая игра: сейчас действует другой игрок
  function waitHTML() {
    const who = E.actor(G), pl = G.players[who];
    if (G.phase === 'auction') return auctionHTML(true);
    if (G.phase === 'roles') return `<div class="notice wait"><b>${esc(pl.name)}</b> выбирает тайную роль.</div>`;
    if (G.phase === 'offer') {
      const o = G.offer;
      return `<div class="notice">${esc(pl.name)} ${o.kind === 'trade' ? `решает, меняться ли с игроком ${esc(G.players[o.from].name)}` : `решает, дать ли в долг игроку ${esc(G.players[o.from].name)}`}.${leftHTML()}</div>`;
    }
    const off = NET.online && !NET.online[who] ? ' Игрок сейчас без связи — ждём, пока переподключится.' : '';
    const out = netGame() && G.players[NET.me] && G.players[NET.me].bankrupt ? '<p class="sub">Вы выбыли из игры, но можете смотреть до конца.</p>' : '';
    return `<div class="notice wait">Ходит <b>${esc(pl.name)}</b>${pl.bot ? ' (бот)' : ''}.${off}</div>${out}`;
  }

  function renderActions() {
    const pl = G.players[G.turn];
    let h = '';
    glowBuild = false;
    if (G.phase !== 'over' && !myMove()) {
      hintNow = null;
      $('actions').innerHTML = waitHTML();
      tickLeft();
      return;
    }
    if (G.phase === 'over') {
      const w = G.players[G.winner];
      h += `<div class="notice">Победитель: <b>${esc(w.name)}</b>${G.overReason === 'time' ? ` — самый богатый (${rub(E.netWorth(G, G.winner))})` : ''}</div>`;
      if (NET.isClient()) h += '<p class="sub center">Новую партию начнёт хост.</p>';
      else h += `<div class="act-row">${btn('Новая партия', 'newGame', 'primary big')}</div>`;
    } else if (G.phase === 'roles') {
      h += rolesPickHTML();
    } else if (G.phase === 'omen') {
      const d = G.dice;
      h += `<div class="notice">${icon('drum', T.C.coral, 2)} Шаманский бросок: выпало <b>${d[0]} + ${d[1]}</b> — клетка <b>${esc(BOARD[(pl.pos + d[0] + d[1]) % 40].name)}</b>. Идти или перебросить? Переброс — один раз за игру, после него роль раскроется.</div>
        <div class="act-row">${btn(`Идти на ${d[0] + d[1]}`, 'go', 'primary big')}${btn('Перебросить', 'reroll', 'big')}</div>`;
    } else if (G.phase === 'pick2' && G.choice) {
      h += `<div class="notice">Охотник тянет две карточки «Байанай». Выберите одну, другая уйдёт под низ колоды.</div>
        <div class="pick2">${G.choice.ids.map((id, k) => `<button type="button" class="card-face bayanai pick" data-act="pickCard" data-k="${k}">${icon('bow', T.C.larch, 2.2)}<p>${esc(BAYANAI[id].text)}</p></button>`).join('')}</div>`;
    } else if (G.phase === 'auction') {
      h += auctionHTML() + abilityBtn();
    } else if (G.phase === 'offer') {
      h += offerHTML();
    } else if (pl.bankrupt) {
      h += `<div class="act-row">${btn('Завершить ход', 'endTurn', 'dark big')}</div>`;
    } else if (buildMode && calmPhase() && buildable(G.turn).length) {
      h += `<div class="notice build">Нажмите на клетку в золотой рамке — там встанет дом. Дома ставятся поровну по группе, после четырёх домов — отель.</div>
        <div class="act-row">${btn('Готово', 'buildDone', 'primary big')}</div>`;
      $('actions').innerHTML = h;
      tickLeft();
      return;
    } else if (G.phase === 'roll' && pl.inJail) {
      h += `<div class="notice">Вы в зимовье, снаружи пурга. Попытка ${pl.jailTries + 1} из ${RULES.maxJailTries}: выбросьте дубль — пурга стихнет. Или вызовите вездеход за ${RULES.jailFine} ₽.</div>`;
      h += `<div class="act-row">${btn('Бросить на дубль', 'roll', 'primary')}${btn(`Вездеход · ${RULES.jailFine} ₽`, 'payJail', '', pl.money < RULES.jailFine)}${pl.freeCards.length ? btn('Попутный вездеход', 'useCard') : ''}</div>`;
    } else if (G.phase === 'roll') {
      h += `<div class="act-row">${btn(G.extra ? 'Бросить ещё раз' : 'Бросить кубики', 'roll', 'primary big')}</div>`;
    } else if (G.phase === 'buy') {
      const c = BOARD[G.pending.cell], cost = E.price(G, G.pending.cell);
      const hunter = c.type === 'transport' && pl.role === 'bulchut';
      const short = pl.money < cost || hunter;
      if (hunter) h += `<div class="notice">Охотник не покупает транспорт — клетка уйдёт на аукцион.</div>`;
      if (short && !hunter) h += `<div class="notice bad">На ${esc(c.name)} не хватает денег. Можно заложить клетку или взять кредит. Если не купите, клетка уйдёт на аукцион.</div>`;
      h += `<div class="act-row">${btn(`Купить ${rub(cost)}`, 'buy', 'primary big', short)}${btn('На аукцион', 'decline', 'big')}</div>`;
      h += `<div class="act-row">${btn('Подробнее о клетке', 'info', 'ghost', false, `data-cell="${G.pending.cell}"`)}</div>`;
    } else if (G.phase === 'debt') {
      const d = G.pending;
      const can = pl.money >= d.amount;
      const liquid = E.liquidValue(G, G.turn);
      h += `<div class="notice bad">Нужно заплатить <b>${rub(d.amount)}</b> (${esc(d.reason)}). У вас ${rub(pl.money)}.
        ${!can && liquid >= d.amount ? ' Продайте дома или заложите клетки в разделе «Имущество».' : ''}
        ${liquid < d.amount ? ' Даже с продажей домов и залогом не хватает.' : ''}</div>`;
      h += `<div class="act-row">${btn('Заплатить', 'payDebt', 'primary', !can)}${btn('Объявить банкротство', 'bankrupt', 'danger', can)}</div>`;
    } else if (G.phase === 'end') {
      h += `<div class="act-row">${btn('Завершить ход', 'endTurn', 'dark big')}</div>`;
    }
    if (calmPhase() && !pl.bankrupt && !buildHinted.has(G.turn) && buildable(G.turn).length) {
      const g = GROUPS[BOARD[buildable(G.turn)[0]].group];
      glowBuild = true;
      h = `<div class="notice build"><b>Группа «${esc(g.name)}» собрана!</b> Теперь на её клетках можно строить дома — аренда вырастет в разы. Нажмите кнопку <b>«Строить»</b> внизу ↓
        <div class="act-row">${btn('Понятно', 'buildLater', 'ghost sm')}</div></div>` + h;
    }
    if (!glowBuild) h = hintHTML() + h;   // «Группа собрана!» сама и есть подсказка
    if (['roll', 'end'].includes(G.phase) && !pl.bankrupt) h += abilityBtn();
    if (G.phase !== 'over' && !pl.bankrupt && !['auction', 'offer', 'roles', 'omen', 'pick2'].includes(G.phase)) h += sideRow(pl);
    $('actions').innerHTML = h;
    tickLeft();
  }

  // ----- подсказки для новичка -----
  // Показываются один раз за партию, когда ситуация встречается впервые.
  // У каждого телефона свои; на одном телефоне — у каждого человека свои.
  let hintsOn = store.get('baai.hints') !== false;
  let hintsSeen = new Set();
  let hintNow = null;
  function setHints(on) { hintsOn = on; store.set('baai.hints', on); }
  const HINTS = {
    role: 'Тайная роль: у каждой есть плюс, минус и способность «раз за игру». Вашу роль видите только вы, пока она не сработает.',
    roll: 'Нажмите «Бросить кубики» — фишка пройдёт столько клеток, сколько выпало. Дубль даёт ещё бросок, три дубля подряд уносят в зимовьё.',
    buy: 'Клетка свободна. Купите её — и каждый, кто на неё встанет, заплатит вам аренду. Откажетесь — клетка уйдёт на аукцион, и торговаться сможете вы тоже.',
    auction: 'Аукцион: ставки идут по кругу. «Пас» — выйти из торгов. Клетку получает последний, кто остался.',
    sealed: 'Тайный аукцион: каждый один раз пишет ставку, чужих ставок никто не видит. Покупает тот, кто дал больше.',
    rent: 'Вы заплатили аренду хозяину клетки. Соберите все клетки одного цвета — ваша аренда удвоится, а с домами вырастет в разы.',
    card: 'Карточки: «Байанай» — перемещения, удача и неудача, «Тюсюлгэ» — деньги и события. «Попутный вездеход» можно хранить до нужного момента.',
    tax: 'Налоги копятся в Приз Ысыаха — сумма видна вверху. Кто встанет на клетку «Ысыах», заберёт всё.',
    jail: 'Вы в зимовье. Выбросьте дубль — пурга стихнет (3 попытки), или вызовите вездеход за 50 ₽. После третьей неудачи вездеход обязателен.',
    debt: 'Денег не хватает. В «Имуществе» ниже можно продать дома и заложить клетки за полцены, а кнопка «Кредит» даст денег в долг. Если не набрать — банкротство.',
    offer: 'Вам предлагают сделку. Сравните, что получаете и что отдаёте. Соглашаться не обязательно.',
    end: 'Ход сделан. Пока не нажали «Завершить ход», можно меняться, брать кредит и строить дома.',
  };
  function hintKey() {
    const p = me(), pl = G.players[p];
    if (!pl || pl.bot || pl.bankrupt || E.actor(G) !== p) return null;
    switch (G.phase) {
      case 'roles': return 'role';
      case 'offer': return 'offer';
      case 'auction': return G.auction.sealed ? 'sealed' : 'auction';
      case 'buy': return 'buy';
      case 'debt': return 'debt';
      case 'roll': return pl.inJail ? 'jail' : 'roll';
      case 'end': {
        const R = G.rentNote;
        if (R && R.payer === p && R.amount > 0 && R.cell === pl.pos) return 'rent';
        if (G.card && G.card.player === p) return 'card';
        if (BOARD[pl.pos].type === 'tax' && G.rules.prize !== 'off') return 'tax';
        return 'end';
      }
    }
    return null;
  }
  function hintHTML() {
    const was = hintNow;
    hintNow = null;
    if (!hintsOn || G.phase === 'over' || buildMode) return '';
    let k = hintKey();
    const id = k && `${me()}:${k}`;
    if (was && was !== id) hintsSeen.add(was);   // ситуация прошла — больше не показываем
    if (!k || hintsSeen.has(id)) return '';
    hintNow = id;
    return `<div class="notice tip"><span class="tip-h">Подсказка</span><p>${esc(HINTS[k])}</p>
      <div class="act-row">${btn('Понятно', 'hintOk', 'sm')}${btn('Больше не показывать', 'hintOff', 'sm ghost')}</div></div>`;
  }

  // ----- плашка аренды -----
  function rentText(R) {
    const p = me(), c = BOARD[R.cell], ow = G.players[R.owner], payer = G.players[R.payer];
    if (!R.amount) return { head: `${c.name} в залоге — аренды нет`, sub: `хозяин ${ow.name}` };
    const head = R.payer === p ? `Вы платите ${rub(R.amount)} → ${ow.name}`
      : R.owner === p ? `${payer.name} платит вам ${rub(R.amount)}`
      : `${payer.name} платит ${rub(R.amount)} → ${ow.name}`;
    return { head, sub: [c.name].concat(R.why || []).join(' · ') };
  }
  function showRent(R) {
    const el = $('rentbar');
    if (!el || !G) return;
    const t = rentText(R), ow = G.players[R.owner];
    el.style.setProperty('--gc', cellColor(BOARD[R.cell]));
    el.className = 'rentbar' + (R.payer === me() && R.amount ? ' mine' : '') + (R.amount ? '' : ' free');
    el.innerHTML = `${token(ow, 34)}<div><b>${esc(t.head)}</b><span>${esc(t.sub)}</span></div>`;
    el.hidden = false;
    clearTimeout(rentT);
    rentT = setTimeout(() => { el.hidden = true; }, 5000);
  }

  // Сколько секунд осталось на ставку или ответ
  function tickLeft() {
    const el = $('t-left');
    if (!el) return;
    const s = Math.max(0, Math.ceil((NET.deadline - Date.now()) / 1000));
    el.textContent = G.phase === 'auction' ? `На ставку: ${s} с, потом «Пас»` : `На ответ: ${s} с`;
    if (G.phase === 'auction' && myMove() && s > 0 && s <= 5 && s !== lastTick) FX.play('tick');
    lastTick = s;
  }

  function renderPlayers() {
    $('players').innerHTML = G.players.map((p, i) => {
      const tags = [];
      if (p.bankrupt) tags.push('банкрот');
      else if (p.inJail) tags.push('в зимовье');
      if (p.loan) tags.push(`долг ${rub(p.loan.owe)}`);
      if (p.freeCards.length) tags.push(`вездеход ×${p.freeCards.length}`);
      if (netGame() && i === NET.me) tags.unshift('вы');
      if (p.bot) tags.unshift('бот');
      if (roleOf(i) && G.players[i].roleShown) tags.push(roleOf(i).name);
      if (netGame() && NET.online && !NET.online[i] && !p.bankrupt) tags.push('нет связи');
      const money = heldMoney && heldMoney[i] !== undefined ? heldMoney[i] : p.money;
      return `<div class="pl${i === E.actor(G) ? ' cur' : ''}${p.bankrupt ? ' out' : ''}">${token(p, 36)}
        <span class="col"><span class="nm">${esc(p.name)}</span><span class="mn">${p.bankrupt ? '—' : moneyOf(i, money)}</span>${tags.length ? `<span class="tg">${tags.join(', ')}</span>` : ''}</span></div>`;
    }).join('');
  }

  function cellColor(c) {
    if (c.type === 'prop') return T.GROUP[c.group];
    if (c.type === 'transport') return T.C.ink;
    if (c.type === 'utility') return T.C.gold;
    return T.C.silver;
  }
  function cellIcon(i) {
    const c = BOARD[i];
    if (c.type === 'prop') return T.GROUP_ICON[c.group];
    return T.CELL_ICON[i] || T.TYPE_ICON[c.type];
  }

  function loanLine(L) {
    const from = L.from === BANK ? 'банку' : G.players[L.from].name;
    return `Вернуть ${rub(L.owe)} → ${esc(from)}, ${L.laps > 0 ? 'через ' + laps(L.laps) : 'сейчас'}`;
  }

  function renderAssets() {
    const p = me(), pl = G.players[p];
    $('assets-title').textContent = netGame() ? 'Ваше имущество' : `Имущество: ${pl.name}`;
    const mine = Object.keys(G.own).map(Number).filter(i => G.own[i].owner === p).sort((a, b) => a - b);
    let h = '';
    if (roleOf(p)) h += `<div class="asset"><span class="sw" style="--gc:${T.C.ink}">${icon('mask', '#ffffff', 2)}</span>
      <span class="info" data-act="roleShow" data-p="${p}" role="button" tabindex="0"><b>Тайная роль${pl.roleShown ? ': ' + esc(roleOf(p).name) : ''}</b><span>${pl.roleShown ? 'раскрыта' : 'нажмите, чтобы посмотреть'}${pl.roleUsed ? ' · способность потрачена' : ''}</span></span></div>`;
    if (pl.loan) h += `<div class="asset loan"><span class="sw" style="--gc:${T.C.deep}">${icon('card', '#ffffff', 2.2)}</span>
      <span class="info" data-act="loanOpen" role="button" tabindex="0"><b>Кредит</b><span>${loanLine(pl.loan)}</span></span></div>`;
    if (!mine.length) { $('assets').innerHTML = h + '<p class="empty-note">Пока ничего нет. Покупайте клетки, на которые встаёте.</p>'; return; }
    const canAct = ['roll', 'end', 'debt', 'buy'].includes(G.phase) && !pl.bankrupt && E.actor(G) === p;
    const calm = G.phase === 'roll' || G.phase === 'end';
    h += mine.map(i => {
      const c = BOARD[i], o = G.own[i];
      let sub = '';
      if (o.mortgaged) sub = `в залоге · выкуп ${rub(E.unmortgageCost(i))}`;
      else if (c.type === 'prop') {
        const full = E.ownsGroup(G, p, c.group);
        sub = o.houses === 5 ? 'отель' : o.houses ? `домов: ${o.houses}` : (full ? 'вся группа' : 'участок');
        sub += ` · аренда ${rub(E.rentFor(G, i))}`;
      } else if (c.type === 'transport') sub = `аренда ${rub(E.rentFor(G, i))}`;
      else sub = 'аренда по кубикам';
      let btns = '';
      if (canAct) {
        const houses = c.type === 'prop' && E.groupHasHouses(G, c.group);
        if (houses) {
          if (E.canSell(G, p, i)) btns += `<button type="button" class="btn sm" data-act="sell" data-cell="${i}">${sellWord(i)}</button>`;
          if (E.canBuild(G, p, i) && calm) btns += `<button type="button" class="btn sm gold" data-act="build" data-cell="${i}">${houseWord(i, p)}</button>`;
        } else if (o.mortgaged) {
          if (calm) btns = `<button type="button" class="btn sm" data-act="unmortgage" data-cell="${i}" ${E.canUnmortgage(G, p, i) ? '' : 'disabled'}>Выкуп</button>`;
        } else {
          if (calm && E.canBuild(G, p, i)) btns += `<button type="button" class="btn sm gold" data-act="build" data-cell="${i}">${houseWord(i, p)}</button>`;
          btns += `<button type="button" class="btn sm" data-act="mortgage" data-cell="${i}" aria-label="Заложить за ${E.mortgageValue(i)} ₽">Залог</button>`;
        }
      }
      return `<div class="asset${o.mortgaged ? ' frozen' : ''}"><span class="sw" style="--gc:${cellColor(c)}">${icon(cellIcon(i), '#ffffff', 2.4)}</span>
        <span class="info" data-act="info" data-cell="${i}" role="button" tabindex="0"><b>${esc(c.name)}</b><span>${sub}</span></span>${btns}</div>`;
    }).join('');
    $('assets').innerHTML = h;
  }

  function renderLog() {
    $('log').innerHTML = G.log.slice(-30).reverse().map(t => `<li>${esc(t)}</li>`).join('');
  }

  function renderTimer() {
    const el = $('timer');
    const grow = G && G.grow > 1 && G.phase !== 'over' ? `цены +${Math.round((G.grow - 1) * 100)}%` : '';
    el.title = grow;
    if (!G || !G.endsAt || G.phase === 'over') { el.textContent = grow; return; }
    const left = Math.max(0, G.endsAt - Date.now() - (netGame() && NET.isClient() ? NET.skew : 0));
    if (!left) { el.textContent = 'Время вышло'; return; }
    const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
    el.textContent = `${m}:${String(s).padStart(2, '0')}${grow ? ' · ' + grow : ''}`;
  }

  function renderPrize() {
    const el = $('prize');
    el.hidden = !G || !G.prize;
    if (G && G.prize) el.innerHTML = `<span>Приз Ысыаха</span><b>${rub(G.prize)}</b>`;
  }

  function render(opts) {
    opts = Object.assign({}, opts);
    const settled = [];
    // звуки и анимации по разнице с прошлым состоянием
    const prev = lastSnap;
    lastSnap = snap(G);
    const ev = prev && prev.n === lastSnap.n ? diff(prev, lastSnap) : null;
    heldMoney = null;
    if (ev) {
      playNow(ev, opts);
      if (opts.rolled && ev.money.length) heldMoney = prev.money;
      settled.push(() => { if (heldMoney) { heldMoney = null; renderPlayers(); } playSettled(ev); });
    }
    // плашка аренды — когда фишка дошла до чужой клетки
    const R = G.rentNote;
    if (R && R.seq > shownRent) {
      shownRent = R.seq;
      if (prev) settled.push(() => showRent(R));
    }
    // новую карточку показываем, когда фишка дошла до клетки
    if (G.card && G.card.seq > shownCard) {
      shownCard = G.card.seq;
      const card = G.card;
      settled.push(() => showCard(card));
    }
    if (settled.length) opts.onSettled = () => settled.forEach(f => f());
    $('status').innerHTML = statusHTML();
    if (opts.rolled && G.dice) rollDice(G.dice);
    if (board) board.update(G, opts);
    else if (opts.onSettled) opts.onSettled();
    if (opts.turnChanged || !G || !calmPhase()) buildMode = false;
    renderActions();
    syncMarks();
    renderPlayers();
    renderAssets();
    renderLog();
    renderTimer();
    renderPrize();
  }


  // ---------- звуки и анимации ----------
  function snap(S) {
    const own = {};
    for (const k in S.own) { const o = S.own[k]; own[k] = { owner: o.owner, houses: o.houses || 0, m: !!o.mortgaged }; }
    return {
      n: S.players.length,
      money: S.players.map(p => p.money),
      out: S.players.map(p => !!p.bankrupt),
      jail: S.players.map(p => !!p.inJail),
      own, prize: S.prize || 0, phase: S.phase, turn: S.turn, actor: E.actor(S),
      auc: S.auction ? { cell: S.auction.cell, price: S.auction.price, leader: S.auction.leader } : null,
    };
  }

  function diff(a, b) {
    const ev = { money: [], bought: [], up: [], down: [], frozen: [], melted: [], jailIn: [], jailOut: [], broke: [] };
    b.money.forEach((m, i) => { const d = m - a.money[i]; if (d && !b.out[i]) ev.money.push({ p: i, d }); });
    for (const k in b.own) {
      const o = b.own[k], w = a.own[k], i = Number(k);
      if (!w || w.owner !== o.owner) ev.bought.push({ cell: i, owner: o.owner });
      else {
        if (o.houses > w.houses) ev.up.push({ cell: i, hotel: o.houses === 5 });
        if (o.houses < w.houses) ev.down.push(i);
        if (o.m && !w.m) ev.frozen.push(i);
        if (!o.m && w.m) ev.melted.push(i);
      }
    }
    b.jail.forEach((j, i) => { if (j && !a.jail[i]) ev.jailIn.push(i); if (!j && a.jail[i] && !b.out[i]) ev.jailOut.push(i); });
    b.out.forEach((o, i) => { if (o && !a.out[i]) ev.broke.push(i); });
    ev.fromAuction = a.phase === 'auction' && b.phase !== 'auction';
    ev.prize = a.prize > 0 && b.prize === 0 && ev.money.some(m => m.d > 0) ? a.prize : 0;
    ev.over = b.phase === 'over' && a.phase !== 'over';
    ev.auctionStart = b.auc && (!a.auc || a.auc.cell !== b.auc.cell);
    ev.bid = b.auc && a.auc && a.auc.cell === b.auc.cell && (a.auc.price !== b.auc.price || a.auc.leader !== b.auc.leader);
    ev.offer = b.phase === 'offer' && a.phase !== 'offer';
    ev.actorChanged = a.actor !== b.actor || a.turn !== b.turn;
    return ev;
  }

  const chip = i => document.querySelectorAll('#players .pl')[i];
  const boardPoint = () => $('board').getBoundingClientRect().height ? $('board') : null;

  // Сразу: пурга, аукцион, просьба ответить, «ваш ход»
  function playNow(ev) {
    if (ev.jailIn.length) { FX.play('wind'); FX.vibe([30, 40, 30]); }
    if (ev.auctionStart) FX.play('gavel');
    else if (ev.bid) FX.play('bid');
    const mineNow = netGame() ? E.actor(G) === NET.me : !isBot(E.actor(G));
    if (G.phase === 'over') return;
    if (ev.offer && mineNow) { FX.play('offer'); FX.vibe([60, 50, 60]); }
    else if (ev.actorChanged && G.phase === 'roll' && !ev.jailIn.length) {
      if (netGame() && E.actor(G) === NET.me) { FX.play('turn'); FX.vibe(120); }
      else if (!netGame() && !isBot(E.actor(G))) FX.play('turn');
    }
  }

  // Когда фишка дошла: деньги, покупка, стройка, иней, приз, победа
  function playSettled(ev) {
    const gains = ev.money.filter(m => m.d > 0), losses = ev.money.filter(m => m.d < 0);
    ev.money.forEach(m => FX.floatText(chip(m.p), (m.d > 0 ? '+' : '−') + rub(Math.abs(m.d)), m.d > 0));
    const bp = boardPoint();
    if (losses.length && gains.length) losses.forEach(l => gains.forEach(g => FX.coins(chip(l.p), chip(g.p), Math.ceil(Math.min(-l.d, g.d) / 60))));
    else if (gains.length) gains.forEach(g => FX.coins(bp, chip(g.p), Math.ceil(g.d / 60)));
    else if (losses.length) losses.forEach(l => FX.coins(chip(l.p), bp, Math.ceil(-l.d / 60)));

    if (board) {
      ev.bought.forEach(b => board.fx('flash', b.cell, G.players[b.owner].color));
      ev.up.forEach(u => board.fx('puff', u.cell, u.hotel));
      ev.frozen.forEach(i => board.fx('freeze', i));
      ev.melted.forEach(i => board.fx('melt', i));
      if (ev.prize) board.fx('fireworks', 20);
      if (ev.over) board.fx('fireworks', null);
    }
    // один главный звук на событие
    const sound = ev.over ? 'win' : ev.prize ? 'prize' : ev.broke.length ? 'bankrupt'
      : ev.bought.length ? (ev.fromAuction ? 'sold' : 'buy')
      : ev.up.some(u => u.hotel) ? 'hotel' : ev.up.length ? 'build' : ev.down.length ? 'sell'
      : ev.frozen.length ? 'frost' : ev.melted.length ? 'melt'
      : ev.jailOut.length ? 'calm' : gains.length ? 'coin' : losses.length ? 'pay' : null;
    if (sound) FX.play(sound);
    if (ev.prize || ev.over) FX.vibe([80, 60, 80, 60, 160]);
    else if (ev.broke.length) FX.vibe(400);
    else if (netGame() && losses.some(l => l.p === NET.me) && gains.length) FX.vibe([60, 40, 60]);
    if (ev.over) { FX.beads(); setTimeout(showVictory, 700); }
  }

  // Итоги партии: кто сколько заработал на аренде, налоги, приз, покупки; самая доходная клетка
  function statsHTML(rank) {
    const S = E.summary(G);
    const row = (t, v, cls) => `<div class="st-row${cls ? ' ' + cls : ''}"><span>${t}</span><b>${v}</b></div>`;
    const best = S.best ? `<p class="best">${icon(cellIcon(S.best.cell), cellColor(BOARD[S.best.cell]), 2.2)}<span>Самая доходная клетка: <b>${esc(BOARD[S.best.cell].name)}</b> — ${rub(S.best.amount)} аренды${S.best.owner !== null && S.best.owner >= 0 ? ` · владелец ${esc(G.players[S.best.owner].name)}` : ''}</span></p>` : '';
    return `<h4 class="st-head">Итоги партии</h4>${best}<div class="stats">${rank.map(r => {
      const q = S.players[r.i] || {};
      const rows = [
        row('Получил аренды', q.rentIn ? '+' + rub(q.rentIn) : rub(0), 'plus'),
        row('Заплатил аренды', q.rentOut ? '−' + rub(q.rentOut) : rub(0), 'minus'),
        q.tax ? row('Налоги', '−' + rub(q.tax), 'minus') : '',
        q.prize ? row('Приз Ысыаха', '+' + rub(q.prize), 'plus') : '',
        row('Куплено клеток', String(q.bought || 0)),
        q.auctions ? row('из них на аукционе', String(q.auctions)) : '',
        q.spent ? row('Потратил на клетки', rub(q.spent)) : '',
      ].join('');
      return `<div class="st-card">${token(r.p, 28)}<b class="st-nm">${esc(r.p.name)}</b>${rows}</div>`;
    }).join('')}</div>`;
  }

  function showVictory() {
    if (!G || G.phase !== 'over') return;
    const w = G.players[G.winner];
    const rank = G.players.map((p, i) => ({ p, i, nw: p.bankrupt ? -1 : E.netWorth(G, i) })).sort((a, b) => b.nw - a.nw);
    const cells = i => Object.keys(G.own).filter(k => G.own[k].owner === i).length;
    openKind('victory', `<div class="victory"><div class="v-ring">${token(w, 112)}</div>
      <p class="sub">Победитель</p><h3>${esc(w.name)}</h3>
      <p>${G.overReason === 'time' ? `Время вышло. Самый богатый: ${rub(E.netWorth(G, G.winner))}.` : 'Остальные разорились. Байанай на вашей стороне!'}</p></div>
      <ol class="rank">${rank.map(r => `<li class="${r.i === G.winner ? 'win' : ''}">${token(r.p, 30)}<span>${esc(r.p.name)}</span>
        <em>${r.p.bankrupt ? 'банкрот' : `${cells(r.i)} кл.`}</em><b>${r.p.bankrupt ? '—' : rub(r.nw)}</b></li>`).join('')}</ol>
      <p class="sub center">Богатство: деньги, клетки и дома, минус долги.</p>
      ${statsHTML(rank)}
      ${NET.isClient() ? '<p class="sub center">Новую партию начнёт хост.</p>' : btn('Новая партия', 'newGame', 'primary big')}
      ${btn('Посмотреть поле', 'close', 'ghost')}`);
  }

  // ---------- шторки ----------
  function openSheet(html) {
    $('sheet').innerHTML = html;
    $('sheet').hidden = false;
    $('sheet-bg').hidden = false;
    const f = $('sheet').querySelector('.btn');
    if (f) f.focus({ preventScroll: true });
  }
  function closeSheet() {
    $('sheet').hidden = true;
    $('sheet-bg').hidden = true;
  }
  const sheetIs = kind => !$('sheet').hidden && $('sheet').dataset.kind === kind;
  function openKind(kind, html) { openSheet(html); $('sheet').dataset.kind = kind; }

  function showCard(card) {
    FX.play(card.deck); FX.vibe(20);
    const ic = card.deck === 'bayanai' ? icon('bow', T.C.larch, 2.2) : icon('bowl', T.C.coral, 2.2);
    openKind('card', `<div class="card-wrap"><div class="card-face ${card.deck}">${ic}
        <div class="deck">${esc(card.title)}</div><p>${esc(card.text)}</p></div></div>
      ${btn('Понятно', 'close', 'primary big')}`);
    // карточку бота убираем сами — человеку не надо её закрывать
    if (isBot(card.player)) {
      const sheet = $('sheet');
      sheet.querySelector('.deck').textContent = `${card.title} · ${G.players[card.player].name}`;
      setTimeout(() => { if (sheetIs('card') && sheet.dataset.seq === String(card.seq)) closeSheet(); }, botFast ? 1600 : 2800);
    }
    $('sheet').dataset.seq = card.seq;
  }

  function showCell(i) {
    if (!G) return;
    const c = BOARD[i], o = G.own[i];
    const owner = o ? G.players[o.owner].name : 'свободна';
    let h = '';
    const head = (title, sub) => `<div class="cell-head" style="--gc:${cellColor(c)}">${icon(cellIcon(i), '#ffffff', 2.2)}<div><h3>${esc(title)}</h3><p class="sub">${esc(sub)}</p></div></div>`;
    const ownerRow = `<tr><td>Владелец</td><td>${esc(owner)}${o && o.mortgaged ? ' · в залоге' : ''}</td></tr>`;
    const mortRows = c.price ? `<tr><td>Залог</td><td>+${rub(E.mortgageValue(i))}</td></tr><tr><td>Выкуп из залога</td><td>${rub(E.unmortgageCost(i))}</td></tr>` : '';
    if (c.type === 'prop') {
      const g = GROUPS[c.group];
      const full = o && E.ownsGroup(G, o.owner, c.group);
      const cur = o && !o.mortgaged ? o.houses : -1;
      const R = (h, f) => E.baseRent(G, i, h, f);
      const rows = [
        ['Участок', R(0, false), cur === 0 && !full],
        ['Вся группа у владельца', R(0, true), cur === 0 && full],
        ['1 дом', R(1), cur === 1], ['2 дома', R(2), cur === 2],
        ['3 дома', R(3), cur === 3], ['4 дома', R(4), cur === 4],
        ['Отель', R(5), cur === 5],
      ];
      h = head(c.name, g.name) + `<table class="rent"><tbody>
          ${rows.map(r => `<tr class="${r[2] ? 'on' : ''}"><td>${r[0]}</td><td>${rub(r[1])}</td></tr>`).join('')}
          <tr><td>Цена участка</td><td>${rub(E.price(G, i))}</td></tr>
          <tr><td>Дом или отель</td><td>${rub(E.houseCost(G, c.group))}</td></tr>
          ${mortRows}${ownerRow}
        </tbody></table>`;
      const p = me();
      if (o && o.owner === p && !G.players[p].bankrupt) {
        const b = buildWhy(p, i);
        const canSellNow = E.canSell(G, p, i) && myMove() && E.actor(G) === p && ['roll', 'end', 'debt', 'buy'].includes(G.phase);
        h += `<div class="build-box"><h4>${icon('house', T.C.ink, 2.2)}Строительство</h4>
          ${b && b.ok ? '' : `<p>${esc(b ? b.why : '')}</p>`}
          <div class="act-row">${b && b.ok ? btn(houseWord(i, p), 'build', 'primary big', false, `data-cell="${i}"`) : ''}${canSellNow ? btn(sellWord(i), 'sell', '', false, `data-cell="${i}"`) : ''}</div></div>`;
      }
    } else if (c.type === 'transport') {
      h = head(c.name, 'Транспорт') + `<table class="rent"><tbody>
        ${[1, 2, 3, 4].map(n => `<tr><td>Если у владельца ${n} ${n === 1 ? 'транспорт' : 'транспорта'}</td><td>${rub(E.up(G, RULES.transportRent[n]))}</td></tr>`).join('')}
        <tr><td>Цена</td><td>${rub(E.price(G, i))}</td></tr>${mortRows}${ownerRow}</tbody></table>`;
    } else if (c.type === 'utility') {
      h = head(c.name, 'Коммуналка') + `<table class="rent"><tbody>
        <tr><td>Одна у владельца</td><td>4 × сумма кубиков</td></tr>
        <tr><td>Обе у владельца</td><td>10 × сумма кубиков</td></tr>
        <tr><td>Цена</td><td>${rub(E.price(G, i))}</td></tr>${mortRows}${ownerRow}</tbody></table>`;
    } else {
      const about = {
        start: `Каждый раз, когда проходишь Старт или встаёшь на него, получаешь ${rub(RULES.passStart)}.`,
        jail: 'Сюда попадают из-за пурги. Выбраться можно дублем (пурга стихла), вызвав вездеход за 50 ₽ или по карте «Попутный вездеход». После третьей попытки вездеход обязателен. Если пришёл сюда обычным ходом, ты просто в гостях.',
        parking: G.rules.prize === 'off' ? 'Праздник Ысыах. В этой партии приза нет — просто отдыхаешь.'
          : `Праздник Ысыах. В Приз Ысыаха копятся налоги и проценты по кредитам банка. Кто встал сюда, забирает приз. Сейчас в призе: ${rub(G.prize)}.`,
        gotojail: 'Пурга! Тебя заметает в пути: отправляйся прямо в зимовьё, Старт не проходишь, 200 ₽ не получаешь.',
        tax: `Заплати ${rub(E.taxOf(G, i))}. ${G.rules.prize === 'off' ? 'Деньги уходят банку.' : 'Деньги уходят в Приз Ысыаха.'}`,
        bayanai: DECK_ABOUT.bayanai,
        tyusyulge: DECK_ABOUT.tyusyulge,
      }[c.type];
      h = head(c.name, 'Клетка') + `<p>${esc(about)}</p>`;
    }
    // залог своей клетки
    const tp = G.turn, mine = o && o.owner === tp && !G.players[tp].bankrupt && myMove();
    if (mine && o.mortgaged && (G.phase === 'roll' || G.phase === 'end')) {
      h += `<div class="act-row">${btn(`Выкупить · ${rub(E.unmortgageCost(i))}`, 'unmortgage', 'primary', !E.canUnmortgage(G, tp, i), `data-cell="${i}"`)}</div>`;
    } else if (mine && !o.mortgaged && ['roll', 'end', 'debt', 'buy'].includes(G.phase)) {
      const blocked = c.type === 'prop' && E.groupHasHouses(G, c.group);
      h += `<div class="act-row">${btn(`Заложить · +${rub(E.mortgageValue(i))}`, 'mortgage', '', blocked, `data-cell="${i}"`)}</div>`;
      if (blocked) h += '<p class="sub">Чтобы заложить, сначала продайте дома в этой группе.</p>';
    }
    h += btn('Закрыть', 'close', 'ghost');
    openKind('cell:' + i, h);
  }

  // ---------- обмен ----------
  function tradeTargets() { return G.players.map((_, i) => i).filter(i => i !== G.turn && !G.players[i].bankrupt); }

  function readTradeMoney() {
    if (!trade) return;
    ['give', 'get'].forEach(side => {
      const el = $('t-' + side);
      if (el) trade[side].money = Math.max(0, Math.floor(Number(el.value) || 0));
    });
  }

  function cellChips(owner, side) {
    const ids = Object.keys(G.own).map(Number).filter(i => G.own[i].owner === owner).sort((a, b) => a - b);
    const ok = ids.filter(i => E.canTradeCell(G, owner, i));
    const locked = ids.length - ok.length;
    let h = ok.length ? `<div class="chips">${ok.map(i => {
      const on = trade[side].cells.includes(i), o = G.own[i];
      return `<button type="button" class="chip" aria-pressed="${on}" data-act="tCell" data-side="${side}" data-cell="${i}" style="--gc:${cellColor(BOARD[i])}"><i></i>${esc(BOARD[i].name)}${o.mortgaged ? ' ❄' : ''}</button>`;
    }).join('')}</div>` : '<p class="sub">Клеток для обмена нет.</p>';
    if (locked) h += `<p class="sub">Клетки из групп с домами менять нельзя: ${locked}.</p>`;
    return h;
  }

  function cardStepper(owner, side) {
    const n = G.players[owner].freeCards.length;
    if (!n) return '';
    const v = trade[side].cards;
    return `<div class="stepper"><span>«Попутный вездеход»</span>
      <button type="button" class="btn sm" data-act="tCards" data-side="${side}" data-d="-1" ${v ? '' : 'disabled'} aria-label="Меньше">−</button>
      <b>${v}</b><button type="button" class="btn sm" data-act="tCards" data-side="${side}" data-d="1" ${v < n ? '' : 'disabled'} aria-label="Больше">+</button></div>`;
  }

  function showTrade() {
    const me = G.players[G.turn], them = G.players[trade.to];
    const chips = tradeTargets().map(i => `<button type="button" class="who-chip" aria-pressed="${i === trade.to}" data-act="tTo" data-p="${i}">${token(G.players[i], 30)}<span>${esc(G.players[i].name)}</span></button>`).join('');
    openKind('trade', `<h3>Обмен</h3>
      <div class="who-row">${chips}</div>
      <section class="tside"><h4>Вы отдаёте</h4>${cellChips(G.turn, 'give')}
        <label class="money"><span>Деньги</span><input id="t-give" type="number" inputmode="numeric" min="0" step="10" max="${me.money}" value="${trade.give.money || ''}" placeholder="0"><em>из ${rub(me.money)}</em></label>
        ${cardStepper(G.turn, 'give')}</section>
      <section class="tside"><h4>Вы получаете · ${esc(them.name)}</h4>${cellChips(trade.to, 'get')}
        <label class="money"><span>Деньги</span><input id="t-get" type="number" inputmode="numeric" min="0" step="10" max="${them.money}" value="${trade.get.money || ''}" placeholder="0"><em>${seesMoney(trade.to) ? 'из ' + rub(them.money) : 'сколько есть — не видно'}</em></label>
        ${cardStepper(trade.to, 'get')}</section>
      <p class="sub">За каждую полученную заложенную клетку (❄) платится банку 10% залога. ${esc(them.name)} увидит предложение и решит.</p>
      ${btn('Предложить', 'tSend', 'primary big')}${btn('Отмена', 'close', 'ghost')}`);
  }

  // ---------- кредит ----------
  function showLoan() {
    const p = me(), pl = G.players[p];
    let h = `<div class="loan-head">${icon('card', '#ffffff', 2.2)}</div><h3 class="center">Кредит</h3>`;
    if (pl.loan) {
      const L = pl.loan, calm = (G.phase === 'roll' || G.phase === 'end') && myMove();
      h += `<table class="rent"><tbody>
        <tr><td>Кредитор</td><td>${L.from === BANK ? 'Банк' : esc(G.players[L.from].name)}</td></tr>
        <tr><td>Взято</td><td>${rub(L.principal)}</td></tr>
        <tr><td>Вернуть</td><td>${rub(L.owe)}</td></tr>
        <tr><td>Срок</td><td>${L.laps > 0 ? 'через ' + laps(L.laps) : 'сейчас'}</td></tr></tbody></table>
        <p class="sub">Долг спишется сам, когда пройдёте Старт нужное число раз. Новый кредит можно взять после возврата.</p>
        ${btn(`Вернуть досрочно · ${rub(L.owe)}`, 'loanRepay', 'primary big', !calm || pl.money < L.owe)}
        ${btn('Закрыть', 'close', 'ghost')}`;
      openKind('loan', h);
      return;
    }
    const others = G.players.map((_, i) => i).filter(i => i !== p && !G.players[i].bankrupt);
    const chips = [`<button type="button" class="who-chip" aria-pressed="${loan.from === BANK}" data-act="lFrom" data-p="${BANK}"><span class="bank">${icon('bank', T.C.ink, 2.1)}</span><span>Банк</span></button>`]
      .concat(others.map(i => `<button type="button" class="who-chip" aria-pressed="${loan.from === i}" data-act="lFrom" data-p="${i}">${token(G.players[i], 30)}<span>${esc(G.players[i].name)}</span></button>`)).join('');
    h += `<p class="sub center">Выберите, у кого взять, и условия</p><div class="who-row">${chips}</div>`;
    let rate, lp, amountRow, note;
    if (loan.from === BANK) {
      const B = RULES.bankLoan;
      rate = B.rate; lp = B.laps;
      const opts = []; for (let v = B.step; v <= B.max; v += B.step) opts.push(v);
      amountRow = `<div class="seg" role="radiogroup" aria-label="Сумма">${opts.map(v => `<button type="button" role="radio" aria-checked="${v === loan.amount}" data-act="lAmt" data-v="${v}">${v}</button>`).join('')}</div>`;
      note = 'Проценты по кредиту банка идут в Приз Ысыаха.';
    } else {
      const L = G.players[loan.from];
      rate = loan.rate; lp = loan.laps;
      const max = Math.floor(L.money / RULES.loanStep) * RULES.loanStep;
      amountRow = `<div class="stepper big"><button type="button" class="btn sm" data-act="lStep" data-d="-1" ${loan.amount > RULES.loanStep ? '' : 'disabled'} aria-label="Меньше">−</button>
        <b>${rub(loan.amount)}</b><button type="button" class="btn sm" data-act="lStep" data-d="1" ${loan.amount + RULES.loanStep <= max ? '' : 'disabled'} aria-label="Больше">+</button></div>
        <h4>Процент</h4><div class="seg" role="radiogroup" aria-label="Процент">${RULES.loanRates.map(v => `<button type="button" role="radio" aria-checked="${v === loan.rate}" data-act="lRate" data-v="${v}">${v}%</button>`).join('')}</div>
        <h4>Срок</h4><div class="seg" role="radiogroup" aria-label="Срок">${RULES.loanLaps.map(v => `<button type="button" role="radio" aria-checked="${v === loan.laps}" data-act="lLaps" data-v="${v}">${laps(v)}</button>`).join('')}</div>`;
      note = `Нужно согласие игрока ${esc(L.name)}: ${netGame() ? 'запрос придёт на его телефон' : 'передайте телефон'}. ${seesMoney(loan.from) ? `Денег у игрока: ${rub(L.money)}.` : ''}`;
    }
    const owe = Math.round(loan.amount * (1 + rate / 100));
    h += `<h4>Сумма</h4>${amountRow}
      <div class="loan-sum"><div><span>Вернуть через ${laps(lp)}</span><b>${rub(owe)}</b></div>
      <p class="sub">${loan.from === BANK ? `Ставка ${rate}%. ` : ''}Если к сроку денег не хватит, придётся продать дома, заложить клетки или объявить банкротство. ${note}</p></div>
      ${btn(loan.from === BANK ? 'Взять кредит' : 'Попросить в долг', 'lTake', 'primary big', loan.from !== BANK && G.players[loan.from].money < RULES.loanStep)}
      ${btn('Отмена', 'close', 'ghost')}`;
    openKind('loan', h);
  }

  function fixLoanAmount() {
    if (loan.from === BANK) {
      const B = RULES.bankLoan;
      if (loan.amount % B.step || loan.amount > B.max || loan.amount < B.step) loan.amount = B.max;
    } else {
      const max = Math.max(RULES.loanStep, Math.floor(G.players[loan.from].money / RULES.loanStep) * RULES.loanStep);
      loan.amount = Math.min(Math.max(RULES.loanStep, loan.amount - loan.amount % RULES.loanStep), max);
    }
  }

  // ---------- меню и правила ----------
  function showMenu() {
    openKind('menu', `<h3>Меню</h3>
      ${btn('Правила кратко', 'rules')}
      <div class="toggles">${btn(`${icon(FX.sound ? 'sound' : 'mute', 'currentColor', 2.2)}${FX.sound ? 'Звук включён' : 'Звук выключен'}`, 'fxSound', 'sm ic', false, `aria-pressed="${FX.sound}"`)}
      ${FX.canVibe ? btn(`${icon('vibe', 'currentColor', 2.2)}${FX.vibe ? 'Вибрация включена' : 'Вибрация выключена'}`, 'fxVibe', 'sm ic', false, `aria-pressed="${FX.vibe}"`) : ''}</div>
      ${btn(hintsOn ? 'Подсказки для новичка: вкл' : 'Подсказки для новичка: выкл', 'hintsToggle', 'sm', false, `aria-pressed="${hintsOn}"`)}
      ${G && G.players.some(p => p.bot) && !NET.isClient() ? btn(`${icon('sled', 'currentColor', 2.2)}${botFast ? 'Боты ходят быстро' : 'Боты ходят обычно'}`, 'botSpeed', 'sm ic', false, `aria-pressed="${botFast}"`) : ''}
      ${NET.isHost() ? btn('QR для подключения', 'showQr') : ''}
      ${NET.isClient() ? '' : btn('Новая партия', 'askNew')}
      ${btn('Закрыть', 'close', 'ghost')}`);
  }

  function showRules() {
    openKind('rules', `<h3>Правила кратко</h3>
      <ul class="rules">
        <li>Бросай два кубика и ходи по кругу. Дубль даёт ещё один бросок, три дубля подряд — в пургу и в зимовьё.</li>
        <li>Клетка «Пурга» отправляет в «Зимовьё». Выбраться: дубль, вездеход за 50 ₽ или карта «Попутный вездеход».</li>
        <li>Встал на свободную клетку — можешь купить её. Если не купил, клетка уходит на аукцион. Торги начинаются с половины цены, участвуют все.</li>
        <li>На чужой клетке платишь аренду. Если у владельца вся группа, аренда пустого участка удваивается. С заложенной клетки аренда не берётся.</li>
        <li>Транспорт: 25, 50, 100 или 200 ₽, смотря сколько их у владельца. Коммуналка: 4× или 10× сумма кубиков.</li>
        <li>Строить можно, когда собрана вся группа и ни одна клетка в ней не заложена. Дома ставятся равномерно, до 4, потом отель. Продать дом можно за полцены.</li>
        <li>Залог: клетка без домов в группе закладывается за половину цены. Выкуп — залог плюс 10%.</li>
        <li>Обмен: в начале или в конце своего хода предложи любому игроку клетки, деньги или карты «Попутный вездеход». За полученную заложенную клетку платишь банку 10% залога.</li>
        <li>Кредит: в банке до 500 ₽ под 20% на 2 круга или у игрока на ваших условиях, если он согласится. Долг списывается сам после нужного числа проходов Старта. Кредит может быть только один.</li>
        <li>Приз Ысыаха: налоги и проценты по кредитам банка копятся в призе. Кто встал на «Ысыах», забирает его.</li>
        <li>Проход через Старт: +200 ₽.</li>
        <li>Не хватает денег — продавай дома и закладывай клетки. Если и это не помогает, ты банкрот: имущество получает тот, кому ты должен. Если должен банку — клетки уходят на аукцион. Побеждает последний оставшийся.</li>
        <li>Поле: нажми на клетку, чтобы узнать о ней. Двумя пальцами — приблизить, кнопка в углу — всё поле.</li>
      </ul>
      ${btn('Закрыть', 'close', 'ghost')}`);
  }

  // Передать телефон тому, кто сейчас действует
  function showHandoff() {
    const who = E.actor(G), pl = G.players[who];
    holder = who;
    let sub = 'Передайте телефон', what = G.rules.money === 'hidden' ? 'Ваш ход' : rub(pl.money), go = 'Мой ход';
    if (G.phase === 'roles') {
      sub = 'Тайная роль · остальные не смотрят';
      what = 'Выберите роль втайне';
      go = 'Выбрать роль';
    } else if (G.phase === 'auction' && G.auction.sealed) {
      sub = 'Тайный аукцион · остальные не смотрят';
      what = `${BOARD[G.auction.cell].name}: ставки от ${rub(G.auction.start)}`;
      go = 'Сделать ставку';
    } else if (G.phase === 'auction') {
      const A = G.auction;
      sub = 'Аукцион · передайте телефон';
      what = `${BOARD[A.cell].name}: ${A.leader === null ? 'торги с ' + rub(A.start) : 'ставка ' + rub(A.price)}`;
      go = 'Торговаться';
    } else if (G.phase === 'offer') {
      sub = 'Передайте телефон';
      what = G.offer.kind === 'trade' ? `${G.players[G.offer.from].name} предлагает обмен` : `${G.players[G.offer.from].name} просит в долг`;
      go = 'Посмотреть';
    } else if (who === G.turn && G.phase !== 'roll') {
      go = 'Продолжить ход';
    }
    openKind('handoff', `<div class="handoff">${token(pl, 96)}<p class="sub">${esc(sub)}</p>
      <h3>${esc(pl.name)}</h3><p>${esc(what)}</p></div>
      ${btn(go, 'close', 'primary big')}`);
  }

  // Передать телефон, если теперь действует другой человек (боты ходят сами)
  function maybeHandoff() {
    if (netGame() || !G || G.phase === 'over') return;
    const a = E.actor(G);
    if (isBot(a)) return;
    if (humans() <= 1) { holder = a; return; }
    if (a !== holder) showHandoff();
  }

  // ---------- боты ----------
  let botFast = store.get('baai.botfast') === true;
  // Если сейчас ходит бот — через паузу делаем его ход. Ходы ботов делает этот телефон (или хост)
  function botTick(last) {
    clearTimeout(botT);
    if (!G || G.phase === 'over' || NET.isClient() || $('game').hidden || !isBot(E.actor(G))) return;
    const wait = BOT.delay(G, last) * (botFast ? 0.45 : 1);
    botT = setTimeout(() => {
      if (!G || G.phase === 'over' || !isBot(E.actor(G))) return;
      const o = G.phase === 'offer' ? G.offer : null;
      const a = BOT.step(G, x => applyAction(x, { remote: true, bot: true }));
      if (o && a && (a.type === 'accept' || a.type === 'reject') && (!netGame() || o.from === NET.me) && !isBot(o.from)) {
        const nm = G.players[a.player].name;
        toast(a.type === 'accept' ? `${nm}: ${o.kind === 'trade' ? 'обмен принят' : 'даёт в долг'}` : `${nm}: ${o.kind === 'trade' ? 'от обмена отказывается' : 'в долг не даёт'}`);
      }
      botTick(a);
    }, wait);
  }

  let toastT = 0;
  function toast(t) {
    const el = $('toast');
    el.textContent = t; el.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { el.hidden = true; }, 2500);
  }

  // ---------- действия ----------
  function send(type, extra) {
    const a = Object.assign({ type, player: netGame() ? NET.me : E.actor(G) }, extra || {});
    if (NET.isClient()) return NET.send(a);
    if (!netGame()) holder = a.player;
    const r = applyAction(a, {});
    if (!r.ok) toast(r.error);
    return r.ok;
  }

  // Применить действие к партии: на одном телефоне или у хоста.
  // how.remote — действие пришло с другого телефона (или сработал таймер)
  function applyAction(a, how) {
    const before = G.turn, actorBefore = E.actor(G);
    const local = !netGame() && !(how && how.bot);
    const label = local ? E.undoLabel(G, a) : null;
    const wasTrade = G.offer && G.offer.kind === 'trade';
    const copy = label || (local && a.type === 'offerTrade') ? JSON.stringify(G) : null;
    const r = E.act(G, a);
    if (!r.ok) return r;
    if (!netGame()) {
      if (a.type === 'offerTrade' && copy) tradeSnap = copy;
      else if (a.type === 'accept' && label) { if (tradeSnap) undo.push({ g: tradeSnap, label, turn: G.turn }); tradeSnap = null; }
      else if (label) undo.push({ g: copy, label, turn: G.turn });
      else if (a.type === 'reject' && wasTrade) tradeSnap = null;   // отказ от обмена историю не трогает
      else { undo = []; tradeSnap = null; }
      if (G.phase === 'over' || undo.length > 30) undo = G.phase === 'over' ? [] : undo.slice(-30);
    }
    save();
    const opts = { rolled: a.type === 'roll' || a.type === 'reroll', turnChanged: G.turn !== before };
    if (netGame()) NET.publish(opts);
    afterChange(opts, a, actorBefore, !!(how && how.remote));
    if (!(how && how.bot)) botTick(a);
    return r;
  }

  function afterChange(opts, a, actorBefore, remote) {
    const sheetOpen = !$('sheet').hidden;
    const kind = $('sheet').dataset.kind || '';
    if (remote) {
      // чужое действие: справку и карточку не трогаем, свои черновики закрываем, если ход ушёл
      if (sheetOpen && (kind === 'trade' || kind === 'loan' || kind === 'menu') && !myMove()) closeSheet();
      render(opts);
      if (sheetOpen && kind.startsWith('cell:') && !$('sheet').hidden && $('sheet').dataset.kind === kind) showCell(Number(kind.slice(5)));
      maybeHandoff();
      return;
    }
    if (sheetOpen && kind.startsWith('cell:') && ['build', 'sell', 'mortgage', 'unmortgage'].includes(a.type) && E.actor(G) === actorBefore) {
      render(opts); showCell(a.cell); return;
    }
    closeSheet();
    render(opts);
    maybeHandoff();
  }

  // Игрок: пришло новое состояние от хоста
  function setState(newG, opts, first) {
    const prevTurn = G ? G.turn : -1;
    G = E.migrate(newG);
    if (first || $('game').hidden) {
      shownCard = G.card ? G.card.seq : 0;
      showGame(true);
      NET.bar();
      return;
    }
    NET.bar();
    afterChange(Object.assign({}, opts, { turnChanged: G.turn !== prevTurn }), {}, -1, true);
  }

  function showQr() {
    NET.refreshIps();
    const url = NET.joinUrl();
    openKind('qr', `<h3>Подключение</h3>
      ${url ? `<div class="qr">${NET.qr()}</div><p class="addr">${esc(url)}</p>` : '<p class="notice bad">Точка доступа не найдена. Проверьте, что она включена.</p>'}
      <p class="sub">Игрок, у которого пропала связь, сканирует этот же код и продолжает со своего места.</p>
      ${btn('Закрыть', 'close', 'ghost')}`);
  }

  function onClick(e) {
    const t = e.target.closest('[data-act],[data-fig]');
    if (!t) return;
    if (t.dataset.fig !== undefined) { readNames(); nextFigure(Number(t.dataset.fig)); renderSetup(); return; }
    const act = t.dataset.act;
    const cell = t.dataset.cell !== undefined ? Number(t.dataset.cell) : undefined;
    const num = k => Number(t.dataset[k]);
    switch (act) {
      case 'close': closeSheet(); return;
      case 'info': showCell(cell); return;
      case 'rules': showRules(); return;
      case 'fxSound': FX.toggle('sound'); showMenu(); return;
      case 'fxVibe': FX.toggle('vibe'); showMenu(); return;
      case 'showQr': showQr(); return;
      case 'botSpeed': botFast = !botFast; store.set('baai.botfast', botFast); showMenu(); return;
      case 'askNew':
        openKind('ask', `<h3>Начать новую партию?</h3><p>${netGame() ? 'Текущая партия будет удалена.' : `Текущая партия останется в сохранённых${curSlot >= 0 && slots()[curSlot] ? ` («${esc(slots()[curSlot].name)}»)` : ''}.`}</p>
          ${btn('Да, новая партия', 'newGame', 'danger')}${btn('Отмена', 'close', 'ghost')}`);
        return;
      case 'newGame':
        clearTimeout(botT);
        if (netGame()) { G = null; closeSheet(); NET.backToLobby(); return; }
        save();
        G = null; curSlot = -1; undo = []; tradeSnap = null; buildMode = false; buildHinted.clear(); hintsSeen.clear(); showSetup(); return;

      // сохранённые партии
      case 'slotLoad': loadSlot(num('k')); return;
      case 'slotNew': startGame(num('k')); return;
      case 'slotRename': {
        const x = slots()[num('k')]; if (!x) return;
        openKind('ask', `<h3>Название партии</h3>
          <input id="slot-name" class="slot-input" type="text" maxlength="24" value="${esc(x.name)}" aria-label="Название партии">
          ${btn('Сохранить', 'slotRenameOk', 'primary', false, `data-k="${num('k')}"`)}${btn('Отмена', 'close', 'ghost')}`);
        return;
      }
      case 'slotRenameOk': {
        const m = slots(), k = num('k'), el = $('slot-name');
        if (m[k] && el) { m[k].name = el.value.trim() || m[k].name; store.set(SLOTS_KEY, m); }
        closeSheet(); renderSetup(); return;
      }
      case 'slotDel': {
        const x = slots()[num('k')]; if (!x) return;
        openKind('ask', `<h3>Удалить «${esc(x.name)}»?</h3><p>Партию нельзя будет продолжить.</p>
          ${btn('Да, удалить', 'slotDelOk', 'danger', false, `data-k="${num('k')}"`)}${btn('Отмена', 'close', 'ghost')}`);
        return;
      }
      case 'slotDelOk': {
        const m = slots(), k = num('k');
        m[k] = null; store.set(SLOTS_KEY, m); store.set(slotKey(k), null);
        closeSheet(); renderSetup(); return;
      }
      case 'undo': doUndo(); return;

      // обмен
      case 'tradeOpen':
        if (!trade || trade.to === G.turn || G.players[trade.to].bankrupt) trade = { to: tradeTargets()[0] };
        trade = { to: trade.to, give: { cells: [], money: 0, cards: 0 }, get: { cells: [], money: 0, cards: 0 } };
        showTrade(); return;
      case 'tTo':
        trade = { to: num('p'), give: { cells: [], money: 0, cards: 0 }, get: { cells: [], money: 0, cards: 0 } };
        showTrade(); return;
      case 'tCell': {
        readTradeMoney();
        const side = trade[t.dataset.side];
        side.cells = side.cells.includes(cell) ? side.cells.filter(x => x !== cell) : side.cells.concat(cell);
        showTrade(); return;
      }
      case 'tCards': readTradeMoney(); trade[t.dataset.side].cards += num('d'); showTrade(); return;
      case 'tSend':
        readTradeMoney();
        send('offerTrade', { to: trade.to, give: trade.give, get: trade.get });
        return;

      // кредит
      case 'loanOpen':
        if (!loan) loan = { from: BANK, amount: RULES.bankLoan.max, rate: 20, laps: 2 };
        if (loan.from !== BANK && (loan.from === G.turn || G.players[loan.from].bankrupt)) loan.from = BANK;
        fixLoanAmount(); showLoan(); return;
      case 'lFrom': loan.from = num('p'); if (loan.from !== BANK) loan.amount = 200; fixLoanAmount(); showLoan(); return;
      case 'lAmt': loan.amount = num('v'); showLoan(); return;
      case 'lStep': loan.amount += num('d') * RULES.loanStep; fixLoanAmount(); showLoan(); return;
      case 'lRate': loan.rate = num('v'); showLoan(); return;
      case 'lLaps': loan.laps = num('v'); showLoan(); return;
      case 'lTake': send('takeLoan', { from: loan.from, amount: loan.amount, rate: loan.rate, laps: loan.laps }); return;
      case 'loanRepay': send('repayLoan'); return;

      case 'buildMode': buildMode = true; buildHinted.add(G.turn); closeSheet(); render({}); return;
      case 'buildDone': buildMode = false; render({}); return;
      case 'buildLater': buildHinted.add(G.turn); render({}); return;
      case 'hintOk': if (hintNow) hintsSeen.add(hintNow); hintNow = null; render({}); return;
      case 'hintOff': setHints(false); hintNow = null; render({}); toast('Подсказки выключены. Включить — в меню.'); return;
      case 'hintsToggle': setHints(!hintsOn); showMenu(); if (G) renderActions(); return;
      case 'bid': send('bid', { amount: num('amount') }); return;
      case 'roleShow': showRole(num('p')); return;
      case 'pickRole': send('pickRole', { role: t.dataset.role }); return;
      case 'pickCard': send('pickCard', { k: num('k') }); return;
      case 'ability': {
        const p = E.actor(G), role = G.players[p].role;
        if (role === 'uus' || role === 'kayur') { showAbilityCells(p); return; }
        openKind('ask', `<p class="sub center">${esc(roleOf(p).name)} · раз за игру</p><h3>${esc(ROLE_BTN[role])}?</h3><p>${esc(roleOf(p).once)}</p>
          ${role === 'bulchut' ? '<p class="sub">Засада тайная: роль раскроется, когда сработает.</p>' : '<p class="sub">После этого ваша роль раскроется всем.</p>'}
          ${btn('Да', 'abilityGo', 'primary big')}${btn('Отмена', 'close', 'ghost')}`);
        return;
      }
      case 'abilityGo': send('ability'); return;
      case 'abilityCell': send('ability', { cell }); return;
      case 'sealedSet': { const el = $('sealed-bid'); if (el) el.value = num('v'); return; }
      case 'sealedBid': { const el = $('sealed-bid'); send('bid', { amount: Math.floor(Number(el && el.value) || 0) }); return; }
      default:
        if (G) send(act, cell !== undefined ? { cell } : undefined);
    }
  }

  // ---------- запуск ----------
  // Заставка: дерево вырастает, потом всё растворяется
  function splash() {
    const el = $('splash'); if (!el) return;
    $('splash-tree').innerHTML = `<svg viewBox="-150 -150 300 300" aria-hidden="true">${T.treeSVG()}</svg>`;
    setTimeout(() => { el.classList.add('gone'); setTimeout(() => el.remove(), 600); }, 1400);
  }

  function boot(hot) {
    splash();
    const saved = store.get(SETUP_KEY);
    if (saved && saved.figures && saved.figures.length === 6) setup = Object.assign(setup, saved);
    setup.bots = Math.max(0, Math.min(5, Number(setup.bots) || 0));
    fixCounts('count');
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]')) { e.preventDefault(); e.target.click(); }
      if (e.key === 'Escape') closeSheet();
    });
    $('sheet-bg').addEventListener('click', () => { if (!sheetIs('handoff')) closeSheet(); });
    $('btn-menu').addEventListener('click', showMenu);
    $('btn-all').addEventListener('click', () => board && board.showAll());
    $('prize').addEventListener('click', () => showCell(20));
    $('rentbar').addEventListener('click', () => { clearTimeout(rentT); $('rentbar').hidden = true; });
    $('btn-start').addEventListener('click', () => startGame());
    migrateSave();
    $('count-seg').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      readNames(); setup.count = Number(b.dataset.n); fixCounts('count'); renderSetup();
    });
    $('bots-seg').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || b.disabled) return;
      readNames(); setup.bots = Number(b.dataset.b); fixCounts('bots'); renderSetup();
    });
    $('hints-seg').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      readNames(); setHints(b.dataset.h === 'true'); renderSetup();
    });
    $('time-seg').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      readNames(); setup.minutes = Number(b.dataset.m); renderSetup();
    });
    $('rules-box').addEventListener('click', e => {
      const b = e.target.closest('[data-rule]'); if (!b) return;
      readNames(); setup.rules = Object.assign(E.normRules(setup.rules), { [b.dataset.rule]: b.dataset.v }); renderSetup();
    });
    setInterval(() => { renderTimer(); if (G) tickLeft(); }, 1000);
    $('btn-net').addEventListener('click', () => { readNames(); NET.openLobby(); });
    $('btn-net-resume').addEventListener('click', () => NET.resume());

    NET.ui = {
      getState: () => G,
      applyAction,
      setState,
      toast,
      showSetup,
      refresh() { if (G && !$('game').hidden) render({}); },
      rulesHTML,
      startNetGame(players, minutes, rules) {
        G = E.create(players, { minutes, rules });
        G.log.push(`— Ход: ${G.players[0].name}`);
        shownCard = 0;
        showGame(true);
        NET.publish({ turnChanged: true });
      },
      resumeNetGame(g) {
        G = g; shownCard = G.card ? G.card.seq : 0;
        showGame(true);
        NET.publish({ turnChanged: true });
      },
      leaveGame() { clearTimeout(botT); G = null; closeSheet(); $('game').hidden = true; },
    };
    if (NET.boot) NET.boot();
    if (NET.isClient()) return;

    if (hot && hot.G) { G = E.migrate(hot.G); curSlot = hot.curSlot ?? -1; shownCard = G.card ? G.card.seq : 0; showGame(true); }
    else renderSetup();
  }

  const h = window.claude && window.claude.hot;
  if (h && h.snapshot) h.snapshot(() => ({ G, curSlot }));
  if (h && h.ready) h.ready(boot); else boot(h && h.data ? h.data : {});
})();
