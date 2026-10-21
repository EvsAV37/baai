/* «Баай» — боты. Решают по простым правилам:
   держат запас денег, покупают клетки для групп, на аукционе не выше цены клетки,
   строят при полной группе, соглашаются только на выгодный обмен, пользуются ролью.
   decide(state, игрок) возвращает действие для engine.act — сам ничего не меняет.
   Работает и в браузере, и в Node (tests/bots.js).
   © 2026 Евсеев А.В. */
(function (root) {
  'use strict';

  const D = (typeof module !== 'undefined') ? require('./data.js') : root.BAAI.data;
  const E = (typeof module !== 'undefined') ? require('./engine.js') : root.BAAI.engine;
  const { BOARD, GROUPS, BAYANAI, RULES, ROLES } = D;
  const OWNABLE = BOARD.map((c, i) => i).filter(i => ['prop', 'transport', 'utility'].includes(BOARD[i].type));
  const TRANSPORT = [5, 15, 25, 35];

  // Имена ботов — якутские
  const NAMES = ['Айаал', 'Сардаана', 'Мичил', 'Туйаара', 'Нюргун', 'Кюннэй'];

  let rand = Math.random;
  const R10 = n => Math.floor(n / 10) * 10;
  const mine = (s, p) => Object.keys(s.own).map(Number).filter(i => s.own[i].owner === p);
  const alive = s => s.players.map((_, i) => i).filter(i => !s.players[i].bankrupt);
  const groupPrice = (s, g) => E.groupCells(g).reduce((n, i) => n + E.price(s, i), 0);

  // Запас денег: чем дороже чужая аренда на поле, тем больше держим
  function reserve(s, p) {
    let top = 0;
    for (const k in s.own) {
      const o = s.own[k];
      if (o.owner === p || o.mortgaged) continue;
      const c = BOARD[k];
      top = Math.max(top, c.type === 'utility' ? E.rentFor(s, k, { diceSum: 8 }) : E.rentFor(s, k));
    }
    return Math.max(100, Math.min(600, Math.round(100 + top * 0.4)));
  }

  // ---------- оценка имущества ----------
  // own — карта владения (можно подставить «после обмена»)
  function fullGroups(own, p) {
    const out = [];
    for (const g in GROUPS) if (E.groupCells(+g).every(i => own[i] && own[i].owner === p)) out.push(+g);
    return out;
  }

  // Во сколько бот ценит своё имущество: цены клеток, бонус за полные группы и за транспорт
  function score(s, own, p) {
    let v = 0, tr = 0, near = 0;
    for (const k in own) {
      const o = own[k];
      if (o.owner !== p) continue;
      const pr = E.price(s, k);
      v += o.mortgaged ? pr - E.unmortgageCost(k) : pr;
      if (BOARD[k].type === 'transport') tr++;
    }
    fullGroups(own, p).forEach(g => { v += groupPrice(s, g) * 0.8; });
    // почти собранная группа (не хватает одной клетки, которая у банка или у нас) — тоже ценность
    for (const g in GROUPS) {
      const cells = E.groupCells(+g), have = cells.filter(i => own[i] && own[i].owner === p).length;
      if (have === cells.length - 1 && have > 0) near += groupPrice(s, +g) * 0.2;
    }
    if (tr > 1) v += (tr - 1) * 60;
    return v + near;
  }

  // Что будет, если клетка i станет моей: собирает ли группу
  function completes(s, p, i) {
    const c = BOARD[i];
    if (c.type !== 'prop') return false;
    return E.groupCells(c.group).every(j => j === i || (s.own[j] && s.own[j].owner === p));
  }

  // Клетка мешает сопернику собрать группу (у него все остальные)
  function blocks(s, p, i) {
    const c = BOARD[i];
    if (c.type !== 'prop') return false;
    const others = E.groupCells(c.group).filter(j => j !== i);
    const o0 = s.own[others[0]];
    return !!o0 && o0.owner !== p && others.every(j => s.own[j] && s.own[j].owner === o0.owner);
  }

  const isBulchutTr = (s, p, i) => s.players[p].role === 'bulchut' && BOARD[i].type === 'transport';

  // Что можно заложить, не трогая нужную группу. Сначала то, что не входит в полные группы, дешёвое
  function mortgageList(s, p, keepGroup) {
    const full = fullGroups(s.own, p);
    return mine(s, p).filter(i => E.canMortgage(s, p, i) && !(BOARD[i].type === 'prop' && BOARD[i].group === keepGroup))
      .sort((a, b) => {
        const fa = BOARD[a].type === 'prop' && full.includes(BOARD[a].group) ? 1 : 0;
        const fb = BOARD[b].type === 'prop' && full.includes(BOARD[b].group) ? 1 : 0;
        return fa - fb || BOARD[a].price - BOARD[b].price;
      });
  }

  // ---------- карточки на выбор (Булчут) ----------
  function cardScore(s, p, id) {
    const c = BAYANAI[id], pl = s.players[p];
    const others = alive(s).length - 1;
    if (c.money) return c.money;
    if (c.free) return 60;
    if (c.each) return c.each * others;
    if (c.jail) return unownedCount(s) > 6 ? -150 : 30;
    if (c.repairs) {
      let h = 0, ht = 0;
      mine(s, p).forEach(i => { const n = s.own[i].houses; if (n === 5) ht++; else h += n; });
      return -(h * c.repairs[0] + ht * c.repairs[1]);
    }
    if (c.moveTo !== undefined) return (c.moveTo < pl.pos ? 200 : 0) - landRisk(s, p, c.moveTo);
    if (c.back) return -landRisk(s, p, (pl.pos + 37) % 40);
    if (c.nearest) return -40;
    return 0;
  }

  // Сколько, скорее всего, придётся заплатить на клетке
  function landRisk(s, p, i) {
    const o = s.own[i], c = BOARD[i];
    if (c.type === 'tax') return E.taxOf(s, i);
    if (!o || o.owner === p || o.mortgaged) return 0;
    return c.type === 'utility' ? E.rentFor(s, i, { diceSum: 7 }) : E.rentFor(s, i);
  }

  const unownedCount = s => OWNABLE.filter(i => !s.own[i]).length;

  // ---------- обмен ----------
  // Насколько обмен выгоден игроку x: получает cells in и деньги money, отдаёт cells out игроку y
  function tradeValue(s, x, y, cellsIn, cellsOut, money) {
    const after = {};
    for (const k in s.own) after[k] = Object.assign({}, s.own[k]);
    cellsIn.forEach(i => { after[i].owner = x; });
    cellsOut.forEach(i => { after[i].owner = y; });
    let v = score(s, after, x) - score(s, s.own, x) + money;
    if (s.players[x].role !== 'atyyhyt') v -= cellsIn.reduce((n, i) => n + (s.own[i].mortgaged ? E.mortgageFee(i) : 0), 0);
    // не дарим сопернику полную группу
    const had = fullGroups(s.own, y);
    v -= fullGroups(after, y).filter(g => !had.includes(g)).reduce((n, g) => n + groupPrice(s, g) * 0.8, 0);
    return v;
  }

  const GOOD = 25;   // на сколько обмен должен быть выгоднее, чтобы бот согласился

  function judgeTrade(s, p, o) {
    // p — тот, кому предложили (o.to). Получает o.give, отдаёт o.get
    if (o.give.cells.some(i => isBulchutTr(s, p, i))) return false;
    const money = o.give.money - o.get.money + (o.give.cards - o.get.cards) * 50;
    const moneyAfter = s.players[p].money + o.give.money - o.get.money;
    return tradeValue(s, p, o.from, o.give.cells, o.get.cells, money) >= GOOD && moneyAfter >= 50;
  }

  function judgeLoan(s, p, o) {
    const pl = s.players[p], owe = Math.round(o.amount * (1 + o.rate / 100));
    if (o.amount > pl.money - reserve(s, p) - 50) return false;
    if (o.rate < 20 && o.laps > 1) return false;
    return E.netWorth(s, o.from) >= owe * 1.5;
  }

  // ---------- бот сам предлагает обмен ----------
  // Не хватает одной клетки до группы. Людям предлагаем деньги (щедро),
  // ботам — клетку на клетку с доплатой, если обоим выгодно. Не чаще раза за круг.
  const askedBy = new WeakMap();   // своя память на каждую партию
  function proposeTrade(s, p) {
    const pl = s.players[p], key = `${p}:${s.round}`;
    if (!askedBy.has(s)) askedBy.set(s, new Set());
    const asked = askedBy.get(s);
    if (asked.has(key) || s.phase !== 'end') return null;
    asked.add(key);
    const res = reserve(s, p);
    let best = null, bestV = 0;
    // людям — только последнюю клетку группы, за деньги
    for (const g in GROUPS) {
      const cells = E.groupCells(+g);
      const missing = cells.filter(i => !(s.own[i] && s.own[i].owner === p));
      if (missing.length !== 1) continue;
      const i = missing[0], o = s.own[i];
      if (!o || s.players[o.owner].bot || s.players[o.owner].bankrupt || !E.canTradeCell(s, o.owner, i)) continue;
      const offer = R10(E.price(s, i) * (1.6 + rand() * 0.4));
      if (pl.money - offer < res) continue;
      const v = tradeValue(s, p, o.owner, [i], [], -offer);
      if (v > bestV) { bestV = v; best = { to: o.owner, give: { cells: [], money: offer, cards: 0 }, get: { cells: [i], money: 0, cards: 0 } }; }
    }
    // ботам — любую клетку из группы, где у нас уже что-то есть: клетка на клетку и/или доплата
    const myCells = mine(s, p).filter(j => E.canTradeCell(s, p, j));
    const myGroups = new Set(myCells.filter(j => BOARD[j].type === 'prop').map(j => BOARD[j].group));
    for (const k in s.own) {
      const i = +k, o = s.own[i], q = o.owner, c = BOARD[i];
      if (q === p || !s.players[q].bot || s.players[q].bankrupt || c.type !== 'prop' || !myGroups.has(c.group) || !E.canTradeCell(s, q, i)) continue;
      for (const j of [null].concat(myCells)) {
        if (j !== null && (isBulchutTr(s, q, j) || (BOARD[j].type === 'prop' && BOARD[j].group === c.group))) continue;
        const out = j === null ? [] : [j];
        const their = tradeValue(s, q, p, out, [i], 0);
        const m = Math.max(0, Math.ceil((GOOD + 10 - their) / 10) * 10);   // доплата, чтобы боту было выгодно
        if (pl.money - m < res) continue;
        // богатый бот готов переплатить за клетку, собирающую группу: лишние деньги без групп ничего не приносят
        const slack = completes(s, p, i) ? Math.max(0, (pl.money - 3 * res) * 0.25) : 0;
        const v = tradeValue(s, p, q, [i], out, -m) + slack;
        if (v >= GOOD && v > bestV) { bestV = v; best = { to: q, give: { cells: out, money: m, cards: 0 }, get: { cells: [i], money: 0, cards: 0 } }; }
      }
    }
    return best ? Object.assign({ type: 'offerTrade' }, best) : null;
  }

  // ---------- способности ролей ----------
  function useRole(s, p) {
    const pl = s.players[p];
    if (!E.canAbility(s, p)) return null;
    const res = reserve(s, p);
    switch (pl.role) {
      case 'olonkhosut': return s.prize >= 150 ? { type: 'ability' } : null;
      case 'toyon': return s.round >= 3 && alive(s).length >= 3 ? { type: 'ability' } : null;
      case 'bulchut': {
        const strong = mine(s, p).some(i => s.own[i].houses > 0) || fullGroups(s.own, p).length > 0;
        return strong ? { type: 'ability' } : null;
      }
      case 'uus': {
        const cells = mine(s, p).filter(i => {
          const o = s.own[i], c = BOARD[i];
          return c.type === 'prop' && !o.mortgaged && !o.houses && !E.ownsGroup(s, p, c.group)
            && !E.groupCells(c.group).some(j => s.own[j] && s.own[j].mortgaged);
        }).sort((a, b) => BOARD[b].price - BOARD[a].price);
        if (!cells.length) return null;
        const cost = E.houseCost(s, BOARD[cells[0]].group, p);
        return pl.money - cost >= res + 100 ? { type: 'ability', cell: cells[0] } : null;
      }
      case 'kayur': {
        if (s.phase !== 'roll') return null;
        const free = TRANSPORT.filter(i => i !== pl.pos && !s.own[i] && pl.money - E.price(s, i) >= res);
        return free.length ? { type: 'ability', cell: free[Math.floor(rand() * free.length)] } : null;
      }
    }
    return null;
  }

  // ---------- спокойная часть хода: строим, выкупаем, возвращаем долг ----------
  function manage(s, p) {
    const pl = s.players[p], res = reserve(s, p);
    const role = useRole(s, p);
    if (role) return role;
    if (pl.loan && pl.money - pl.loan.owe >= res + 100) return { type: 'repayLoan' };
    // выкуп: сначала клетки полных групп
    const full = fullGroups(s.own, p);
    const un = mine(s, p).filter(i => s.own[i].mortgaged && E.canUnmortgage(s, p, i) && pl.money - E.unmortgageCost(i) >= res + 50)
      .sort((a, b) => (full.includes(BOARD[b].group) ? 1 : 0) - (full.includes(BOARD[a].group) ? 1 : 0));
    if (un.length) return { type: 'unmortgage', cell: un[0] };
    // стройка: где прибавка аренды на рубль больше
    let best = null, bestGain = 0;
    mine(s, p).forEach(i => {
      if (!E.canBuild(s, p, i)) return;
      const c = BOARD[i], cost = E.houseCost(s, c.group, p);
      if (pl.money - cost < res) return;
      const h = s.own[i].houses;
      const gain = (E.baseRent(s, i, h + 1, true) - E.baseRent(s, i, h, true)) / cost;
      if (gain > bestGain) { bestGain = gain; best = i; }
    });
    if (best !== null) return { type: 'build', cell: best };
    return null;
  }

  // ---------- главное: что делать сейчас ----------
  function decide(s, p) {
    const pl = s.players[p];
    if (pl.bankrupt) return { type: 'endTurn' };
    const res = reserve(s, p);
    switch (s.phase) {
      case 'roles': return { type: 'pickRole', role: ROLES[Math.floor(rand() * ROLES.length)].id };

      case 'omen': {
        const d = s.dice, to = (pl.pos + d[0] + d[1]) % 40;
        const risk = landRisk(s, p, to);
        return { type: risk > 100 || risk > pl.money * 0.3 ? 'reroll' : 'go' };
      }

      case 'pick2': {
        const ids = s.choice.ids;
        return { type: 'pickCard', k: cardScore(s, p, ids[1]) > cardScore(s, p, ids[0]) ? 1 : 0 };
      }

      case 'auction': {
        const A = s.auction, i = A.cell, worth = E.price(s, i);
        const want = completes(s, p, i) || blocks(s, p, i);
        const spare = pl.money - res * (want ? 0.3 : 0.8);
        const cap = R10(Math.min(worth, spare));
        if (pl.role === 'atyyhyt' && E.canAbility(s, p) && A.start <= spare && (want || worth >= 200)) return { type: 'ability' };
        if (A.sealed) {
          if (cap < A.start) return { type: 'pass' };
          const bid = Math.max(A.start, R10(cap * (want ? 0.95 : 0.7 + rand() * 0.2)));
          return { type: 'bid', amount: Math.min(bid, pl.money) };
        }
        const need = E.minBid(s);
        if (A.leader === p) return { type: 'pass' };   // не бывает, но на всякий случай
        return need <= cap && need <= pl.money ? { type: 'bid', amount: need } : { type: 'pass' };
      }

      case 'offer': {
        const o = s.offer;
        const yes = o.kind === 'trade' ? judgeTrade(s, p, o) : judgeLoan(s, p, o);
        return { type: yes ? 'accept' : 'reject' };
      }

      case 'buy': {
        const i = s.pending.cell, cost = E.price(s, i);
        if (isBulchutTr(s, p, i)) return { type: 'decline' };
        const want = completes(s, p, i) || blocks(s, p, i);
        if (pl.money - cost >= res) return { type: 'buy' };
        if (want) {
          if (pl.money >= cost + 20) return { type: 'buy' };
          // не хватает на клетку, собирающую группу — закладываем лишнее
          const m = mortgageList(s, p, BOARD[i].group);
          const can = m.reduce((n, j) => n + E.mortgageValue(j), 0);
          if (pl.money + can >= cost + 20 && m.length) return { type: 'mortgage', cell: m[0] };
        }
        return { type: 'decline' };
      }

      case 'debt': {
        const need = s.pending.amount;
        if (pl.money >= need) return { type: 'payDebt' };
        // продаём дома с самых дешёвых групп
        const sell = mine(s, p).filter(i => E.canSell(s, p, i)).sort((a, b) => GROUPS[BOARD[a].group].house - GROUPS[BOARD[b].group].house);
        if (sell.length) return { type: 'sell', cell: sell[0] };
        const m = mortgageList(s, p, null);
        if (m.length) return { type: 'mortgage', cell: m[0] };
        if (!pl.loan && pl.role !== 'olonkhosut') {
          const amt = Math.ceil((need - pl.money) / 100) * 100;
          if (amt <= RULES.bankLoan.max) return { type: 'takeLoan', from: E.BANK, amount: Math.max(100, amt) };
        }
        return { type: 'bankrupt' };
      }

      case 'roll': {
        if (pl.inJail) {
          const early = unownedCount(s) > 6;
          if (early || pl.role === 'kayur') {
            if (pl.freeCards.length) return { type: 'useCard' };
            if (pl.money - RULES.jailFine >= res) return { type: 'payJail' };
          }
          return { type: 'roll' };
        }
        return manage(s, p) || { type: 'roll' };
      }

      case 'end':
        return manage(s, p) || proposeTrade(s, p) || { type: 'endTurn' };
    }
    return null;
  }

  // Если движок отказал — безопасный ход, чтобы партия не встала
  function fallback(s) {
    switch (s.phase) {
      case 'auction': return { type: 'pass' };
      case 'offer': return { type: 'reject' };
      case 'buy': return { type: 'decline' };
      case 'roll': return { type: 'roll' };
      case 'end': return { type: 'endTurn' };
      case 'omen': return { type: 'go' };
      case 'pick2': return { type: 'pickCard', k: 0 };
      case 'roles': return { type: 'pickRole', role: ROLES[0].id };
      case 'debt': return { type: 'bankrupt' };
    }
    return null;
  }

  // Сделать ход бота: решить, применить, при отказе — запасной ход. Возвращает действие или null
  function step(s, applyFn) {
    const p = E.actor(s);
    if (!s.players[p] || !s.players[p].bot || s.phase === 'over') return null;
    const a = decide(s, p);
    if (a) {
      a.player = p;
      const r = applyFn(a);
      if (r && r.ok) return a;
    }
    const f = fallback(s);
    if (!f) return null;
    f.player = p;
    applyFn(f);
    return f;
  }

  // Пауза перед ходом бота: дать посмотреть, что происходит
  function delay(s, lastAction) {
    if (lastAction && (lastAction.type === 'roll' || lastAction.type === 'reroll' || lastAction.type === 'go') && s.dice) {
      return 1500 + (s.dice[0] + s.dice[1]) * 190;
    }
    if (s.phase === 'auction' || s.phase === 'offer') return 1100;
    return 850;
  }

  const Bot = { decide, fallback, step, delay, reserve, judgeTrade, NAMES, setRandom(fn) { rand = fn; } };
  root.BAAI = root.BAAI || {};
  root.BAAI.bot = Bot;
  if (typeof module !== 'undefined') module.exports = Bot;
})(typeof window !== 'undefined' ? window : globalThis);
