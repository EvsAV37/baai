/* «Баай» — экран игры на одном телефоне.
   Рисует состояние из движка и отправляет ему действия. Правил здесь нет.
   © 2026 Евсеев А.В. */
(function () {
  'use strict';

  const { BOARD, GROUPS, RULES, COLORS } = BAAI.data;
  const E = BAAI.engine;
  const rub = E.rub;
  const $ = id => document.getElementById(id);
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const SAVE_KEY = 'baai.save.v1';
  const NAMES_KEY = 'baai.names.v1';
  const DECK_COLOR = { bayanai: '#2f7d5b', tyusyulge: '#b4562a' };
  const DECK_ABOUT = {
    bayanai: 'Колода «Байанай» — дух охоты и удачи. Перемещения, находки и неприятности в дороге.',
    tyusyulge: 'Колода «Тюсюлгэ» — место праздника Ысыах. Деньги, выплаты и события в улусе.',
  };

  let G = null;               // текущая партия
  let shownCard = 0;          // seq последней показанной карточки
  let setup = { count: 3, minutes: 0, names: [] };

  // ---------- сохранение ----------
  function save() {
    try { if (G) localStorage.setItem(SAVE_KEY, JSON.stringify(G)); else localStorage.removeItem(SAVE_KEY); } catch (e) { /* без сохранения */ }
  }
  function loadSaved() {
    try { const t = localStorage.getItem(SAVE_KEY); return t ? JSON.parse(t) : null; } catch (e) { return null; }
  }
  function loadNames() {
    try { return JSON.parse(localStorage.getItem(NAMES_KEY)) || []; } catch (e) { return []; }
  }
  function saveNames() {
    try { localStorage.setItem(NAMES_KEY, JSON.stringify(setup.names)); } catch (e) { /* ничего */ }
  }

  // ---------- экран настройки ----------
  function renderSetup() {
    $('count-seg').innerHTML = [2, 3, 4, 5, 6].map(n =>
      `<button type="button" role="radio" aria-checked="${n === setup.count}" data-n="${n}">${n}</button>`).join('');
    $('time-seg').innerHTML = [[0, 'Без лимита'], [30, '30 мин'], [60, '60 мин'], [90, '90 мин']].map(([m, t]) =>
      `<button type="button" role="radio" aria-checked="${m === setup.minutes}" data-m="${m}">${t}</button>`).join('');
    let html = '';
    for (let i = 0; i < setup.count; i++) {
      const v = setup.names[i] || `Игрок ${i + 1}`;
      html += `<label class="name-row"><span class="chip" style="background:${COLORS[i]}"></span>
        <input id="name-${i}" type="text" maxlength="14" value="${esc(v)}" aria-label="Имя игрока ${i + 1}"></label>`;
    }
    $('names').innerHTML = html;
    $('resume-box').hidden = !loadSaved();
  }

  function readNames() {
    for (let i = 0; i < setup.count; i++) {
      const el = $('name-' + i);
      if (el) setup.names[i] = el.value.trim() || `Игрок ${i + 1}`;
    }
  }

  function startGame() {
    readNames(); saveNames();
    const players = [];
    for (let i = 0; i < setup.count; i++) players.push({ name: setup.names[i] || `Игрок ${i + 1}`, color: COLORS[i] });
    G = E.create(players, { minutes: setup.minutes });
    G.log.push(`— Ход: ${G.players[0].name}`);
    shownCard = 0;
    save();
    showGame();
  }

  function showGame() {
    $('setup').hidden = true;
    $('game').hidden = false;
    closeSheet();
    render();
  }

  function showSetup() {
    $('game').hidden = true;
    $('setup').hidden = false;
    closeSheet();
    renderSetup();
  }

  // ---------- поле ----------
  function gridPos(i) {
    if (i <= 10) return [11, 11 - i];
    if (i < 20) return [21 - i, 1];
    if (i <= 30) return [1, i - 19];
    return [i - 29, 11];
  }
  function side(i) {
    if (i % 10 === 0) return 'corner';
    if (i < 10) return 'side-b';
    if (i < 20) return 'side-l';
    if (i < 30) return 'side-t';
    return 'side-r';
  }

  function cellHTML(i) {
    const c = BOARD[i], o = G.own[i];
    const sd = side(i);
    const cls = ['cell', sd === 'corner' ? 'corner' : sd];
    if (c.type === 'bayanai' || c.type === 'tyusyulge') cls.push('deck');
    let style = '';
    let inner = '';
    if (o) { cls.push('owned'); style += `--oc:${G.players[o.owner].color};`; }

    if (c.type === 'prop') {
      style += `--gc:${GROUPS[c.group].color};`;
      let marks = '';
      if (o && o.houses === 5) marks = '<span class="hotel"></span>';
      else if (o) marks = '<span class="house"></span>'.repeat(o.houses);
      inner = `<span class="bar">${marks}</span><span class="nm">${esc(c.short)}</span>`;
      if (!o) inner += `<span class="pr">${c.price}</span>`;
    } else if (c.type === 'transport' || c.type === 'utility') {
      inner = `<span class="ic" aria-hidden="true">${c.icon}</span><span class="nm">${esc(c.short)}</span>`;
      if (!o) inner += `<span class="pr">${c.price}</span>`;
    } else {
      inner = `<span class="ic" aria-hidden="true">${c.icon}</span><span class="nm">${esc(c.short)}</span>`;
    }

    const toks = G.players.map((p, k) => (!p.bankrupt && p.pos === i)
      ? `<span class="token${k === G.turn ? ' active' : ''}" style="--tc:${p.color}" title="${esc(p.name)}"></span>` : '').join('');
    if (toks) inner += `<span class="tokens">${toks}</span>`;

    const [r, col] = gridPos(i);
    return `<div class="${cls.join(' ')}" style="grid-area:${r}/${col};${style}" data-cell="${i}" role="button" tabindex="0" aria-label="${esc(c.name)}">${inner}</div>`;
  }

  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  function dieHTML(n) {
    if (!n) return '<div class="die empty"></div>';
    let h = '';
    for (let k = 0; k < 9; k++) h += PIPS[n].includes(k) ? '<i></i>' : '<span></span>';
    return `<div class="die" aria-label="${n}">${h}</div>`;
  }

  function centerMsg() {
    const pl = G.players[G.turn];
    if (G.phase === 'over') return 'Партия окончена';
    if (G.phase === 'buy') return `${BOARD[G.pending.cell].name}: можно купить`;
    if (G.phase === 'debt') return `Нужно заплатить ${rub(G.pending.amount)}`;
    if (G.phase === 'roll' && pl.inJail) return 'В изоляторе';
    if (G.phase === 'roll' && G.extra) return 'Дубль! Бросай ещё раз';
    if (G.phase === 'roll') return 'Бросай кубики';
    const last = G.log[G.log.length - 1] || '';
    return last;
  }

  let lastDiceSeq = -1;
  function renderBoard() {
    let html = '';
    for (let i = 0; i < 40; i++) html += cellHTML(i);
    const pl = G.players[G.turn];
    const d = G.dice || [0, 0];
    html += `<div class="center">
      <div class="logo">Баай</div>
      <div class="dice${G.dice && G.seq !== lastDiceSeq && G.lastRollSeq === G.seq ? ' roll' : ''}">${dieHTML(d[0])}${dieHTML(d[1])}</div>
      <div class="who"><span class="chip" style="background:${pl.color}"></span>${esc(pl.name)}</div>
      <div class="msg">${esc(centerMsg())}</div>
    </div>`;
    $('board').innerHTML = html;
    lastDiceSeq = G.seq;
  }

  // ---------- панель действий ----------
  function btn(label, action, cls = '', disabled = false, extra = '') {
    return `<button type="button" class="btn ${cls}" data-act="${action}" ${extra} ${disabled ? 'disabled' : ''}>${label}</button>`;
  }

  function renderActions() {
    const pl = G.players[G.turn];
    let h = `<div class="turn-head"><span class="chip" style="background:${pl.color}"></span>${esc(pl.name)}<span class="money">${rub(pl.money)}</span></div>`;

    if (G.phase === 'over') {
      const w = G.players[G.winner];
      h += `<div class="notice">🏆 Победитель: <b>${esc(w.name)}</b>${G.overReason === 'time' ? ` — самый богатый (${rub(E.netWorth(G, G.winner))})` : ''}</div>`;
      h += `<div class="act-row">${btn('Новая партия', 'newGame', 'primary')}</div>`;
    } else if (G.phase === 'roll' && pl.inJail) {
      h += `<div class="notice">Вы в изоляторе. Попытка ${pl.jailTries + 1} из ${RULES.maxJailTries}: выбросьте дубль, заплатите ${RULES.jailFine} ₽ или отдайте карту.</div>`;
      h += `<div class="act-row">${btn('Бросить на дубль', 'roll', 'primary')}${btn(`Заплатить ${RULES.jailFine} ₽`, 'payJail', '', pl.money < RULES.jailFine)}${pl.freeCards.length ? btn('Карта освобождения', 'useCard') : ''}</div>`;
    } else if (G.phase === 'roll') {
      h += `<div class="act-row">${btn(G.extra ? 'Бросить ещё раз' : 'Бросить кубики', 'roll', 'primary big')}</div>`;
    } else if (G.phase === 'buy') {
      const c = BOARD[G.pending.cell];
      const short = pl.money < c.price;
      h += `<div class="notice${short ? ' bad' : ''}"><b>${esc(c.name)}</b> свободен. Цена ${rub(c.price)}.${short ? ' Денег не хватает.' : ''}</div>`;
      h += `<div class="act-row">${btn(`Купить за ${rub(c.price)}`, 'buy', 'primary', short)}${btn('Не покупать', 'decline')}${btn('Подробнее', 'info', 'ghost', false, `data-cell="${G.pending.cell}"`)}</div>`;
    } else if (G.phase === 'debt') {
      const d = G.pending;
      const can = pl.money >= d.amount;
      const liquid = E.liquidValue(G, G.turn);
      h += `<div class="notice bad">Нужно заплатить <b>${rub(d.amount)}</b> (${esc(d.reason)}). У вас ${rub(pl.money)}.
        ${!can && liquid >= d.amount ? ' Продайте дома в разделе «Имущество».' : ''}
        ${liquid < d.amount ? ' Даже с продажей домов не хватает.' : ''}</div>`;
      h += `<div class="act-row">${btn('Заплатить', 'payDebt', 'primary', !can)}${btn('Объявить банкротство', 'bankrupt', 'danger', can)}</div>`;
    } else if (G.phase === 'end') {
      h += `<div class="act-row">${btn('Завершить ход', 'endTurn', 'primary big')}</div>`;
    }
    $('actions').innerHTML = h;
  }

  function renderPlayers() {
    $('players').innerHTML = G.players.map((p, i) => {
      const tags = [];
      if (p.bankrupt) tags.push('банкрот');
      if (p.inJail) tags.push('в изоляторе');
      if (p.freeCards.length) tags.push(`выход из изолятора ×${p.freeCards.length}`);
      return `<div class="pl${i === G.turn ? ' cur' : ''}${p.bankrupt ? ' out' : ''}">
        <span class="chip" style="background:${p.color}"></span>
        <span class="col"><span class="nm">${esc(p.name)}</span>${tags.length ? `<span class="tags">${tags.join(', ')}</span>` : ''}</span>
        <span class="mn">${p.bankrupt ? '—' : rub(p.money)}</span>
      </div>`;
    }).join('');
  }

  function renderAssets() {
    const p = G.turn, pl = G.players[p];
    $('assets-title').textContent = `Имущество: ${pl.name}`;
    const mine = Object.keys(G.own).map(Number).filter(i => G.own[i].owner === p).sort((a, b) => a - b);
    if (!mine.length) { $('assets').innerHTML = '<p class="empty-note">Пока ничего нет.</p>'; return; }
    const canAct = ['roll', 'end', 'debt'].includes(G.phase);
    $('assets').innerHTML = mine.map(i => {
      const c = BOARD[i], o = G.own[i];
      const gc = c.type === 'prop' ? GROUPS[c.group].color : 'var(--frost)';
      let sub = '';
      if (c.type === 'prop') {
        const full = E.ownsGroup(G, p, c.group);
        sub = o.houses === 5 ? 'отель' : o.houses ? `домов: ${o.houses}` : (full ? 'вся группа' : 'участок');
        sub += ` · аренда ${rub(E.rentFor(G, i))}`;
      } else if (c.type === 'transport') sub = `аренда ${rub(E.rentFor(G, i))}`;
      else sub = 'аренда по кубикам';
      let btns = '';
      if (c.type === 'prop' && canAct) {
        const b = E.canBuild(G, p, i) && G.phase !== 'debt';
        const s = E.canSell(G, p, i);
        if (E.ownsGroup(G, p, c.group)) {
          btns = `<button type="button" class="btn sm" data-act="sell" data-cell="${i}" ${s ? '' : 'disabled'} aria-label="Продать дом">−</button>
            <button type="button" class="btn sm" data-act="build" data-cell="${i}" ${b ? '' : 'disabled'} aria-label="Построить: ${GROUPS[c.group].house} ₽">+${GROUPS[c.group].house}</button>`;
        }
      }
      return `<div class="asset" style="--gc:${gc}"><span class="sw"></span>
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
    if (!left) { el.textContent = 'Время вышло: последний ход'; return; }
    const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
    el.textContent = `⏱ ${m}:${String(s).padStart(2, '0')}`;
  }

  function render() {
    renderBoard();
    renderActions();
    renderPlayers();
    renderAssets();
    renderLog();
    renderTimer();
    if (G.card && G.card.seq > shownCard) {
      shownCard = G.card.seq;
      showCard(G.card);
    }
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
    openSheet(`<div class="card-face" style="--gc:${DECK_COLOR[card.deck]}">
        <div class="deck">${esc(card.title)}</div><p>${esc(card.text)}</p></div>
      ${btn('Понятно', 'close', 'primary')}`);
  }

  function showCell(i) {
    const c = BOARD[i], o = G.own[i];
    const owner = o ? G.players[o.owner].name : 'свободна';
    let h = '';
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
      h = `<div class="band" style="--gc:${g.color}"></div><h3>${esc(c.name)}</h3><p class="sub">${esc(g.name)}</p>
        <table class="rent"><tbody>
          ${rows.map(r => `<tr class="${r[2] ? 'on' : ''}"><td>${r[0]}</td><td>${rub(r[1])}</td></tr>`).join('')}
          <tr><td>Цена участка</td><td>${rub(c.price)}</td></tr>
          <tr><td>Дом или отель</td><td>${rub(g.house)}</td></tr>
          <tr><td>Владелец</td><td>${esc(owner)}</td></tr>
        </tbody></table>`;
      if (o && o.owner === G.turn && E.ownsGroup(G, G.turn, c.group) && ['roll', 'end', 'debt'].includes(G.phase)) {
        h += `<div class="act-row">${btn('Продать дом', 'sell', '', !E.canSell(G, G.turn, i), `data-cell="${i}"`)}${btn(`Построить за ${rub(g.house)}`, 'build', 'primary', !E.canBuild(G, G.turn, i) || G.phase === 'debt', `data-cell="${i}"`)}</div>`;
      }
    } else if (c.type === 'transport') {
      h = `<h3>${c.icon} ${esc(c.name)}</h3><p class="sub">Транспорт</p><table class="rent"><tbody>
        ${[1, 2, 3, 4].map(n => `<tr><td>Если у владельца ${n} ${n === 1 ? 'транспорт' : 'транспорта'}</td><td>${rub(RULES.transportRent[n])}</td></tr>`).join('')}
        <tr><td>Цена</td><td>${rub(c.price)}</td></tr><tr><td>Владелец</td><td>${esc(owner)}</td></tr></tbody></table>`;
    } else if (c.type === 'utility') {
      h = `<h3>${c.icon} ${esc(c.name)}</h3><p class="sub">Коммуналка</p><table class="rent"><tbody>
        <tr><td>Одна у владельца</td><td>4 × сумма кубиков</td></tr>
        <tr><td>Обе у владельца</td><td>10 × сумма кубиков</td></tr>
        <tr><td>Цена</td><td>${rub(c.price)}</td></tr><tr><td>Владелец</td><td>${esc(owner)}</td></tr></tbody></table>`;
    } else {
      const about = {
        start: `Каждый раз, когда проходишь Старт или встаёшь на него, получаешь ${rub(RULES.passStart)}.`,
        jail: 'Если попал сюда просто ходом, ты в гостях. Из изолятора выходят дублем, за 50 ₽ или по карте освобождения.',
        parking: 'Праздник Ысыах. Ничего не происходит, отдыхай.',
        gotojail: 'Застрял на зимнике: отправляйся прямо в изолятор, Старт не проходишь.',
        tax: `Заплати банку ${rub(c.amount || 0)}.`,
        bayanai: DECK_ABOUT.bayanai,
        tyusyulge: DECK_ABOUT.tyusyulge,
      }[c.type];
      h = `<h3>${c.icon} ${esc(c.name)}</h3><p>${esc(about)}</p>`;
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
        <li>Бросай два кубика и ходи. Дубль даёт ещё один бросок, три дубля подряд ведут в изолятор.</li>
        <li>Встал на свободный участок — можешь купить его.</li>
        <li>На чужом участке платишь аренду. Если у владельца вся группа, аренда пустого участка удваивается.</li>
        <li>Транспорт: 25, 50, 100 или 200 ₽, смотря сколько их у владельца. Коммуналка: 4× или 10× сумма кубиков.</li>
        <li>Строить можно, когда собрана вся группа. Дома ставятся равномерно, до 4, потом отель. Продать дом можно за полцены.</li>
        <li>Проход через Старт: +200 ₽.</li>
        <li>Не хватает денег — продавай дома. Если и это не помогает, ты банкрот. Побеждает последний оставшийся.</li>
        <li>Аукционы, залог и обмен появятся в следующей версии.</li>
      </ul>
      ${btn('Закрыть', 'close', 'ghost')}`);
  }

  function showHandoff() {
    const pl = G.players[G.turn];
    openSheet(`<div class="winner"><p class="sub">Передайте телефон</p>
      <h3 style="color:${pl.color}">${esc(pl.name)}</h3><p>${rub(pl.money)}</p></div>
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
    if (type === 'roll') G.lastRollSeq = G.seq;
    save();
    const sheetWasOpen = !$('sheet').hidden;
    if (sheetWasOpen && (type === 'build' || type === 'sell')) {
      // обновить открытую карточку клетки
      render();
      if (!$('sheet').hidden || sheetWasOpen) showCell(cell);
      return;
    }
    closeSheet();
    render();
    if (G.turn !== before && G.phase !== 'over' && $('sheet').hidden) showHandoff();
  }

  function onClick(e) {
    const t = e.target.closest('[data-act],[data-cell]');
    if (!t) return;
    const act = t.dataset.act;
    const cell = t.dataset.cell !== undefined ? Number(t.dataset.cell) : undefined;
    if (!act && cell !== undefined) { showCell(cell); return; }
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
    setup.names = loadNames();
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]')) { e.preventDefault(); e.target.click(); }
      if (e.key === 'Escape') closeSheet();
    });
    $('sheet-bg').addEventListener('click', closeSheet);
    $('btn-menu').addEventListener('click', showMenu);
    $('btn-start').addEventListener('click', startGame);
    $('btn-resume').addEventListener('click', () => { G = loadSaved(); if (G) { shownCard = G.card ? G.card.seq : 0; showGame(); } });
    $('count-seg').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      readNames(); setup.count = Number(b.dataset.n); renderSetup();
    });
    $('time-seg').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      readNames(); setup.minutes = Number(b.dataset.m); renderSetup();
    });
    setInterval(renderTimer, 1000);

    if (hot && hot.G) { G = hot.G; shownCard = G.card ? G.card.seq : 0; showGame(); }
    else renderSetup();
  }

  const h = window.claude && window.claude.hot;
  if (h && h.snapshot) h.snapshot(() => ({ G }));
  if (h && h.ready) h.ready(boot); else boot(h && h.data ? h.data : {});
})();
