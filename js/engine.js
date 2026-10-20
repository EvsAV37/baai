/* «Баай» — движок правил.
   Состояние партии — обычный JSON-объект. Меняется только через act(state, action).
   Экран (ui.js) ничего не считает сам: он рисует state и отправляет действия.
   На этапе 3 этот же файл будет работать у хоста, а гости будут слать ему действия.
   © 2026 Евсеев А.В. */
(function (root) {
  'use strict';

  const D = (typeof module !== 'undefined') ? require('./data.js') : root.BAAI.data;
  const { BOARD, GROUPS, BAYANAI, TYUSYULGE, RULES } = D;
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

  // ---------- создание партии ----------
  function create(players, options = {}) {
    const minutes = Number(options.minutes) || 0;
    return migrate({
      v: 2,
      players: players.map(p => ({
        name: p.name, color: p.color, figure: p.figure || 'horse',
        money: RULES.startMoney, pos: 0,
        inJail: false, jailTries: 0, freeCards: [], bankrupt: false,
        loan: null,            // { from, principal, owe, laps, due }
      })),
      own: {},                 // номер клетки → { owner, houses, mortgaged } (5 домов = отель)
      turn: 0,
      phase: 'roll',           // roll | buy | auction | offer | end | debt | over
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
    s.prize = s.prize || 0;
    s.auction = s.auction || null;
    s.auctionQueue = s.auctionQueue || [];
    s.offer = s.offer || null;
    s.players.forEach(p => { if (p.loan === undefined) p.loan = null; });
    for (const k in s.own) if (s.own[k].mortgaged === undefined) s.own[k].mortgaged = false;
    return s;
  }

  // ---------- вспомогательное ----------
  const cur = s => s.players[s.turn];
  const nameOf = (s, i) => i === BANK ? 'банк' : i === PRIZE ? 'Приз Ысыаха' : (i === 'each' ? 'игрокам' : s.players[i].name);
  const alive = s => s.players.map((_, i) => i).filter(i => !s.players[i].bankrupt);

  // Кто сейчас должен действовать
  function actor(s) {
    if (s.phase === 'auction' && s.auction) return s.auction.at;
    if (s.phase === 'offer' && s.offer) return s.offer.to;
    return s.turn;
  }

  function log(s, text) {
    s.log.push(text);
    if (s.log.length > 120) s.log.splice(0, s.log.length - 120);
  }

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

  function rentFor(s, i, opts = {}) {
    const c = BOARD[i], o = s.own[i];
    if (!o || o.mortgaged) return 0;
    if (c.type === 'prop') {
      if (o.houses > 0) return c.rent[o.houses];
      return c.rent[0] * (ownsGroup(s, o.owner, c.group) ? 2 : 1);
    }
    if (c.type === 'transport') {
      return RULES.transportRent[countOwned(s, o.owner, 'transport')] * (opts.mult || 1);
    }
    if (c.type === 'utility') {
      const sum = opts.diceSum || (s.dice ? s.dice[0] + s.dice[1] : 7);
      const mult = opts.force10 ? 10 : RULES.utilityMult[countOwned(s, o.owner, 'utility')];
      return sum * mult;
    }
    return 0;
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
      w += o.mortgaged ? c.price - mortgageValue(k) : c.price;
      if (c.type === 'prop') w += o.houses * GROUPS[c.group].house;
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
    return o.houses === min && s.players[p].money >= GROUPS[c.group].house;
  }

  function canSell(s, p, i) {
    const c = BOARD[i], o = s.own[i];
    if (!c || c.type !== 'prop' || !o || o.owner !== p || o.houses === 0) return false;
    const max = Math.max(...groupCells(c.group).map(j => s.own[j].houses));
    return o.houses === max;
  }

  function sellValue(i) { return Math.floor(GROUPS[BOARD[i].group].house * RULES.sellRate); }

  function doSell(s, p, i) {
    s.own[i].houses--;
    s.players[p].money += sellValue(i);
  }

  // Сколько игрок может собрать: продать все дома и заложить все клетки
  function liquidValue(s, p) {
    let v = s.players[p].money;
    for (const k in s.own) {
      const o = s.own[k];
      if (o.owner !== p) continue;
      if (BOARD[k].type === 'prop') v += o.houses * sellValue(k);
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
      if (prize) s.prize += Math.min(prize, amount);
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
      if (BOARD[k].type === 'prop' && o.houses) { pl.money += o.houses * sellValue(k); o.houses = 0; }
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
        if (o.mortgaged) { log(s, `${c.name} в залоге — аренда не берётся`); return; }
        const rent = rentFor(s, i, opts);
        charge(s, p, o.owner, rent, `аренда: ${c.name} → ${s.players[o.owner].name}`);
        return;
      }
      case 'tax':
        charge(s, p, PRIZE, c.amount, `${c.name} → в Приз Ысыаха`);
        return;
      case 'parking':
        if (s.prize > 0) {
          pl.money += s.prize;
          log(s, `🎉 ${pl.name} получает Приз Ысыаха: ${rub(s.prize)}`);
          s.prize = 0;
        }
        return;
      case 'bayanai': case 'tyusyulge':
        drawCard(s, p, c.type);
        return;
      case 'gotojail':
        sendToJail(s, p);
        return;
      default:
        return;
    }
  }

  function drawCard(s, p, deck) {
    const id = s.decks[deck].shift();
    const card = DECKS[deck][id];
    if (!card.free) s.decks[deck].push(id);
    s.card = { deck, title: DECK_NAMES[deck], text: card.text, seq: s.seq + 1, player: p };
    log(s, `${DECK_NAMES[deck]}: ${card.text}`);
    const pl = s.players[p];

    if (card.money > 0) { pl.money += card.money; return; }
    if (card.money < 0) { charge(s, p, BANK, -card.money, DECK_NAMES[deck]); return; }
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
      charge(s, p, 'each', -card.each * n, DECK_NAMES[deck]);
      return;
    }
    if (card.repairs) {
      let h = 0, hot = 0;
      for (const k in s.own) {
        const o = s.own[k];
        if (o.owner !== p || BOARD[k].type !== 'prop') continue;
        if (o.houses === 5) hot++; else h += o.houses;
      }
      charge(s, p, BANK, h * card.repairs[0] + hot * card.repairs[1], DECK_NAMES[deck]);
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

  // Продолжение после оплаты долга
  function runAfter(s, after) {
    if (after && after.move) moveBy(s, s.turn, after.move);
  }

  // Ход закончен или можно бросать ещё раз
  function settle(s) {
    if (['buy', 'debt', 'over', 'auction', 'offer'].includes(s.phase)) return;
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
    s.turn = t; s.phase = 'roll'; s.doubles = 0; s.extra = false; s.dice = null; s.pending = null;
    log(s, `— Ход: ${s.players[t].name}`);
  }

  function finishByTime(s) {
    let best = null, bw = -Infinity;
    alive(s).forEach(i => { const w = netWorth(s, i); if (w > bw) { bw = w; best = i; } });
    s.phase = 'over'; s.winner = best; s.overReason = 'time'; s.pending = null;
    log(s, `⏰ Время вышло. Самый богатый: ${s.players[best].name} (${rub(bw)})`);
  }

  // ---------- аукцион ----------
  function startAuction(s, cell) {
    const start = Math.max(RULES.bidStep, Math.floor(BOARD[cell].price * RULES.auctionStart));
    s.auction = { cell, start, price: 0, leader: null, bidders: alive(s), at: null };
    s.phase = 'auction'; s.pending = null;
    log(s, `🔨 Аукцион: ${BOARD[cell].name}, торги с ${rub(start)}`);
    advanceAuction(s, s.turn);
  }

  function minBid(s) {
    const A = s.auction;
    return A.leader === null ? A.start : A.price + RULES.bidStep;
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
  const tradeFee = (s, cells) => cells.reduce((n, i) => n + (s.own[i].mortgaged ? mortgageFee(i) : 0), 0);

  function applyTrade(s, o) {
    const A = s.players[o.from], B = s.players[o.to];
    const feeA = tradeFee(s, o.get.cells), feeB = tradeFee(s, o.give.cells);
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
        const dbl = d[0] === d[1], sum = d[0] + d[1];
        log(s, `🎲 ${pl.name}: ${d[0]} + ${d[1]}${dbl ? ' — дубль!' : ''}`);

        if (pl.inJail) {
          if (dbl) {
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
        const i = s.pending.cell, c = BOARD[i];
        if (pl.money < c.price) return err('Не хватает денег');
        pl.money -= c.price;
        s.own[i] = { owner: p, houses: 0, mortgaged: false };
        s.pending = null; s.phase = 'moving';
        log(s, `🏠 ${pl.name} покупает ${c.name} за ${rub(c.price)}`);
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
        A.price = amount; A.leader = p;
        log(s, `${pl.name}: ставка ${rub(amount)}`);
        advanceAuction(s, p);
        return ok();
      }

      case 'pass': {
        if (s.phase !== 'auction') return err('Аукциона нет');
        const A = s.auction;
        A.bidders = A.bidders.filter(i => i !== p);
        log(s, `${pl.name}: пас`);
        advanceAuction(s, p);
        return ok();
      }

      case 'build': {
        if (s.phase !== 'roll' && s.phase !== 'end') return err('Сейчас строить нельзя');
        if (!canBuild(s, p, a.cell)) return err('Здесь строить нельзя');
        const c = BOARD[a.cell], cost = GROUPS[c.group].house;
        pl.money -= cost;
        s.own[a.cell].houses++;
        const h = s.own[a.cell].houses;
        log(s, `${pl.name} строит ${h === 5 ? 'отель' : 'дом'}: ${c.name} (−${rub(cost)})`);
        return ok();
      }

      case 'sell': {
        if (!['roll', 'end', 'debt', 'buy'].includes(s.phase)) return err('Сейчас продавать нельзя');
        if (!canSell(s, p, a.cell)) return err('Здесь продавать нельзя');
        const was = s.own[a.cell].houses;
        doSell(s, p, a.cell);
        log(s, `${pl.name} продаёт ${was === 5 ? 'отель' : 'дом'}: ${BOARD[a.cell].name} (+${rub(sellValue(a.cell))})`);
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
    setRandom(fn) { rand = fn; },
  };
  root.BAAI = root.BAAI || {};
  root.BAAI.engine = Engine;
  if (typeof module !== 'undefined') module.exports = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
