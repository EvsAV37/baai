/* «Баай» — экран игры на одном телефоне.
   Рисует состояние из движка, отправляет ему действия. Поле рисует board.js.
   Правил здесь нет.
   © 2026 Евсеев А.В. */
(function () {
  'use strict';

  const { BOARD, GROUPS, RULES } = BAAI.data;
  const T = BAAI.theme;
  const E = BAAI.engine;
  const rub = E.rub;
  const $ = id => document.getElementById(id);
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const icon = (name, color, sw) => `<svg viewBox="0 0 24 24" aria-hidden="true">${T.iconSVG(name, color, sw)}</svg>`;
  const token = (p, size) => T.tokenSVG(p.figure, p.color, size || 64).replace('<svg ', '<svg aria-hidden="true" ');

  const SAVE_KEY = 'baai.save.v2';
  const SETUP_KEY = 'baai.setup.v2';
  const DECK_ABOUT = {
    bayanai: 'Колода «Байанай» — дух охоты и удачи. Перемещения, находки и неприятности в дороге.',
    tyusyulge: 'Колода «Тюсюлгэ» — место праздника Ысыах. Деньги, выплаты и события в улусе.',
  };

  let G = null;
  let shownCard = 0;
  let board = null;
  let setup = { count: 3, minutes: 0, names: [], figures: ['horse', 'deer', 'choron', 'khomus', 'bear', 'crane'] };

  // ---------- сохранение ----------
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* без сохранения */ } },
  };
  const save = () => store.set(SAVE_KEY, G);

  // ---------- настройка партии ----------
  function renderSetup() {
    $('setup-medals').innerHTML = T.FIGURES.map((f, i) => T.tokenSVG(f.id, T.PLAYER[i], 34)).join('');
    $('count-seg').innerHTML = [2, 3, 4, 5, 6].map(n =>
      `<button type="button" role="radio" aria-checked="${n === setup.count}" data-n="${n}">${n}</button>`).join('');
    $('time-seg').innerHTML = [[0, 'Нет'], [30, '30 мин'], [60, '60 мин'], [90, '90 мин']].map(([m, t]) =>
      `<button type="button" role="radio" aria-checked="${m === setup.minutes}" data-m="${m}">${t}</button>`).join('');
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
    $('resume-box').hidden = !store.get(SAVE_KEY);
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
    const taken = setup.figures.slice(0, setup.count).filter((_, k) => k !== i);
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

  function startGame() {
    readNames();
    store.set(SETUP_KEY, setup);
    const players = [];
    for (let i = 0; i < setup.count; i++) players.push({ name: setup.names[i] || `Игрок ${i + 1}`, color: T.PLAYER[i], figure: setup.figures[i] });
    G = E.create(players, { minutes: setup.minutes });
    G.log.push(`— Ход: ${G.players[0].name}`);
    shownCard = 0;
    save();
    showGame(true);
  }

  function showGame(fresh) {
    $('setup').hidden = true;
    $('game').hidden = false;
    closeSheet();
    if (!board) board = new BAAI.BoardView($('board'), { onCellTap: showCell });
    else if (fresh) board.reset();
    render({ turnChanged: true });
  }

  function showSetup() {
    $('game').hidden = true;
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
    const pl = G.players[G.turn];
    let msg = '';
    if (G.phase === 'over') msg = 'Партия окончена';
    else if (G.phase === 'buy') msg = `${BOARD[G.pending.cell].name}: можно купить`;
    else if (G.phase === 'debt') msg = `Нужно заплатить ${rub(G.pending.amount)}`;
    else if (G.phase === 'roll' && pl.inJail) msg = 'Пережидает пургу в зимовье';
    else if (G.phase === 'roll' && G.extra) msg = 'Дубль! Бросай ещё раз';
    else if (G.phase === 'roll') msg = 'Бросай кубики';
    else msg = BOARD[pl.pos].name;
    const dice = G.dice ? `<div class="dice" id="dice">${dieHTML(G.dice[0])}${dieHTML(G.dice[1])}</div>` : '';
    return `${token(pl, 40)}<div class="col"><div class="who">${esc(pl.name)}</div><div class="msg">${esc(msg)}</div></div>${dice}`;
  }

  // Кубики катятся: несколько случайных граней, потом выпавшие
  function rollDice(d) {
    const el = $('dice'); if (!el) return;
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

  function renderActions() {
    const pl = G.players[G.turn];
    let h = '';
    if (G.phase === 'over') {
      const w = G.players[G.winner];
      h += `<div class="notice">Победитель: <b>${esc(w.name)}</b>${G.overReason === 'time' ? ` — самый богатый (${rub(E.netWorth(G, G.winner))})` : ''}</div>`;
      h += `<div class="act-row">${btn('Новая партия', 'newGame', 'primary big')}</div>`;
    } else if (G.phase === 'roll' && pl.inJail) {
      h += `<div class="notice">Вы в зимовье, снаружи пурга. Попытка ${pl.jailTries + 1} из ${RULES.maxJailTries}: выбросьте дубль — пурга стихнет. Или вызовите вездеход за ${RULES.jailFine} ₽.</div>`;
      h += `<div class="act-row">${btn('Бросить на дубль', 'roll', 'primary')}${btn(`Вездеход · ${RULES.jailFine} ₽`, 'payJail', '', pl.money < RULES.jailFine)}${pl.freeCards.length ? btn('Попутный вездеход', 'useCard') : ''}</div>`;
    } else if (G.phase === 'roll') {
      h += `<div class="act-row">${btn(G.extra ? 'Бросить ещё раз' : 'Бросить кубики', 'roll', 'primary big')}</div>`;
    } else if (G.phase === 'buy') {
      const c = BOARD[G.pending.cell];
      const short = pl.money < c.price;
      if (short) h += `<div class="notice bad">На ${esc(c.name)} не хватает денег.</div>`;
      h += `<div class="act-row">${btn(`Купить ${rub(c.price)}`, 'buy', 'primary big', short)}${btn('Не покупать', 'decline', 'big')}</div>`;
      h += `<div class="act-row">${btn('Подробнее о клетке', 'info', 'ghost', false, `data-cell="${G.pending.cell}"`)}</div>`;
    } else if (G.phase === 'debt') {
      const d = G.pending;
      const can = pl.money >= d.amount;
      const liquid = E.liquidValue(G, G.turn);
      h += `<div class="notice bad">Нужно заплатить <b>${rub(d.amount)}</b> (${esc(d.reason)}). У вас ${rub(pl.money)}.
        ${!can && liquid >= d.amount ? ' Продайте дома в разделе «Имущество».' : ''}
        ${liquid < d.amount ? ' Даже с продажей домов не хватает.' : ''}</div>`;
      h += `<div class="act-row">${btn('Заплатить', 'payDebt', 'primary', !can)}${btn('Объявить банкротство', 'bankrupt', 'danger', can)}</div>`;
    } else if (G.phase === 'end') {
      h += `<div class="act-row">${btn('Завершить ход', 'endTurn', 'dark big')}</div>`;
    }
    $('actions').innerHTML = h;
  }

  function renderPlayers() {
    $('players').innerHTML = G.players.map((p, i) => {
      const tags = [];
      if (p.bankrupt) tags.push('банкрот');
      else if (p.inJail) tags.push('в зимовье');
      if (p.freeCards.length) tags.push(`вездеход ×${p.freeCards.length}`);
      return `<div class="pl${i === G.turn ? ' cur' : ''}${p.bankrupt ? ' out' : ''}">${token(p, 36)}
        <span class="col"><span class="nm">${esc(p.name)}</span><span class="mn">${p.bankrupt ? '—' : rub(p.money)}</span>${tags.length ? `<span class="tg">${tags.join(', ')}</span>` : ''}</span></div>`;
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

  function renderAssets() {
    const p = G.turn, pl = G.players[p];
    $('assets-title').textContent = `Имущество: ${pl.name}`;
    const mine = Object.keys(G.own).map(Number).filter(i => G.own[i].owner === p).sort((a, b) => a - b);
    if (!mine.length) { $('assets').innerHTML = '<p class="empty-note">Пока ничего нет. Покупайте клетки, на которые встаёте.</p>'; return; }
    const canAct = ['roll', 'end', 'debt'].includes(G.phase);
    $('assets').innerHTML = mine.map(i => {
      const c = BOARD[i], o = G.own[i];
      let sub = '';
      if (c.type === 'prop') {
        const full = E.ownsGroup(G, p, c.group);
        sub = o.houses === 5 ? 'отель' : o.houses ? `домов: ${o.houses}` : (full ? 'вся группа' : 'участок');
        sub += ` · аренда ${rub(E.rentFor(G, i))}`;
      } else if (c.type === 'transport') sub = `аренда ${rub(E.rentFor(G, i))}`;
      else sub = 'аренда по кубикам';
      let btns = '';
      if (c.type === 'prop' && canAct && E.ownsGroup(G, p, c.group)) {
        const b = E.canBuild(G, p, i) && G.phase !== 'debt';
        const s = E.canSell(G, p, i);
        btns = `<button type="button" class="btn sm" data-act="sell" data-cell="${i}" ${s ? '' : 'disabled'} aria-label="Продать дом">−</button>
          <button type="button" class="btn sm" data-act="build" data-cell="${i}" ${b ? '' : 'disabled'} aria-label="Построить за ${GROUPS[c.group].house} ₽">+ ${GROUPS[c.group].house}</button>`;
      }
      return `<div class="asset"><span class="sw" style="--gc:${cellColor(c)}">${icon(cellIcon(i), '#ffffff', 2.4)}</span>
        <span class="info" data-act="info" data-cell="${i}" role="button" tabindex="0"><b>${esc(c.name)}</b><span>${sub}</span></span>${btns}</div>`;
    }).join('');
  }

  function renderLog() {
    $('log').innerHTML = G.log.slice(-30).reverse().map(t => `<li>${esc(t)}</li>`).join('');
  }

  function renderTimer() {
    const el = $('timer');
    if (!G || !G.endsAt || G.phase === 'over') { el.textContent = ''; return; }
    const left = Math.max(0, G.endsAt - Date.now());
    if (!left) { el.textContent = 'Время вышло'; return; }
    const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
    el.textContent = `${m}:${String(s).padStart(2, '0')}`;
  }

  function render(opts) {
    opts = Object.assign({}, opts);
    // новую карточку показываем, когда фишка дошла до клетки
    if (G.card && G.card.seq > shownCard) {
      shownCard = G.card.seq;
      const card = G.card;
      opts.onSettled = () => showCard(card);
    }
    $('status').innerHTML = statusHTML();
    if (opts.rolled && G.dice) rollDice(G.dice);
    if (board) board.update(G, opts);
    else if (opts.onSettled) opts.onSettled();
    renderActions();
    renderPlayers();
    renderAssets();
    renderLog();
    renderTimer();
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

  function showCard(card) {
    const ic = card.deck === 'bayanai' ? icon('bow', T.C.larch, 2.2) : icon('bowl', T.C.coral, 2.2);
    openSheet(`<div class="card-wrap"><div class="card-face ${card.deck}">${ic}
        <div class="deck">${esc(card.title)}</div><p>${esc(card.text)}</p></div></div>
      ${btn('Понятно', 'close', 'primary big')}`);
  }

  function showCell(i) {
    if (!G) return;
    const c = BOARD[i], o = G.own[i];
    const owner = o ? G.players[o.owner].name : 'свободна';
    let h = '';
    const head = (title, sub) => `<div class="cell-head" style="--gc:${cellColor(c)}">${icon(cellIcon(i), '#ffffff', 2.2)}<div><h3>${esc(title)}</h3><p class="sub">${esc(sub)}</p></div></div>`;
    if (c.type === 'prop') {
      const g = GROUPS[c.group];
      const full = o && E.ownsGroup(G, o.owner, c.group);
      const cur = o ? o.houses : -1;
      const rows = [
        ['Участок', c.rent[0], cur === 0 && !full],
        ['Вся группа у владельца', c.rent[0] * 2, cur === 0 && full],
        ['1 дом', c.rent[1], cur === 1], ['2 дома', c.rent[2], cur === 2],
        ['3 дома', c.rent[3], cur === 3], ['4 дома', c.rent[4], cur === 4],
        ['Отель', c.rent[5], cur === 5],
      ];
      h = head(c.name, g.name) + `<table class="rent"><tbody>
          ${rows.map(r => `<tr class="${r[2] ? 'on' : ''}"><td>${r[0]}</td><td>${rub(r[1])}</td></tr>`).join('')}
          <tr><td>Цена участка</td><td>${rub(c.price)}</td></tr>
          <tr><td>Дом или отель</td><td>${rub(g.house)}</td></tr>
          <tr><td>Владелец</td><td>${esc(owner)}</td></tr>
        </tbody></table>`;
      if (o && o.owner === G.turn && E.ownsGroup(G, G.turn, c.group) && ['roll', 'end', 'debt'].includes(G.phase)) {
        h += `<div class="act-row">${btn('Продать дом', 'sell', '', !E.canSell(G, G.turn, i), `data-cell="${i}"`)}${btn(`Построить · ${rub(g.house)}`, 'build', 'primary', !E.canBuild(G, G.turn, i) || G.phase === 'debt', `data-cell="${i}"`)}</div>`;
      }
    } else if (c.type === 'transport') {
      h = head(c.name, 'Транспорт') + `<table class="rent"><tbody>
        ${[1, 2, 3, 4].map(n => `<tr><td>Если у владельца ${n} ${n === 1 ? 'транспорт' : 'транспорта'}</td><td>${rub(RULES.transportRent[n])}</td></tr>`).join('')}
        <tr><td>Цена</td><td>${rub(c.price)}</td></tr><tr><td>Владелец</td><td>${esc(owner)}</td></tr></tbody></table>`;
    } else if (c.type === 'utility') {
      h = head(c.name, 'Коммуналка') + `<table class="rent"><tbody>
        <tr><td>Одна у владельца</td><td>4 × сумма кубиков</td></tr>
        <tr><td>Обе у владельца</td><td>10 × сумма кубиков</td></tr>
        <tr><td>Цена</td><td>${rub(c.price)}</td></tr><tr><td>Владелец</td><td>${esc(owner)}</td></tr></tbody></table>`;
    } else {
      const about = {
        start: `Каждый раз, когда проходишь Старт или встаёшь на него, получаешь ${rub(RULES.passStart)}.`,
        jail: 'Сюда попадают из-за пурги. Выбраться можно дублем (пурга стихла), вызвав вездеход за 50 ₽ или по карте «Попутный вездеход». После третьей попытки вездеход обязателен. Если пришёл сюда обычным ходом, ты просто в гостях.',
        parking: 'Праздник Ысыах. Ничего не происходит, отдыхай.',
        gotojail: 'Пурга! Тебя заметает в пути: отправляйся прямо в зимовьё, Старт не проходишь, 200 ₽ не получаешь.',
        tax: `Заплати банку ${rub(c.amount || 0)}.`,
        bayanai: DECK_ABOUT.bayanai,
        tyusyulge: DECK_ABOUT.tyusyulge,
      }[c.type];
      h = head(c.name, 'Клетка') + `<p>${esc(about)}</p>`;
    }
    h += btn('Закрыть', 'close', 'ghost');
    openSheet(h);
  }

  function showMenu() {
    openSheet(`<h3>Меню</h3>
      ${btn('Правила кратко', 'rules')}
      ${btn('Новая партия', 'askNew')}
      ${btn('Закрыть', 'close', 'ghost')}`);
  }

  function showRules() {
    openSheet(`<h3>Правила кратко</h3>
      <ul class="rules">
        <li>Бросай два кубика и ходи по кругу. Дубль даёт ещё один бросок, три дубля подряд — в пургу и в зимовьё.</li>
        <li>Клетка «Пурга» отправляет в «Зимовьё». Выбраться: дубль, вездеход за 50 ₽ или карта «Попутный вездеход».</li>
        <li>Встал на свободную клетку — можешь купить её.</li>
        <li>На чужой клетке платишь аренду. Если у владельца вся группа, аренда пустого участка удваивается.</li>
        <li>Транспорт: 25, 50, 100 или 200 ₽, смотря сколько их у владельца. Коммуналка: 4× или 10× сумма кубиков.</li>
        <li>Строить можно, когда собрана вся группа. Дома ставятся равномерно, до 4, потом отель. Продать дом можно за полцены.</li>
        <li>Проход через Старт: +200 ₽.</li>
        <li>Не хватает денег — продавай дома. Если и это не помогает, ты банкрот. Побеждает последний оставшийся.</li>
        <li>Поле: нажми на клетку, чтобы узнать о ней. Двумя пальцами — приблизить, кнопка в углу — всё поле.</li>
      </ul>
      ${btn('Закрыть', 'close', 'ghost')}`);
  }

  function showHandoff() {
    const pl = G.players[G.turn];
    openSheet(`<div class="handoff">${token(pl, 96)}<p class="sub">Передайте телефон</p>
      <h3>${esc(pl.name)}</h3><p>${rub(pl.money)}</p></div>
      ${btn('Мой ход', 'close', 'primary big')}`);
  }

  let toastT = 0;
  function toast(t) {
    const el = $('toast');
    el.textContent = t; el.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { el.hidden = true; }, 2500);
  }

  // ---------- действия ----------
  function send(type, cell) {
    const a = { type, player: G.turn };
    if (cell !== undefined) a.cell = cell;
    const before = G.turn;
    const r = E.act(G, a);
    if (!r.ok) { toast(r.error); return; }
    save();
    const sheetOpen = !$('sheet').hidden;
    const opts = { rolled: type === 'roll', turnChanged: G.turn !== before };
    if (sheetOpen && (type === 'build' || type === 'sell')) { render(opts); showCell(cell); return; }
    closeSheet();
    render(opts);
    if (opts.turnChanged && G.phase !== 'over') showHandoff();
  }

  function onClick(e) {
    const t = e.target.closest('[data-act],[data-fig]');
    if (!t) return;
    if (t.dataset.fig !== undefined) { readNames(); nextFigure(Number(t.dataset.fig)); renderSetup(); return; }
    const act = t.dataset.act;
    const cell = t.dataset.cell !== undefined ? Number(t.dataset.cell) : undefined;
    switch (act) {
      case 'close': closeSheet(); return;
      case 'info': showCell(cell); return;
      case 'rules': showRules(); return;
      case 'askNew':
        openSheet(`<h3>Начать новую партию?</h3><p>Текущая партия будет удалена.</p>
          ${btn('Да, новая партия', 'newGame', 'danger')}${btn('Отмена', 'close', 'ghost')}`);
        return;
      case 'newGame': G = null; save(); showSetup(); return;
      default: if (G) send(act, cell);
    }
  }

  // ---------- запуск ----------
  function boot(hot) {
    const saved = store.get(SETUP_KEY);
    if (saved && saved.figures && saved.figures.length === 6) setup = Object.assign(setup, saved);
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]')) { e.preventDefault(); e.target.click(); }
      if (e.key === 'Escape') closeSheet();
    });
    $('sheet-bg').addEventListener('click', closeSheet);
    $('btn-menu').addEventListener('click', showMenu);
    $('btn-all').addEventListener('click', () => board && board.showAll());
    $('btn-start').addEventListener('click', startGame);
    $('btn-resume').addEventListener('click', () => { G = store.get(SAVE_KEY); if (G) { shownCard = G.card ? G.card.seq : 0; showGame(true); } });
    $('count-seg').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      readNames(); setup.count = Number(b.dataset.n); renderSetup();
    });
    $('time-seg').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      readNames(); setup.minutes = Number(b.dataset.m); renderSetup();
    });
    setInterval(renderTimer, 1000);

    if (hot && hot.G) { G = hot.G; shownCard = G.card ? G.card.seq : 0; showGame(true); }
    else renderSetup();
  }

  const h = window.claude && window.claude.hot;
  if (h && h.snapshot) h.snapshot(() => ({ G }));
  if (h && h.ready) h.ready(boot); else boot(h && h.data ? h.data : {});
})();
