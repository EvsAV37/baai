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
  const BANK = E.BANK;
  const $ = id => document.getElementById(id);
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const icon = (name, color, sw) => `<svg viewBox="0 0 24 24" aria-hidden="true">${T.iconSVG(name, color, sw)}</svg>`;
  const token = (p, size) => T.tokenSVG(p.figure, p.color, size || 64).replace('<svg ', '<svg aria-hidden="true" ');
  const laps = n => `${n} ${n === 1 ? 'круг' : n < 5 ? 'круга' : 'кругов'}`;

  const NET = BAAI.net || { inGame: false, isClient: () => false, isHost: () => false, canHost: false, hasSave: () => false };
  const netGame = () => NET.inGame;
  // Чей это телефон: в сетевой игре — свой игрок, на одном телефоне — тот, чей ход
  const me = () => netGame() ? NET.me : G.turn;
  // Действует ли сейчас владелец этого телефона
  const myMove = () => !netGame() || E.actor(G) === NET.me;
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
  let trade = null;   // черновик обмена
  let loan = null;    // черновик кредита

  // ---------- сохранение ----------
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* без сохранения */ } },
  };
  const save = () => { if (!netGame()) store.set(SAVE_KEY, G); };

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
    $('net-box').hidden = !NET.canHost;
    $('btn-net-resume').hidden = !NET.hasSave();
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
    $('lobby').hidden = true;
    $('game').hidden = false;
    closeSheet();
    if (!board) board = new BAAI.BoardView($('board'), { onCellTap: showCell });
    else if (fresh) board.reset();
    render({ turnChanged: true });
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
    else if (G.phase === 'roll' && pl.inJail) msg = 'Пережидает пургу в зимовье';
    else if (G.phase === 'roll' && G.extra) msg = 'Дубль! Бросай ещё раз';
    else if (G.phase === 'roll') msg = 'Бросай кубики';
    else msg = BOARD[pl.pos].name;
    const dice = G.dice && G.phase !== 'auction' && G.phase !== 'offer' ? `<div class="dice" id="dice">${dieHTML(G.dice[0])}${dieHTML(G.dice[1])}</div>` : '';
    const you = netGame() && who === NET.me ? ' <em class="you">ваш ход</em>' : '';
    return `${token(pl, 40)}<div class="col"><div class="who">${esc(pl.name)}${you}</div><div class="msg">${esc(msg)}</div></div>${dice}`;
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

  // Кнопки «Обмен» и «Кредит» — доступны в спокойные моменты своего хода
  function sideRow(pl) {
    const canTrade = G.phase === 'roll' || G.phase === 'end';
    const canLoan = ['roll', 'end', 'debt', 'buy'].includes(G.phase);
    const parts = [];
    if (canTrade) parts.push(btn(`${icon('swap', 'currentColor', 2.2)}Обмен`, 'tradeOpen', 'sm ic'));
    if (canLoan) parts.push(btn(`${icon('card', 'currentColor', 2.2)}${pl.loan ? 'Кредит · ' + rub(pl.loan.owe) : 'Кредит'}`, 'loanOpen', 'sm ic'));
    return parts.length ? `<div class="act-row side">${parts.join('')}</div>` : '';
  }

  function leftHTML() {
    return netGame() && NET.deadline ? '<p class="sub left" id="t-left"></p>' : '';
  }

  function auctionHTML(watch) {
    const A = G.auction, c = BOARD[A.cell], pl = G.players[A.at];
    const min = E.minBid(G);
    const steps = A.leader === null ? [0, 50, 100] : [0, 40, 90];
    const lead = A.leader === null
      ? `Торги открываются с <b>${rub(A.start)}</b> (половина цены ${rub(c.price)}).`
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
    if (G.phase === 'offer') {
      const o = G.offer;
      return `<div class="notice">${esc(pl.name)} ${o.kind === 'trade' ? `решает, меняться ли с игроком ${esc(G.players[o.from].name)}` : `решает, дать ли в долг игроку ${esc(G.players[o.from].name)}`}.${leftHTML()}</div>`;
    }
    const off = NET.online && !NET.online[who] ? ' Игрок сейчас без связи — ждём, пока переподключится.' : '';
    const out = G.players[NET.me] && G.players[NET.me].bankrupt ? '<p class="sub">Вы выбыли из игры, но можете смотреть до конца.</p>' : '';
    return `<div class="notice wait">Ходит <b>${esc(pl.name)}</b>.${off}</div>${out}`;
  }

  function renderActions() {
    const pl = G.players[G.turn];
    let h = '';
    if (G.phase !== 'over' && !myMove()) {
      $('actions').innerHTML = waitHTML();
      tickLeft();
      return;
    }
    if (G.phase === 'over') {
      const w = G.players[G.winner];
      h += `<div class="notice">Победитель: <b>${esc(w.name)}</b>${G.overReason === 'time' ? ` — самый богатый (${rub(E.netWorth(G, G.winner))})` : ''}</div>`;
      if (NET.isClient()) h += '<p class="sub center">Новую партию начнёт хост.</p>';
      else h += `<div class="act-row">${btn('Новая партия', 'newGame', 'primary big')}</div>`;
    } else if (G.phase === 'auction') {
      h += auctionHTML();
    } else if (G.phase === 'offer') {
      h += offerHTML();
    } else if (pl.bankrupt) {
      h += `<div class="act-row">${btn('Завершить ход', 'endTurn', 'dark big')}</div>`;
    } else if (G.phase === 'roll' && pl.inJail) {
      h += `<div class="notice">Вы в зимовье, снаружи пурга. Попытка ${pl.jailTries + 1} из ${RULES.maxJailTries}: выбросьте дубль — пурга стихнет. Или вызовите вездеход за ${RULES.jailFine} ₽.</div>`;
      h += `<div class="act-row">${btn('Бросить на дубль', 'roll', 'primary')}${btn(`Вездеход · ${RULES.jailFine} ₽`, 'payJail', '', pl.money < RULES.jailFine)}${pl.freeCards.length ? btn('Попутный вездеход', 'useCard') : ''}</div>`;
    } else if (G.phase === 'roll') {
      h += `<div class="act-row">${btn(G.extra ? 'Бросить ещё раз' : 'Бросить кубики', 'roll', 'primary big')}</div>`;
    } else if (G.phase === 'buy') {
      const c = BOARD[G.pending.cell];
      const short = pl.money < c.price;
      if (short) h += `<div class="notice bad">На ${esc(c.name)} не хватает денег. Можно заложить клетку или взять кредит. Если не купите, клетка уйдёт на аукцион.</div>`;
      h += `<div class="act-row">${btn(`Купить ${rub(c.price)}`, 'buy', 'primary big', short)}${btn('На аукцион', 'decline', 'big')}</div>`;
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
    if (G.phase !== 'over' && !pl.bankrupt && G.phase !== 'auction' && G.phase !== 'offer') h += sideRow(pl);
    $('actions').innerHTML = h;
    tickLeft();
  }

  // Сколько секунд осталось на ставку или ответ
  function tickLeft() {
    const el = $('t-left');
    if (!el) return;
    const s = Math.max(0, Math.ceil((NET.deadline - Date.now()) / 1000));
    el.textContent = G.phase === 'auction' ? `На ставку: ${s} с, потом «Пас»` : `На ответ: ${s} с`;
  }

  function renderPlayers() {
    $('players').innerHTML = G.players.map((p, i) => {
      const tags = [];
      if (p.bankrupt) tags.push('банкрот');
      else if (p.inJail) tags.push('в зимовье');
      if (p.loan) tags.push(`долг ${rub(p.loan.owe)}`);
      if (p.freeCards.length) tags.push(`вездеход ×${p.freeCards.length}`);
      if (netGame() && i === NET.me) tags.unshift('вы');
      if (netGame() && NET.online && !NET.online[i] && !p.bankrupt) tags.push('нет связи');
      return `<div class="pl${i === E.actor(G) ? ' cur' : ''}${p.bankrupt ? ' out' : ''}">${token(p, 36)}
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

  function loanLine(L) {
    const from = L.from === BANK ? 'банку' : G.players[L.from].name;
    return `Вернуть ${rub(L.owe)} → ${esc(from)}, ${L.laps > 0 ? 'через ' + laps(L.laps) : 'сейчас'}`;
  }

  function renderAssets() {
    const p = me(), pl = G.players[p];
    $('assets-title').textContent = netGame() ? 'Ваше имущество' : `Имущество: ${pl.name}`;
    const mine = Object.keys(G.own).map(Number).filter(i => G.own[i].owner === p).sort((a, b) => a - b);
    let h = '';
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
          btns = `<button type="button" class="btn sm" data-act="sell" data-cell="${i}" ${E.canSell(G, p, i) ? '' : 'disabled'} aria-label="Продать дом">−</button>
            <button type="button" class="btn sm" data-act="build" data-cell="${i}" ${E.canBuild(G, p, i) && calm ? '' : 'disabled'} aria-label="Построить за ${GROUPS[c.group].house} ₽">+ ${GROUPS[c.group].house}</button>`;
        } else if (o.mortgaged) {
          if (calm) btns = `<button type="button" class="btn sm" data-act="unmortgage" data-cell="${i}" ${E.canUnmortgage(G, p, i) ? '' : 'disabled'}>Выкуп</button>`;
        } else {
          if (calm && E.canBuild(G, p, i)) btns += `<button type="button" class="btn sm" data-act="build" data-cell="${i}" aria-label="Построить за ${GROUPS[c.group].house} ₽">+ ${GROUPS[c.group].house}</button>`;
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
    if (!G || !G.endsAt || G.phase === 'over') { el.textContent = ''; return; }
    const left = Math.max(0, G.endsAt - Date.now() - (netGame() && NET.isClient() ? NET.skew : 0));
    if (!left) { el.textContent = 'Время вышло'; return; }
    const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
    el.textContent = `${m}:${String(s).padStart(2, '0')}`;
  }

  function renderPrize() {
    const el = $('prize');
    el.hidden = !G || !G.prize;
    if (G && G.prize) el.innerHTML = `<span>Приз Ысыаха</span><b>${rub(G.prize)}</b>`;
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
    renderPrize();
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
    const ic = card.deck === 'bayanai' ? icon('bow', T.C.larch, 2.2) : icon('bowl', T.C.coral, 2.2);
    openKind('card', `<div class="card-wrap"><div class="card-face ${card.deck}">${ic}
        <div class="deck">${esc(card.title)}</div><p>${esc(card.text)}</p></div></div>
      ${btn('Понятно', 'close', 'primary big')}`);
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
          ${mortRows}${ownerRow}
        </tbody></table>`;
      if (o && o.owner === G.turn && myMove() && E.ownsGroup(G, G.turn, c.group) && !o.mortgaged && ['roll', 'end', 'debt', 'buy'].includes(G.phase)) {
        h += `<div class="act-row">${btn('Продать дом', 'sell', '', !E.canSell(G, G.turn, i), `data-cell="${i}"`)}${btn(`Построить · ${rub(g.house)}`, 'build', 'primary', !E.canBuild(G, G.turn, i) || !['roll', 'end'].includes(G.phase), `data-cell="${i}"`)}</div>`;
      }
    } else if (c.type === 'transport') {
      h = head(c.name, 'Транспорт') + `<table class="rent"><tbody>
        ${[1, 2, 3, 4].map(n => `<tr><td>Если у владельца ${n} ${n === 1 ? 'транспорт' : 'транспорта'}</td><td>${rub(RULES.transportRent[n])}</td></tr>`).join('')}
        <tr><td>Цена</td><td>${rub(c.price)}</td></tr>${mortRows}${ownerRow}</tbody></table>`;
    } else if (c.type === 'utility') {
      h = head(c.name, 'Коммуналка') + `<table class="rent"><tbody>
        <tr><td>Одна у владельца</td><td>4 × сумма кубиков</td></tr>
        <tr><td>Обе у владельца</td><td>10 × сумма кубиков</td></tr>
        <tr><td>Цена</td><td>${rub(c.price)}</td></tr>${mortRows}${ownerRow}</tbody></table>`;
    } else {
      const about = {
        start: `Каждый раз, когда проходишь Старт или встаёшь на него, получаешь ${rub(RULES.passStart)}.`,
        jail: 'Сюда попадают из-за пурги. Выбраться можно дублем (пурга стихла), вызвав вездеход за 50 ₽ или по карте «Попутный вездеход». После третьей попытки вездеход обязателен. Если пришёл сюда обычным ходом, ты просто в гостях.',
        parking: `Праздник Ысыах. В Приз Ысыаха копятся налоги и проценты по кредитам банка. Кто встал сюда, забирает приз. Сейчас в призе: ${rub(G.prize)}.`,
        gotojail: 'Пурга! Тебя заметает в пути: отправляйся прямо в зимовьё, Старт не проходишь, 200 ₽ не получаешь.',
        tax: `Заплати ${rub(c.amount || 0)}. Деньги уходят в Приз Ысыаха.`,
        bayanai: DECK_ABOUT.bayanai,
        tyusyulge: DECK_ABOUT.tyusyulge,
      }[c.type];
      h = head(c.name, 'Клетка') + `<p>${esc(about)}</p>`;
    }
    // залог своей клетки
    const me = G.turn, mine = o && o.owner === me && !G.players[me].bankrupt && myMove();
    if (mine && o.mortgaged && (G.phase === 'roll' || G.phase === 'end')) {
      h += `<div class="act-row">${btn(`Выкупить · ${rub(E.unmortgageCost(i))}`, 'unmortgage', 'primary', !E.canUnmortgage(G, me, i), `data-cell="${i}"`)}</div>`;
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
        <label class="money"><span>Деньги</span><input id="t-get" type="number" inputmode="numeric" min="0" step="10" max="${them.money}" value="${trade.get.money || ''}" placeholder="0"><em>из ${rub(them.money)}</em></label>
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
      note = `Нужно согласие игрока ${esc(L.name)}: ${netGame() ? 'запрос придёт на его телефон' : 'передайте телефон'}. Денег у игрока: ${rub(L.money)}.`;
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
    let sub = 'Передайте телефон', what = rub(pl.money), go = 'Мой ход';
    if (G.phase === 'auction') {
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
    const r = applyAction(a, {});
    if (!r.ok) toast(r.error);
    return r.ok;
  }

  // Применить действие к партии: на одном телефоне или у хоста.
  // how.remote — действие пришло с другого телефона (или сработал таймер)
  function applyAction(a, how) {
    const before = G.turn, actorBefore = E.actor(G);
    const r = E.act(G, a);
    if (!r.ok) return r;
    save();
    const opts = { rolled: a.type === 'roll', turnChanged: G.turn !== before };
    if (netGame()) NET.publish(opts);
    afterChange(opts, a, actorBefore, !!(how && how.remote));
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
      return;
    }
    if (sheetOpen && kind.startsWith('cell:') && ['build', 'sell', 'mortgage', 'unmortgage'].includes(a.type) && E.actor(G) === actorBefore) {
      render(opts); showCell(a.cell); return;
    }
    closeSheet();
    render(opts);
    if (!netGame() && G.phase !== 'over' && E.actor(G) !== actorBefore) showHandoff();
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
      case 'showQr': showQr(); return;
      case 'askNew':
        openKind('ask', `<h3>Начать новую партию?</h3><p>Текущая партия будет удалена.</p>
          ${btn('Да, новая партия', 'newGame', 'danger')}${btn('Отмена', 'close', 'ghost')}`);
        return;
      case 'newGame':
        if (netGame()) { G = null; closeSheet(); NET.backToLobby(); return; }
        G = null; store.set(SAVE_KEY, null); showSetup(); return;

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

      case 'bid': send('bid', { amount: num('amount') }); return;
      default:
        if (G) send(act, cell !== undefined ? { cell } : undefined);
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
    $('sheet-bg').addEventListener('click', () => { if (!sheetIs('handoff')) closeSheet(); });
    $('btn-menu').addEventListener('click', showMenu);
    $('btn-all').addEventListener('click', () => board && board.showAll());
    $('prize').addEventListener('click', () => showCell(20));
    $('btn-start').addEventListener('click', startGame);
    $('btn-resume').addEventListener('click', () => { G = E.migrate(store.get(SAVE_KEY)); if (G) { shownCard = G.card ? G.card.seq : 0; showGame(true); } });
    $('count-seg').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      readNames(); setup.count = Number(b.dataset.n); renderSetup();
    });
    $('time-seg').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      readNames(); setup.minutes = Number(b.dataset.m); renderSetup();
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
      startNetGame(players, minutes) {
        G = E.create(players, { minutes });
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
      leaveGame() { G = null; closeSheet(); $('game').hidden = true; },
    };
    if (NET.boot) NET.boot();
    if (NET.isClient()) return;

    if (hot && hot.G) { G = E.migrate(hot.G); shownCard = G.card ? G.card.seq : 0; showGame(true); }
    else renderSetup();
  }

  const h = window.claude && window.claude.hot;
  if (h && h.snapshot) h.snapshot(() => ({ G }));
  if (h && h.ready) h.ready(boot); else boot(h && h.data ? h.data : {});
})();
