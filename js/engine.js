/* «Баай» — движок правил.
   Состояние партии — обычный JSON-объект. Меняется только через act(state, action).
   Экран (ui.js) ничего не считает сам: он рисует state и отправляет действия.
   На этапе 3 этот же файл будет работать у хоста, а гости будут слать ему действия.
   © 2026 Евсеев А.В. */
(function (root) {
  'use strict';

  const D = (typeof module !== 'undefined') ? require('./data.js') : root.BAAI.data;
  const { BOARD, GROUPS, BAYANAI, TYUSYULGE, RULES, ROLES } = D;
  const ROLE = Object.fromEntries(ROLES.map(r => [r.id, r]));
  const DECKS = { bayanai: BAYANAI, tyusyulge: TYUSYULGE };
  const DECK_NAMES = { bayanai: 'Байанай', tyusyulge: 'Тюсюлгэ' };
  const BANK = -1;
  const PRIZE = -2;            // деньги уходят в Приз Ысыаха

  let rand = Math.random;
  const die = () => 1 + Math.floor(rand() * 6);
  const rub = n => n.toLocaleString('ru-RU').replace(/ /g, ' ') + ' ₽';
  const int = v => Math.floor(Number(v) || 0);

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ---------- правила партии (экран «Новая игра») ----------
  // auction: open — ставки по кругу, sealed — одна тайная ставка от каждого
  // money:   open — деньги всех видны, hidden — видны только свои
  // growth:  flat — цены постоянные, grow — каждые GROW_EVERY кругов +10% (до +50%)
  // prize:   on — налоги копятся в Приз Ысыаха, off — уходят банку, приза нет
  // roles:   off — без ролей, pick — каждый выбирает втайне, random — раздаются случайно
  const RULE_DEFAULTS = { auction: 'open', money: 'open', growth: 'flat', prize: 'on', roles: 'off' };
  const RULE_VALUES = { auction: ['open', 'sealed'], money: ['open', 'hidden'], growth: ['flat', 'grow'], prize: ['on', 'off'], roles: ['off', 'pick', 'random'] };
  const GROW_EVERY = 5, GROW_STEP = 0.1, GROW_MAX = 1.5;

  function normRules(r) {
    const out = {};
    for (const k in RULE_DEFAULTS) out[k] = r && RULE_VALUES[k].includes(r[k]) ? r[k] : RULE_DEFAULTS[k];
    return out;
  }

  // ---------- создание партии ----------
  function create(players, options = {}) {
    const minutes = Number(options.minutes) || 0;
    const rules = normRules(options.rules);
    const deal = rules.roles === 'random' ? shuffle(ROLES.map(r => r.id)) : [];
    return migrate({
      rules,
      round: 0,                // сколько полных кругов ходов прошло
      grow: 1,                 // во сколько раз выросли цены
      v: 2,
      players: players.map((p, i) => ({
        name: p.name, color: p.color, figure: p.figure || 'horse',
        money: RULES.startMoney, pos: 0,
        inJail: false, jailTries: 0, freeCards: [], bankrupt: false,
        loan: null,            // { from, principal, owe, laps, due }
        bot: !!p.bot,          // ходит сам
        role: rules.roles === 'random' ? deal[i] : null,   // тайная роль (id из data.ROLES)
        roleUsed: false,       // способность «раз за игру» потрачена
        roleShown: false,      // роль раскрыта всем
        trap: false,           // Булчут: засада взведена
      })),
      own: {},                 // номер клетки → { owner, houses, mortgaged } (5 домов = отель)
      turn: 0,
      phase: rules.roles === 'pick' ? 'roles' : 'roll',   // roles | roll | omen | buy | pick2 | auction | offer | end | debt | over
      dice: null,
      doubles: 0,
      extra: false,            // выпал дубль — после хода бросаешь ещё
      pending: null,           // { kind:'buy', cell } | { kind:'debt', amount, to, reason, after, prize }
      auction: null,           // { cell, start, price, leader, bidders, at }
      auctionQueue: [],        // клетки банкрота, которые ждут торгов
      offer: null,             // предложение обмена или кредита
      prize: 0,                // Приз Ысыаха
      decks: {
        bayanai: shuffle(BAYANAI.map((_, i) => i)),
        tyusyulge: shuffle(TYUSYULGE.map((_, i) => i)),
      },
      card: null,              // последняя вытянутая карточка
      choice: null,            // Булчут: две карточки на выбор { deck, ids }
      log: [],
      seq: 0,                  // счётчик изменений — экран по нему понимает, что перерисовать
      endsAt: minutes ? Date.now() + minutes * 60000 : 0,
      winner: null,
      overReason: '',
    });
  }

  // Сохранение из прошлой версии — дополняем новыми полями
  function migrate(s) {
    if (!s) return s;
    s.v = 2;
    s.rules = normRules(s.rules);
    s.round = s.round || 0;
    s.grow = s.grow || 1;
    s.prize = s.prize || 0;
    s.auction = s.auction || null;
    s.auctionQueue = s.auctionQueue || [];
    s.offer = s.offer || null;
    s.choice = s.choice || null;
    s.players.forEach(p => {
      if (p.loan === undefined) p.loan = null;
      if (p.role === undefined) Object.assign(p, { role: null, roleUsed: false, roleShown: false, trap: false });
      p.bot = !!p.bot;
    });
    for (const k in s.own) if (s.own[k].mortgaged === undefined) s.own[k].mortgaged = false;
    return s;
  }

  // ---------- вспомогательное ----------
  const cur = s => s.players[s.turn];
  const nameOf = (s, i) => i === BANK ? 'банк' : i === PRIZE ? 'Приз Ысыаха' : (i === 'each' ? 'игрокам' : s.players[i].name);
  const alive = s => s.players.map((_, i) => i).filter(i => !s.players[i].bankrupt);

  // Кто сейчас должен действовать
  function actor(s) {
    if (s.phase === 'roles') { const i = s.players.findIndex(p => !p.role); return i < 0 ? s.turn : i; }
    if (s.phase === 'auction' && s.auction) return s.auction.at;
    if (s.phase === 'offer' && s.offer) return s.offer.to;
    return s.turn;
  }

  function log(s, text) {
    s.log.push(text);
    if (s.log.length > 120) s.log.splice(0, s.log.length - 120);
  }

  // ---------- тайные роли ----------
  const has = (s, p, id) => p >= 0 && !!s.players[p] && s.players[p].role === id && !s.players[p].bankrupt;
  // роль сработала — раскрываем её всем
  function reveal(s, p, what) {
    const pl = s.players[p], r = ROLE[pl.role];
    pl.roleShown = true;
    log(s, `🎭 ${pl.name} — ${r.name}: ${what}`);
  }
  const x15 = n => Math.round(n * 1.5);

  function groupCells(g) {
    const out = [];
    BOARD.forEach((c, i) => { if (c.type === 'prop' && c.group === g) out.push(i); });
    return out;
  }

  function ownsGroup(s, p, g) {
    return groupCells(g).every(i => s.own[i] && s.own[i].owner === p);
  }

  function groupHasHouses(s, g) {
    return groupCells(g).some(i => s.own[i] && s.own[i].houses > 0);
  }

  function countOwned(s, p, type) {
    return BOARD.reduce((n, c, i) => n + (c.type === type && s.own[i] && s.own[i].owner === p ? 1 : 0), 0);
  }

  // Цены с учётом роста («долгая партия»). Залог и продажа домов — по исходной цене.
  const up = (s, n) => (s && s.grow > 1 ? Math.round(n * s.grow) : n);
  const price = (s, i) => up(s, BOARD[i].price);
  // p — кто строит: Уус строит на 20% дешевле
  const houseCost = (s, g, p) => { const c = up(s, GROUPS[g].house); return has(s, p, 'uus') ? Math.round(c * 0.8) : c; };
  const taxOf = (s, i) => up(s, BOARD[i].amount || 0);
  const prizeOn = s => s.rules.prize !== 'off';

  // Аренда по таблице, без владельца и залога (для справки о клетке)
  function baseRent(s, i, houses, full) {
    const c = BOARD[i];
    return up(s, houses > 0 ? c.rent[houses] : c.rent[0] * (full ? 2 : 1));
  }

  function rentFor(s, i, opts = {}) {
    const c = BOARD[i], o = s.own[i];
    if (!o || o.mortgaged) return 0;
    if (c.type === 'prop') {
      const r = baseRent(s, i, o.houses, ownsGroup(s, o.owner, c.group));
      return o.houses === 0 && has(s, o.owner, 'toyon') ? Math.round(r * 0.9) : r;
    }
    if (c.type === 'transport') {
      const r = up(s, RULES.transportRent[countOwned(s, o.owner, 'transport')] * (opts.mult || 1));
      return has(s, o.owner, 'kayur') ? x15(r) : r;
    }
    if (c.type === 'utility') {
      const sum = opts.diceSum || (s.dice ? s.dice[0] + s.dice[1] : 7);
      const mult = opts.force10 ? 10 : RULES.utilityMult[countOwned(s, o.owner, 'utility')];
      return up(s, sum * mult);
    }
    return 0;
  }

  // Откуда взялась аренда — для плашки «Платите …». Минусы и плюсы тайных ролей
  // называем, только если роль уже раскрыта.
  function rentWhy(s, i, opts = {}) {
    const c = BOARD[i], o = s.own[i], ow = s.players[o.owner], why = [];
    const shown = id => ow.role === id && ow.roleShown;
    if (c.type === 'prop') {
      if (o.houses === 5) why.push('отель');
      else if (o.houses > 0) why.push(o.houses === 1 ? '1 дом' : `${o.houses} дома`);
      else if (ownsGroup(s, o.owner, c.group)) why.push('вся группа ×2');
      else why.push('без домов');
      if (o.houses === 0 && shown('toyon')) why.push('Тойон −10%');
    } else if (c.type === 'transport') {
      const n = countOwned(s, o.owner, 'transport');
      why.push(n === 1 ? 'транспорт: 1 у владельца' : `транспорт: ${n} у владельца`);
      if (opts.mult === 2) why.push('по карточке ×2');
      if (shown('kayur')) why.push('Каюр ×1,5');
    } else if (c.type === 'utility') {
      const sum = opts.diceSum || (s.dice ? s.dice[0] + s.dice[1] : 7);
      const mult = opts.force10 ? 10 : RULES.utilityMult[countOwned(s, o.owner, 'utility')];
      why.push(`кубики ${sum} × ${mult}${opts.force10 ? ' по карточке' : ''}`);
    }
    if (s.grow > 1) why.push(`цены +${Math.round((s.grow - 1) * 100)}%`);
    return why;
  }

  // ---------- залог ----------
  const mortgageValue = i => Math.floor(BOARD[i].price * RULES.mortgageRate);
  const mortgageFee = i => Math.ceil(mortgageValue(i) * RULES.mortgageFee);
  const unmortgageCost = i => mortgageValue(i) + mortgageFee(i);

  function canMortgage(s, p, i) {
    const c = BOARD[i], o = s.own[i];
    if (!c || !o || o.owner !== p || o.mortgaged) return false;
    if (c.type === 'prop' && groupHasHouses(s, c.group)) return false;
    return true;
  }

  function canUnmortgage(s, p, i) {
    const o = s.own[i];
    return !!o && o.owner === p && o.mortgaged && s.players[p].money >= unmortgageCost(i);
  }

  function doMortgage(s, p, i) {
    s.own[i].mortgaged = true;
    s.players[p].money += mortgageValue(i);
  }

  // Богатство для партии на время: деньги + имущество − долги
  function netWorth(s, p) {
    let w = s.players[p].money;
    for (const k in s.own) {
      const o = s.own[k];
      if (o.owner !== p) continue;
      const c = BOARD[k];
      w += o.mortgaged ? price(s, k) - mortgageValue(k) : price(s, k);
      if (c.type === 'prop') w += o.houses * houseCost(s, c.group);
    }
    const L = s.players[p].loan;
    if (L) w -= L.owe;
    s.players.forEach(q => { if (!q.bankrupt && q.loan && q.loan.from === p) w += q.loan.owe; });
    return w;
  }

  // ---------- строительство ----------
  function canBuild(s, p, i) {
    const c = BOARD[i], o = s.own[i];
    if (!c || c.type !== 'prop' || !o || o.owner !== p) return false;
    if (!ownsGroup(s, p, c.group) || o.houses >= 5) return false;
    const cells = groupCells(c.group);
    if (cells.some(j => s.own[j].mortgaged)) return false;
    const min = Math.min(...cells.map(j => s.own[j].houses));
    return o.houses === min && s.players[p].money >= houseCost(s, c.group, p);
  }

  function canSell(s, p, i) {
    const c = BOARD[i], o = s.own[i];
    if (!c || c.type !== 'prop' || !o || o.owner !== p || o.houses === 0) return false;
    const max = Math.max(...groupCells(c.group).map(j => (s.own[j] ? s.own[j].houses : 0)));
    return o.houses === max;
  }

  // Уус выручает за дом только треть
  function sellValue(i, s) {
    const h = GROUPS[BOARD[i].group].house, o = s && s.own[i];
    return Math.floor(o && has(s, o.owner, 'uus') ? h / 3 : h * RULES.sellRate);
  }

  function doSell(s, p, i) {
    s.players[p].money += sellValue(i, s);
    s.own[i].houses--;
  }

  // Сколько игрок может собрать: продать все дома и заложить все клетки
  function liquidValue(s, p) {
    let v = s.players[p].money;
    for (const k in s.own) {
      const o = s.own[k];
      if (o.owner !== p) continue;
      if (BOARD[k].type === 'prop') v += o.houses * sellValue(k, s);
      if (!o.mortgaged) v += mortgageValue(k);
    }
    return v;
  }

  // Собрать деньги автоматически (для игроков, которые платят не в свой ход):
  // сначала продаются дома, потом закладываются клетки, начиная с дешёвых
  function autoRaise(s, p, need) {
    let sold = 0, mort = [];
    while (s.players[p].money < need) {
      let best = -1;
      for (const k in s.own) {
        const i = Number(k);
        if (canSell(s, p, i) && (best < 0 || BOARD[i].price > BOARD[best].price)) best = i;
      }
      if (best < 0) break;
      doSell(s, p, best); sold++;
    }
    while (s.players[p].money < need) {
      let best = -1;
      for (const k in s.own) {
        const i = Number(k);
        if (canMortgage(s, p, i) && (best < 0 || BOARD[i].price < BOARD[best].price)) best = i;
      }
      if (best < 0) break;
      doMortgage(s, p, best); mort.push(BOARD[best].name);
    }
    if (sold) log(s, `${s.players[p].name} продаёт домов: ${sold}`);
    if (mort.length) log(s, `${s.players[p].name} закладывает: ${mort.join(', ')}`);
  }

  // ---------- деньги ----------
  // Заплатить: to — номер игрока, BANK, PRIZE или 'each' (поровну всем остальным).
  // prize — какая часть платежа банку уходит в Приз Ысыаха (проценты по кредиту)
  function charge(s, p, to, amount, reason, after, prize) {
    const pl = s.players[p];
    if (amount <= 0) { if (after) runAfter(s, after); return; }
    if (pl.money < amount && p !== s.turn) autoRaise(s, p, amount);
    if (pl.money >= amount) {
      pay(s, p, to, amount, prize);
      log(s, `${pl.name} платит ${rub(amount)} (${reason})`);
      if (after) runAfter(s, after);
      return;
    }
    if (p === s.turn) {
      // Свой ход — даём самому продать дома, заложить клетки или объявить банкротство
      s.pending = { kind: 'debt', amount, to, reason, after: after || null, prize: prize || 0 };
      s.phase = 'debt';
      log(s, `${pl.name} не хватает денег: нужно ${rub(amount)} (${reason})`);
    } else {
      bankrupt(s, p, creditorOf(to));
    }
  }

  const creditorOf = to => (to === 'each' || to === PRIZE) ? BANK : to;

  function pay(s, p, to, amount, prize) {
    s.players[p].money -= amount;
    if (to === 'each') {
      const others = alive(s).filter(i => i !== p);
      const part = Math.floor(amount / Math.max(1, others.length));
      others.forEach(i => { s.players[i].money += part; });
    } else if (to === PRIZE) {
      s.prize += amount;
    } else if (to === BANK) {
      if (prize && prizeOn(s)) s.prize += Math.min(prize, amount);
    } else {
      s.players[to].money += amount;
    }
  }

  function bankrupt(s, p, to) {
    const pl = s.players[p];
    const toBank = [];
    for (const k in s.own) {
      const o = s.own[k];
      if (o.owner !== p) continue;
      if (BOARD[k].type === 'prop' && o.houses) { pl.money += o.houses * sellValue(k, s); o.houses = 0; }
      if (to === BANK) { delete s.own[k]; toBank.push(Number(k)); } else o.owner = to;
    }
    if (to === BANK) {
      pl.freeCards.forEach(d => s.decks[d].push(DECKS[d].findIndex(c => c.free)));
    } else {
      s.players[to].money += Math.max(0, pl.money);
      s.players[to].freeCards.push(...pl.freeCards);
    }
    // его собственный кредит закрывается: всё имущество уже ушло кредитору
    pl.loan = null;
    // кредиты, которые он выдал, переходят к тому, кто получил имущество
    s.players.forEach((q, i) => {
      if (!q.loan || q.loan.from !== p) return;
      if (to === i) { q.loan = null; log(s, `Долг ${q.name} списан`); }
      else q.loan.from = to;
    });
    pl.freeCards = []; pl.money = 0; pl.bankrupt = true; pl.inJail = false;
    log(s, `💥 ${pl.name} — банкрот. Имущество получает ${nameOf(s, to)}.`);

    const left = alive(s);
    if (left.length <= 1) {
      s.phase = 'over'; s.pending = null; s.auction = null; s.offer = null; s.auctionQueue = [];
      s.winner = left[0] ?? null;
      s.overReason = 'last';
      log(s, `🏆 Победитель: ${s.players[s.winner].name}`);
      return;
    }
    if (toBank.length) {
      s.auctionQueue.push(...toBank);
      log(s, `Клетки банкрота уйдут на аукцион: ${toBank.map(i => BOARD[i].name).join(', ')}`);
    }
    if (p === s.turn) { s.pending = null; s.extra = false; s.phase = 'end'; }
  }

  // ---------- движение ----------
  function passStart(s, p) {
    const pl = s.players[p];
    pl.money += RULES.passStart;
    log(s, `${pl.name} проходит Старт: +${rub(RULES.passStart)}`);
    if (has(s, p, 'toyon')) {
      const full = Object.keys(GROUPS).filter(g => ownsGroup(s, p, Number(g))).length;
      if (full) { pl.money += 25 * full; reveal(s, p, `дань с полных групп +${rub(25 * full)}`); }
    }
    if (pl.loan) {
      pl.loan.laps--;
      if (pl.loan.laps <= 0) pl.loan.due = true;   // спишется, когда фишка остановится
    }
  }

  function moveBy(s, p, steps) {
    const pl = s.players[p];
    const to = (pl.pos + steps) % 40;
    if (pl.pos + steps >= 40) passStart(s, p);
    pl.pos = to;
    log(s, `${pl.name} → ${BOARD[to].name}`);
    land(s, p);
  }

  function moveTo(s, p, to, opts) {
    const pl = s.players[p];
    if (to < pl.pos || to === 0) passStart(s, p);
    pl.pos = to;
    log(s, `${pl.name} → ${BOARD[to].name}`);
    land(s, p, opts);
  }

  function sendToJail(s, p) {
    const pl = s.players[p];
    pl.pos = RULES.jailPos; pl.inJail = true; pl.jailTries = 0;
    if (p === s.turn) { s.extra = false; s.doubles = 0; }
    log(s, `❄ ${pl.name} пережидает пургу в зимовье`);
  }

  // Что происходит на клетке
  function land(s, p, opts = {}) {
    const pl = s.players[p];
    const i = pl.pos, c = BOARD[i];
    switch (c.type) {
      case 'prop': case 'transport': case 'utility': {
        const o = s.own[i];
        if (!o) { s.pending = { kind: 'buy', cell: i }; s.phase = 'buy'; return; }
        if (o.owner === p) return;
        if (o.mortgaged) {
          log(s, `${c.name} в залоге — аренда не берётся`);
          s.rentNote = { seq: (s.rentNote ? s.rentNote.seq : 0) + 1, payer: p, owner: o.owner, cell: i, amount: 0, why: ['в залоге — аренды нет'] };
          return;
        }
        let rent = rentFor(s, i, opts);
        const ow = s.players[o.owner];
        const why = rentWhy(s, i, opts);
        if (ow.trap && !ow.bankrupt) { ow.trap = false; rent *= 2; why.push('засада ×2'); reveal(s, o.owner, `засада — аренда вдвойне, ${rub(rent)}`); }
        s.rentNote = { seq: (s.rentNote ? s.rentNote.seq : 0) + 1, payer: p, owner: o.owner, cell: i, amount: rent, why };
        charge(s, p, o.owner, rent, `аренда: ${c.name} → ${s.players[o.owner].name}`);
        return;
      }
      case 'tax':
        if (has(s, p, 'atyyhyt')) {
          const t = x15(taxOf(s, i));
          reveal(s, p, `налог в полтора раза больше, ${rub(t)}`);
          charge(s, p, prizeOn(s) ? PRIZE : BANK, t, c.name);
          return;
        }
        if (prizeOn(s)) charge(s, p, PRIZE, taxOf(s, i), `${c.name} → в Приз Ысыаха`);
        else charge(s, p, BANK, taxOf(s, i), c.name);
        return;
      case 'parking':
        if (has(s, p, 'olonkhosut')) { pl.money += 100; reveal(s, p, `сказание на Ысыахе +${rub(100)}`); }
        if (prizeOn(s) && s.prize > 0) {
          pl.money += s.prize;
          log(s, `🎉 ${pl.name} получает Приз Ысыаха: ${rub(s.prize)}`);
          s.prize = 0;
        }
        return;
      case 'bayanai': case 'tyusyulge':
        if (c.type === 'bayanai' && has(s, p, 'bulchut')) {
          s.choice = { deck: 'bayanai', ids: [s.decks.bayanai.shift(), s.decks.bayanai.shift()] };
          s.phase = 'pick2';
          reveal(s, p, 'тянет две карточки «Байанай» и выбирает одну');
          return;
        }
        drawCard(s, p, c.type);
        return;
      case 'gotojail':
        if (has(s, p, 'ojuun')) { reveal(s, p, 'пурга не уносит шамана в зимовьё'); return; }
        sendToJail(s, p);
        return;
      default:
        return;
    }
  }

  function drawCard(s, p, deck, forced) {
    const id = forced !== undefined ? forced : s.decks[deck].shift();
    const card = DECKS[deck][id];
    if (!card.free) s.decks[deck].push(id);
    s.card = { deck, title: DECK_NAMES[deck], text: card.text, seq: s.seq + 1, player: p };
    log(s, `${DECK_NAMES[deck]}: ${card.text}`);
    const pl = s.players[p];
    // Ойуун платит по «Тюсюлгэ» в полтора раза больше
    const k = deck === 'tyusyulge' && has(s, p, 'ojuun') && (card.money < 0 || card.each < 0 || card.repairs) ? 1.5 : 1;
    if (k > 1) reveal(s, p, 'платит по «Тюсюлгэ» в полтора раза больше');

    if (card.money > 0) { pl.money += card.money; return; }
    if (card.money < 0) { charge(s, p, BANK, Math.round(-card.money * k), DECK_NAMES[deck]); return; }
    if (card.free) { pl.freeCards.push(deck); return; }
    if (card.jail) { sendToJail(s, p); return; }
    if (card.moveTo !== undefined) { moveTo(s, p, card.moveTo); return; }
    if (card.back) {
      pl.pos = (pl.pos - card.back + 40) % 40;
      log(s, `${pl.name} → ${BOARD[pl.pos].name}`);
      land(s, p);
      return;
    }
    if (card.each > 0) {
      alive(s).filter(i => i !== p).forEach(i => {
        if (!s.players[i].bankrupt && s.phase !== 'over') charge(s, i, p, card.each, DECK_NAMES[deck]);
      });
      return;
    }
    if (card.each < 0) {
      const n = alive(s).length - 1;
      charge(s, p, 'each', Math.round(-card.each * n * k), DECK_NAMES[deck]);
      return;
    }
    if (card.repairs) {
      let h = 0, hot = 0;
      for (const k in s.own) {
        const o = s.own[k];
        if (o.owner !== p || BOARD[k].type !== 'prop') continue;
        if (o.houses === 5) hot++; else h += o.houses;
      }
      charge(s, p, BANK, Math.round((h * card.repairs[0] + hot * card.repairs[1]) * k), DECK_NAMES[deck]);
      return;
    }
    if (card.nearest) {
      let i = pl.pos;
      do { i = (i + 1) % 40; } while (BOARD[i].type !== card.nearest);
      if (card.nearest === 'transport') moveTo(s, p, i, { mult: 2 });
      else {
        const o = s.own[i];
        let opts = {};
        if (o && o.owner !== p && !o.mortgaged) {
          const d = [die(), die()];
          log(s, `Бросок для оплаты: ${d[0]} + ${d[1]}`);
          opts = { diceSum: d[0] + d[1], force10: true };
        }
        moveTo(s, p, i, opts);
      }
    }
  }

  // Кубики брошены — ход фишки. shown: бросок уже был показан (Ойуун решил идти)
  function afterRoll(s, p, d, shown) {
    const pl = s.players[p];
    const dbl = d[0] === d[1], sum = d[0] + d[1];
    if (!shown) log(s, `🎲 ${pl.name}: ${d[0]} + ${d[1]}${dbl ? ' — дубль!' : ''}`);
    else if (dbl) log(s, 'Дубль!');

    if (pl.inJail) {
      if (dbl && has(s, p, 'kayur')) reveal(s, p, 'дубль не выводит каюра из зимовья');
      if (dbl && !has(s, p, 'kayur')) {
        pl.inJail = false; pl.jailTries = 0; s.extra = false;
        log(s, `Пурга стихла: ${pl.name} выходит из зимовья`);
        moveBy(s, p, sum);
      } else {
        pl.jailTries++;
        if (pl.jailTries >= RULES.maxJailTries) {
          pl.inJail = false; pl.jailTries = 0; s.extra = false;
          charge(s, p, BANK, RULES.jailFine, 'вездеход из зимовья', { move: sum });
        } else {
          log(s, `${pl.name} остаётся в зимовье (попытка ${pl.jailTries} из ${RULES.maxJailTries})`);
        }
      }
      s.extra = false;
      settle(s);
      return ok();
    }

    if (dbl) {
      s.doubles++;
      if (s.doubles >= 3) {
        log(s, 'Три дубля подряд — гнал и попал в пургу!');
        sendToJail(s, p);
        settle(s);
        return ok();
      }
      s.extra = true;
    } else s.extra = false;
    moveBy(s, p, sum);
    settle(s);
    return ok();
  }

  // ---------- способности «раз за игру» ----------
  function useAbility(s, p, a) {
    const pl = s.players[p], role = pl.role, calm = s.phase === 'roll' || s.phase === 'end';
    if (!role || pl.roleUsed) return err('Способность уже потрачена');
    const done = what => { pl.roleUsed = true; reveal(s, p, what); return ok(); };
    switch (role) {
      case 'uus': {
        if (!calm) return err('Строить можно в начале или в конце хода');
        const i = int(a.cell), c = BOARD[i], o = s.own[i];
        if (!c || c.type !== 'prop' || !o || o.owner !== p || o.mortgaged || o.houses) return err('Выберите свой пустой участок не в залоге');
        if (ownsGroup(s, p, c.group)) return err('Группа уже ваша — стройте как обычно');
        if (groupCells(c.group).some(j => s.own[j] && s.own[j].mortgaged)) return err('В группе есть заложенная клетка');
        const cost = houseCost(s, c.group, p);
        if (pl.money < cost) return err('Не хватает денег');
        pl.money -= cost; o.houses = 1;
        return done(`ставит дом без полной группы: ${c.name} (−${rub(cost)})`);
      }
      case 'bulchut':
        if (!calm) return err('Засаду ставят в начале или в конце хода');
        pl.trap = true; pl.roleUsed = true;
        log(s, `${pl.name} что-то задумал…`);
        return ok();
      case 'atyyhyt': {
        if (s.phase !== 'auction') return err('Только на аукционе');
        const A = s.auction;
        if (pl.money < A.start) return err('Не хватает денег');
        pl.roleUsed = true;
        reveal(s, p, `забирает ${BOARD[A.cell].name} по стартовой цене без торгов`);
        A.leader = p; A.price = A.start;
        finishAuction(s);
        return ok();
      }
      case 'kayur': {
        if (s.phase !== 'roll' || pl.inJail) return err('Только вместо броска');
        const i = int(a.cell);
        if (!BOARD[i] || BOARD[i].type !== 'transport' || i === pl.pos) return err('Выберите другую клетку транспорта');
        pl.roleUsed = true;
        reveal(s, p, `упряжка мчит на ${BOARD[i].name}`);
        s.dice = null; s.card = null; s.extra = false;
        moveTo(s, p, i);
        settle(s);
        return ok();
      }
      case 'toyon': {
        if (!calm) return err('Сход созывают в начале или в конце хода');
        pl.roleUsed = true;
        reveal(s, p, 'созывает сход — каждый платит 30 ₽');
        alive(s).filter(i => i !== p).forEach(i => {
          if (s.phase !== 'over' && !s.players[i].bankrupt) charge(s, i, p, 30, 'сход у тойона');
        });
        return ok();
      }
      case 'olonkhosut': {
        if (!calm) return err('Только в начале или в конце хода');
        if (!prizeOn(s) || !s.prize) return err('Приз Ысыаха пуст');
        const v = s.prize; s.prize = 0; pl.money += v;
        return done(`сказанием забирает Приз Ысыаха: ${rub(v)}`);
      }
    }
    return err('У этой роли нет такой способности');
  }

  // Можно ли сейчас применить способность (для экрана и ботов)
  function canAbility(s, p) {
    const pl = s.players[p];
    if (!pl || !pl.role || pl.roleUsed || pl.bankrupt || actor(s) !== p) return false;
    const calm = s.phase === 'roll' || s.phase === 'end';
    switch (pl.role) {
      case 'uus': return calm && Object.keys(s.own).some(k => { const o = s.own[k], c = BOARD[k]; return o.owner === p && c.type === 'prop' && !o.mortgaged && !o.houses && !ownsGroup(s, p, c.group) && !groupCells(c.group).some(j => s.own[j] && s.own[j].mortgaged); });
      case 'bulchut': case 'toyon': return calm;
      case 'atyyhyt': return s.phase === 'auction' && pl.money >= s.auction.start;
      case 'kayur': return s.phase === 'roll' && !pl.inJail;
      case 'olonkhosut': return calm && prizeOn(s) && s.prize > 0;
    }
    return false;
  }

  // Продолжение после оплаты долга
  function runAfter(s, after) {
    if (after && after.move) moveBy(s, s.turn, after.move);
  }

  // Ход закончен или можно бросать ещё раз
  function settle(s) {
    if (['buy', 'debt', 'over', 'auction', 'offer', 'pick2', 'omen'].includes(s.phase)) return;
    const pl = cur(s);
    // срок кредита наступил — возвращаем, когда фишка остановилась
    if (pl.loan && pl.loan.due && !pl.bankrupt) {
      const L = pl.loan;
      pl.loan = null;
      charge(s, s.turn, L.from, L.owe, 'возврат кредита', null, L.from === BANK ? L.owe - L.principal : 0);
      if (s.phase === 'debt' || s.phase === 'over') return;
    }
    s.phase = (s.extra && !pl.inJail && !pl.bankrupt) ? 'roll' : 'end';
  }

  function nextTurn(s) {
    if (s.endsAt && Date.now() >= s.endsAt) return finishByTime(s);
    let t = s.turn;
    do { t = (t + 1) % s.players.length; } while (s.players[t].bankrupt);
    if (t <= s.turn) newRound(s);
    s.turn = t; s.phase = 'roll'; s.doubles = 0; s.extra = false; s.dice = null; s.pending = null;
    log(s, `— Ход: ${s.players[t].name}`);
  }

  // Прошёл круг ходов. В «долгой партии» каждые GROW_EVERY кругов цены растут
  function newRound(s) {
    s.round++;
    if (s.rules.growth !== 'grow' || s.round % GROW_EVERY || s.grow >= GROW_MAX) return;
    s.grow = Math.min(GROW_MAX, Math.round((s.grow + GROW_STEP) * 100) / 100);
    log(s, `📈 Цены выросли: теперь +${Math.round((s.grow - 1) * 100)}% к покупке, аренде, домам и налогам`);
  }

  function finishByTime(s) {
    let best = null, bw = -Infinity;
    alive(s).forEach(i => { const w = netWorth(s, i); if (w > bw) { bw = w; best = i; } });
    s.phase = 'over'; s.winner = best; s.overReason = 'time'; s.pending = null;
    log(s, `⏰ Время вышло. Самый богатый: ${s.players[best].name} (${rub(bw)})`);
  }

  // ---------- аукцион ----------
  function startAuction(s, cell) {
    const start = Math.max(RULES.bidStep, Math.floor(price(s, cell) * RULES.auctionStart));
    const tr = BOARD[cell].type === 'transport';
    s.auction = { cell, start, price: 0, leader: null, bidders: alive(s).filter(i => !(tr && has(s, i, 'bulchut'))), at: null };
    s.phase = 'auction'; s.pending = null;
    if (s.rules.auction === 'sealed') {
      // тайный: каждый по кругу один раз пишет ставку, потом все открываются
      const n = s.players.length, A = s.auction;
      A.sealed = true; A.bids = {};
      A.bidders = A.bidders
        .filter(i => s.players[i].money >= start)
        .sort((a, b) => ((a - s.turn - 1 + n) % n) - ((b - s.turn - 1 + n) % n));
      log(s, `🔨 Тайный аукцион: ${BOARD[cell].name}, ставки от ${rub(start)}`);
      return nextSealed(s);
    }
    log(s, `🔨 Аукцион: ${BOARD[cell].name}, торги с ${rub(start)}`);
    advanceAuction(s, s.turn);
  }

  // Тайный аукцион: следующий, кто ещё не ставил, или вскрываем ставки
  function nextSealed(s) {
    const A = s.auction;
    const left = A.bidders.filter(i => A.bids[i] === undefined);
    if (left.length) { A.at = left[0]; return; }
    let best = null;
    A.bidders.forEach(i => { if (A.bids[i] > 0 && (best === null || A.bids[i] > A.bids[best])) best = i; });
    if (A.bidders.length) log(s, `🔨 Ставки: ${A.bidders.map(i => `${s.players[i].name} — ${A.bids[i] > 0 ? rub(A.bids[i]) : 'пас'}`).join(', ')}`);
    if (best !== null) { A.leader = best; A.price = A.bids[best]; }
    finishAuction(s);
  }

  function minBid(s) {
    const A = s.auction;
    return A.sealed || A.leader === null ? A.start : A.price + RULES.bidStep;
  }

  // Передать ставку следующему по кругу. Кому не хватает денег — выбывает
  function advanceAuction(s, from) {
    const A = s.auction, need = minBid(s);
    A.bidders = A.bidders.filter(i => {
      if (i === A.leader || s.players[i].money >= need) return true;
      log(s, `${s.players[i].name} выбывает из торгов: не хватает денег`);
      return false;
    });
    const others = A.bidders.filter(i => i !== A.leader);
    if (!others.length) return finishAuction(s);
    const n = s.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (from + k) % n;
      if (others.includes(i)) { A.at = i; return; }
    }
  }

  function finishAuction(s) {
    const A = s.auction, c = BOARD[A.cell];
    if (A.leader !== null) {
      s.players[A.leader].money -= A.price;
      s.own[A.cell] = { owner: A.leader, houses: 0, mortgaged: false };
      log(s, `🔨 ${s.players[A.leader].name} покупает ${c.name} на аукционе за ${rub(A.price)}`);
    } else {
      log(s, `🔨 ${c.name}: никто не купил, клетка остаётся у банка`);
    }
    s.auction = null;
    s.phase = 'moving';
    settle(s);
  }

  // ---------- обмен ----------
  function normSide(x) {
    x = x || {};
    const cells = [...new Set((x.cells || []).map(int))].filter(i => i >= 0 && i < 40);
    return { cells, money: Math.max(0, int(x.money)), cards: Math.max(0, int(x.cards)) };
  }

  // Можно ли этой клеткой меняться: своя и без домов в группе
  function canTradeCell(s, p, i) {
    const c = BOARD[i], o = s.own[i];
    if (!o || o.owner !== p) return false;
    return !(c.type === 'prop' && groupHasHouses(s, c.group));
  }

  function checkSide(s, p, side) {
    const pl = s.players[p];
    for (const i of side.cells) if (!canTradeCell(s, p, i)) return `${BOARD[i].name}: этой клеткой меняться нельзя`;
    if (side.money > pl.money) return `У игрока ${pl.name} нет столько денег`;
    if (side.cards > pl.freeCards.length) return `У игрока ${pl.name} нет столько карт`;
    return '';
  }

  // 10% банку за каждую полученную заложенную клетку
  // Атыыһыт обменивается без этой платы
  const tradeFee = (s, cells, to) => has(s, to, 'atyyhyt') ? 0 : cells.reduce((n, i) => n + (s.own[i].mortgaged ? mortgageFee(i) : 0), 0);
  const noTransport = (s, p, cells) => has(s, p, 'bulchut') && cells.some(i => BOARD[i].type === 'transport');

  function applyTrade(s, o) {
    const A = s.players[o.from], B = s.players[o.to];
    if (noTransport(s, o.from, o.get.cells) || noTransport(s, o.to, o.give.cells)) return 'Этот игрок не может получить транспорт';
    const feeA = tradeFee(s, o.get.cells, o.from), feeB = tradeFee(s, o.give.cells, o.to);
    if (A.money - o.give.money + o.get.money < feeA) return `${A.name} не хватит на 10% за заложенные клетки`;
    if (B.money - o.get.money + o.give.money < feeB) return `${B.name} не хватит на 10% за заложенные клетки`;
    o.give.cells.forEach(i => { s.own[i].owner = o.to; });
    o.get.cells.forEach(i => { s.own[i].owner = o.from; });
    A.money += o.get.money - o.give.money - feeA;
    B.money += o.give.money - o.get.money - feeB;
    B.freeCards.push(...A.freeCards.splice(0, o.give.cards));
    A.freeCards.push(...B.freeCards.splice(0, o.get.cards));
    if (feeA) log(s, `${A.name} платит банку ${rub(feeA)} за заложенные клетки`);
    if (feeB) log(s, `${B.name} платит банку ${rub(feeB)} за заложенные клетки`);
    return '';
  }

  function describeSide(s, side) {
    const parts = side.cells.map(i => BOARD[i].name);
    if (side.money) parts.push(rub(side.money));
    if (side.cards) parts.push(`«Попутный вездеход» ×${side.cards}`);
    return parts.length ? parts.join(', ') : 'ничего';
  }

  // ---------- кредит ----------
  function makeLoan(from, amount, rate, laps) {
    return { from, principal: amount, owe: Math.round(amount * (1 + rate / 100)), rate, laps, due: false };
  }

  // ---------- действия ----------
  // action = { type, player, cell?, amount?, ... }. Возвращает { ok } или { ok:false, error }.
  function act(s, a) {
    const r = actInner(s, a);
    if (r.ok) {
      // клетки банкрота по одной уходят на торги, когда ход в спокойной фазе
      if ((s.phase === 'roll' || s.phase === 'end') && s.auctionQueue.length) startAuction(s, s.auctionQueue.shift());
      s.seq++;
    }
    return r;
  }

  function actInner(s, a) {
    if (s.phase === 'over') return err('Партия окончена');
    const p = a.player;
    if (p !== actor(s)) return err('Сейчас не ваш ход');
    const pl = s.players[p];
    if (pl.bankrupt && a.type !== 'endTurn') return err('Вы выбыли из игры');

    switch (a.type) {
      case 'roll': {
        if (s.phase !== 'roll') return err('Сейчас нельзя бросать');
        const d = [die(), die()];
        s.dice = d; s.card = null;
        // Ойуун видит кубики и может один раз перебросить
        if (has(s, p, 'ojuun') && !pl.roleUsed && !pl.inJail) {
          s.phase = 'omen';
          log(s, `🎲 ${pl.name}: ${d[0]} + ${d[1]}`);
          return ok();
        }
        return afterRoll(s, p, d);
      }

      case 'go': {
        if (s.phase !== 'omen') return err('Сейчас нельзя');
        s.phase = 'roll';
        return afterRoll(s, p, s.dice, true);
      }

      case 'reroll': {
        if (s.phase !== 'omen') return err('Сейчас нельзя');
        pl.roleUsed = true;
        reveal(s, p, 'шаманский бросок — кубики брошены заново');
        const d = [die(), die()];
        s.dice = d; s.phase = 'roll';
        return afterRoll(s, p, d);
      }

      case 'pickRole': {
        if (s.phase !== 'roles') return err('Роли уже выбраны');
        if (!ROLE[a.role]) return err('Выберите роль');
        pl.role = a.role;
        log(s, `🎭 ${pl.name} выбирает тайную роль`);
        if (s.players.every(q => q.role)) { s.phase = 'roll'; log(s, 'Роли выбраны — игра начинается'); }
        return ok();
      }

      case 'pickCard': {
        if (s.phase !== 'pick2' || !s.choice) return err('Выбирать нечего');
        const k = int(a.k) === 1 ? 1 : 0, ch = s.choice;
        s.decks[ch.deck].push(ch.ids[1 - k]);
        s.choice = null; s.phase = 'moving';
        drawCard(s, p, ch.deck, ch.ids[k]);
        settle(s);
        return ok();
      }

      case 'ability': return useAbility(s, p, a);

      case 'payJail': {
        if (s.phase !== 'roll' || !pl.inJail) return err('Вы не в зимовье');
        if (pl.money < RULES.jailFine) return err('Не хватает денег');
        pl.money -= RULES.jailFine; pl.inJail = false; pl.jailTries = 0;
        log(s, `${pl.name} вызывает вездеход за ${rub(RULES.jailFine)} и выходит из зимовья`);
        return ok();
      }

      case 'useCard': {
        if (s.phase !== 'roll' || !pl.inJail) return err('Вы не в зимовье');
        if (!pl.freeCards.length) return err('Нет карты «Попутный вездеход»');
        const deck = pl.freeCards.shift();
        s.decks[deck].push(DECKS[deck].findIndex(c => c.free));
        pl.inJail = false; pl.jailTries = 0;
        log(s, `${pl.name} уезжает на попутном вездеходе`);
        return ok();
      }

      case 'buy': {
        if (s.phase !== 'buy') return err('Нечего покупать');
        const i = s.pending.cell, c = BOARD[i], cost = price(s, i);
        if (c.type === 'transport' && has(s, p, 'bulchut')) return err('Охотник не покупает транспорт');
        if (pl.money < cost) return err('Не хватает денег');
        pl.money -= cost;
        s.own[i] = { owner: p, houses: 0, mortgaged: false };
        s.pending = null; s.phase = 'moving';
        log(s, `🏠 ${pl.name} покупает ${c.name} за ${rub(cost)}`);
        settle(s);
        return ok();
      }

      case 'decline': {
        if (s.phase !== 'buy') return err('Нечего покупать');
        const i = s.pending.cell;
        log(s, `${pl.name} не покупает ${BOARD[i].name}`);
        startAuction(s, i);
        return ok();
      }

      case 'bid': {
        if (s.phase !== 'auction') return err('Аукциона нет');
        const A = s.auction, amount = int(a.amount);
        if (amount < minBid(s)) return err(`Ставка не меньше ${rub(minBid(s))}`);
        if (amount > pl.money) return err('Не хватает денег');
        if (A.sealed) {
          A.bids[p] = amount;
          log(s, `${pl.name} делает тайную ставку`);
          nextSealed(s);
          return ok();
        }
        A.price = amount; A.leader = p;
        log(s, `${pl.name}: ставка ${rub(amount)}`);
        advanceAuction(s, p);
        return ok();
      }

      case 'pass': {
        if (s.phase !== 'auction') return err('Аукциона нет');
        const A = s.auction;
        if (A.sealed) {
          A.bids[p] = 0;
          log(s, `${pl.name}: пас`);
          nextSealed(s);
          return ok();
        }
        A.bidders = A.bidders.filter(i => i !== p);
        log(s, `${pl.name}: пас`);
        advanceAuction(s, p);
        return ok();
      }

      case 'build': {
        if (s.phase !== 'roll' && s.phase !== 'end') return err('Сейчас строить нельзя');
        if (!canBuild(s, p, a.cell)) return err('Здесь строить нельзя');
        const c = BOARD[a.cell], cost = houseCost(s, c.group, p);
        pl.money -= cost;
        s.own[a.cell].houses++;
        const h = s.own[a.cell].houses;
        log(s, `${pl.name} строит ${h === 5 ? 'отель' : 'дом'}: ${c.name} (−${rub(cost)})`);
        return ok();
      }

      case 'sell': {
        if (!['roll', 'end', 'debt', 'buy'].includes(s.phase)) return err('Сейчас продавать нельзя');
        if (!canSell(s, p, a.cell)) return err('Здесь продавать нельзя');
        const was = s.own[a.cell].houses, gain = sellValue(a.cell, s);
        doSell(s, p, a.cell);
        log(s, `${pl.name} продаёт ${was === 5 ? 'отель' : 'дом'}: ${BOARD[a.cell].name} (+${rub(gain)})`);
        return ok();
      }

      case 'mortgage': {
        if (!['roll', 'end', 'debt', 'buy'].includes(s.phase)) return err('Сейчас закладывать нельзя');
        if (!canMortgage(s, p, a.cell)) {
          const c = BOARD[a.cell];
          return err(c && c.type === 'prop' && groupHasHouses(s, c.group) ? 'Сначала продайте дома в этой группе' : 'Эту клетку заложить нельзя');
        }
        doMortgage(s, p, a.cell);
        log(s, `${pl.name} закладывает ${BOARD[a.cell].name} (+${rub(mortgageValue(a.cell))})`);
        return ok();
      }

      case 'unmortgage': {
        if (s.phase !== 'roll' && s.phase !== 'end') return err('Сейчас выкупать нельзя');
        if (!canUnmortgage(s, p, a.cell)) return err('Не хватает денег на выкуп');
        const cost = unmortgageCost(a.cell);
        pl.money -= cost;
        s.own[a.cell].mortgaged = false;
        log(s, `${pl.name} выкупает ${BOARD[a.cell].name} из залога (−${rub(cost)})`);
        return ok();
      }

      case 'offerTrade': {
        if (s.phase !== 'roll' && s.phase !== 'end') return err('Меняться можно в начале или в конце хода');
        const to = int(a.to);
        if (to === p || !s.players[to] || s.players[to].bankrupt) return err('Выберите игрока');
        const give = normSide(a.give), get = normSide(a.get);
        if (!give.cells.length && !give.money && !give.cards && !get.cells.length && !get.money && !get.cards) return err('Предложение пустое');
        const e = checkSide(s, p, give) || checkSide(s, to, get);
        if (e) return err(e);
        s.offer = { kind: 'trade', from: p, to, give, get, back: s.phase };
        s.phase = 'offer';
        log(s, `🤝 ${pl.name} предлагает ${s.players[to].name} обмен`);
        return ok();
      }

      case 'takeLoan': {
        if (!['roll', 'end', 'debt', 'buy'].includes(s.phase)) return err('Сейчас кредит взять нельзя');
        if (pl.loan) return err('Сначала верните прежний кредит');
        const amount = int(a.amount);
        const from = a.from === BANK || a.from === undefined ? BANK : int(a.from);
        if (from === BANK) {
          if (has(s, p, 'olonkhosut')) return err('Банк не даёт кредит сказителю (ваша роль — Олонхосут)');
          const B = RULES.bankLoan;
          if (amount < B.step || amount > B.max || amount % B.step) return err(`Банк даёт от ${rub(B.step)} до ${rub(B.max)}`);
          pl.money += amount;
          pl.loan = makeLoan(BANK, amount, B.rate, B.laps);
          log(s, `💳 ${pl.name} берёт кредит в банке: ${rub(amount)}, вернуть ${rub(pl.loan.owe)} через ${B.laps} круга`);
          return ok();
        }
        // у игрока — нужно его согласие
        const L = s.players[from];
        if (from === p || !L || L.bankrupt) return err('Выберите игрока');
        const rate = int(a.rate), laps = int(a.laps);
        if (!RULES.loanRates.includes(rate) || !RULES.loanLaps.includes(laps)) return err('Неверные условия');
        if (amount < RULES.loanStep || amount % RULES.loanStep) return err(`Сумма кратна ${rub(RULES.loanStep)}`);
        if (amount > L.money) return err(`У игрока ${L.name} нет столько денег`);
        s.offer = { kind: 'loan', from: p, to: from, amount, rate, laps, back: s.phase };
        s.phase = 'offer';
        log(s, `💳 ${pl.name} просит в долг ${rub(amount)} → ${L.name}`);
        return ok();
      }

      case 'repayLoan': {
        if (s.phase !== 'roll' && s.phase !== 'end') return err('Вернуть кредит можно в начале или в конце хода');
        const L = pl.loan;
        if (!L) return err('Кредита нет');
        if (pl.money < L.owe) return err('Не хватает денег');
        pl.loan = null;
        pay(s, p, L.from, L.owe, L.from === BANK ? L.owe - L.principal : 0);
        log(s, `${pl.name} досрочно возвращает кредит: ${rub(L.owe)} → ${nameOf(s, L.from)}`);
        return ok();
      }

      case 'accept': case 'reject': {
        if (s.phase !== 'offer') return err('Предложений нет');
        const o = s.offer, A = s.players[o.from];
        if (a.type === 'accept') {
          if (o.kind === 'trade') {
            const e = checkSide(s, o.from, o.give) || checkSide(s, o.to, o.get) || applyTrade(s, o);
            if (e) return err(e);
            log(s, `🤝 Обмен: ${A.name} отдаёт ${describeSide(s, o.give)}; ${pl.name} отдаёт ${describeSide(s, o.get)}`);
          } else {
            if (A.loan) return err(`У игрока ${A.name} уже есть кредит`);
            if (pl.money < o.amount) return err('Не хватает денег');
            pl.money -= o.amount; A.money += o.amount;
            A.loan = makeLoan(o.to, o.amount, o.rate, o.laps);
            log(s, `💳 ${pl.name} даёт в долг ${rub(o.amount)} → ${A.name}, вернуть ${rub(A.loan.owe)} через ${o.laps} ${o.laps === 1 ? 'круг' : 'круга'}`);
          }
        } else {
          log(s, `${pl.name} отказывается`);
        }
        s.phase = o.back; s.offer = null;
        return ok();
      }

      case 'payDebt': {
        if (s.phase !== 'debt') return err('Долга нет');
        const d = s.pending;
        if (pl.money < d.amount) return err('Всё ещё не хватает денег');
        s.pending = null; s.phase = 'moving';
        pay(s, p, d.to, d.amount, d.prize);
        log(s, `${pl.name} платит ${rub(d.amount)} (${d.reason})`);
        if (d.after) runAfter(s, d.after);
        settle(s);
        return ok();
      }

      case 'bankrupt': {
        if (s.phase !== 'debt') return err('Банкротство объявляют, только если не хватает на долг');
        bankrupt(s, p, creditorOf(s.pending.to));
        return ok();
      }

      case 'endTurn': {
        if (s.phase !== 'end') return err('Ход ещё не закончен');
        nextTurn(s);
        return ok();
      }
    }
    return err('Неизвестное действие');
  }

  const ok = () => ({ ok: true });
  const err = e => ({ ok: false, error: e });

  const Engine = {
    create, migrate, act, actor, rentFor, netWorth, canBuild, canSell, ownsGroup, groupCells, groupHasHouses,
    liquidValue, sellValue, mortgageValue, mortgageFee, unmortgageCost, canMortgage, canUnmortgage,
    canTradeCell, minBid, describeSide, rub, BANK, PRIZE,
    price, houseCost, taxOf, baseRent, up, normRules, RULE_DEFAULTS, GROW_EVERY,
    canAbility, ROLE, ROLES,
    setRandom(fn) { rand = fn; },
  };
  root.BAAI = root.BAAI || {};
  root.BAAI.engine = Engine;
  if (typeof module !== 'undefined') module.exports = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
