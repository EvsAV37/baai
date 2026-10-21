// Автопрогон партий случайными «ботами»: проверяем, что движок не ломается.
// Боты покупают, торгуются на аукционах, строят, закладывают, меняются и берут кредиты.
// Запуск: node tests/sim.js
const E = require('../js/engine.js');
const D = require('../js/data.js');
const { BOARD } = D;
const R = Math.random;
const pick = a => a[Math.floor(R() * a.length)];
const cells = () => BOARD.map((_, i) => i);
const stat = { games: 0, finished: 0, byTime: 0, errors: 0, turns: 0, auctions: 0, auctionWins: 0, trades: 0, loans: 0, mortgages: 0, prizes: 0 };

function bot(s) {
  const p = E.actor(s), pl = s.players[p];
  const mine = cells().filter(i => s.own[i] && s.own[i].owner === p);
  switch (s.phase) {
    case 'auction': {
      const A = s.auction, need = E.minBid(s), worth = E.price(s, A.cell);
      if (need <= pl.money && need <= worth * (0.6 + R() * 0.7) && R() < 0.75) {
        return { type: 'bid', amount: Math.min(pl.money, need + pick([0, 0, 40, 90])) };
      }
      return { type: 'pass' };
    }
    case 'offer':
      return { type: R() < 0.5 ? 'accept' : 'reject' };
    case 'roll': case 'end': {
      const r = R();
      if (r < 0.03 && !pl.loan) {
        const others = s.players.map((_, i) => i).filter(i => i !== p && !s.players[i].bankrupt);
        if (R() < 0.5) return { type: 'takeLoan', from: E.BANK, amount: pick([100, 200, 300, 400, 500]) };
        const to = pick(others);
        return { type: 'takeLoan', from: to, amount: 50 * (1 + Math.floor(R() * 6)), rate: pick(D.RULES.loanRates), laps: pick(D.RULES.loanLaps) };
      }
      if (r < 0.05 && pl.loan && pl.money > pl.loan.owe + 200) return { type: 'repayLoan' };
      if (r < 0.08) {
        const others = s.players.map((_, i) => i).filter(i => i !== p && !s.players[i].bankrupt);
        const to = pick(others);
        const theirs = cells().filter(i => E.canTradeCell(s, to, i));
        const ours = mine.filter(i => E.canTradeCell(s, p, i));
        return {
          type: 'offerTrade', to,
          give: { cells: ours.filter(() => R() < 0.3), money: R() < 0.4 ? Math.floor(R() * pl.money / 2) : 0, cards: pl.freeCards.length && R() < 0.3 ? 1 : 0 },
          get: { cells: theirs.filter(() => R() < 0.3), money: R() < 0.3 ? Math.floor(R() * s.players[to].money / 3) : 0 },
        };
      }
      if (r < 0.1) {
        const un = mine.filter(i => E.canUnmortgage(s, p, i));
        if (un.length && pl.money > 400) return { type: 'unmortgage', cell: un[0] };
      }
      if (s.phase === 'roll') {
        if (pl.inJail && pl.freeCards.length && R() < 0.5) return { type: 'useCard' };
        if (pl.inJail && pl.money >= 50 && R() < 0.5) return { type: 'payJail' };
        return { type: 'roll' };
      }
      const can = cells().filter(i => E.canBuild(s, p, i));
      if (can.length && pl.money > 300 && R() < 0.7) return { type: 'build', cell: can[0] };
      return { type: 'endTurn' };
    }
    case 'buy': {
      const price = E.price(s, s.pending.cell);
      if (pl.money < price && R() < 0.3) {
        const m = mine.filter(i => E.canMortgage(s, p, i));
        if (m.length) return { type: 'mortgage', cell: m[0] };
      }
      return { type: pl.money >= price && R() < 0.7 ? 'buy' : 'decline' };
    }
    case 'debt': {
      if (pl.money >= s.pending.amount) return { type: 'payDebt' };
      const sell = cells().filter(i => E.canSell(s, p, i));
      if (sell.length) return { type: 'sell', cell: sell[0] };
      const m = mine.filter(i => E.canMortgage(s, p, i));
      if (m.length) return { type: 'mortgage', cell: m[0] };
      if (!pl.loan && R() < 0.5) return { type: 'takeLoan', from: E.BANK, amount: 500 };
      return { type: 'bankrupt' };
    }
  }
  throw new Error('bad phase ' + s.phase);
}

function check(s) {
  s.players.forEach((q, i) => {
    if (!Number.isInteger(q.money) || (q.money < 0 && !q.bankrupt)) throw new Error('money ' + i + ' ' + q.money);
    if (q.pos < 0 || q.pos > 39) throw new Error('pos');
    if (q.bankrupt && q.loan) throw new Error('bankrupt with loan');
    if (q.loan) {
      if (q.loan.from === i) throw new Error('loan from self');
      if (q.loan.from !== E.BANK && s.players[q.loan.from].bankrupt) throw new Error('loan from bankrupt');
    }
  });
  if (!Number.isInteger(s.prize) || s.prize < 0) throw new Error('prize');
  for (const k in s.own) {
    const o = s.own[k], c = BOARD[k];
    if (s.players[o.owner].bankrupt) throw new Error('owner bankrupt');
    if (o.mortgaged && o.houses) throw new Error('houses on mortgaged');
    if (c.type === 'prop' && o.houses && E.groupCells(c.group).some(j => s.own[j].mortgaged)) throw new Error('houses in mortgaged group');
  }
  for (const i of s.auctionQueue) if (s.own[i]) throw new Error('queued cell owned');
  if (s.phase === 'auction' && (!s.auction || s.auction.at === null || s.players[s.auction.at].bankrupt)) throw new Error('auction state');
  for (const d of ['bayanai', 'tyusyulge']) {
    const held = s.players.filter(q => !q.bankrupt).reduce((n, q) => n + q.freeCards.filter(x => x === d).length, 0);
    if (s.decks[d].length + held !== 16) throw new Error('deck ' + d);
  }
}

for (let g = 0; g < 2000; g++) {
  const n = 2 + (g % 5);
  // правила партии перебираем по битам номера партии
  const rules = { auction: g & 1 ? 'sealed' : 'open', money: g & 2 ? 'hidden' : 'open', growth: g & 4 ? 'grow' : 'flat', prize: g & 8 ? 'off' : 'on' };
  const s = E.create(Array.from({ length: n }, (_, i) => ({ name: 'И' + i, color: D.COLORS[i] })), { rules });
  if (rules.auction === 'sealed') stat.sealed = (stat.sealed || 0) + 1;
  let steps = 0, prevPrize = 0;
  while (s.phase !== 'over' && steps < 30000) {
    steps++;
    const a = bot(s);
    a.player = E.actor(s);
    const phase = s.phase;
    const r = E.act(s, a);
    if (!r.ok) {
      // отказ из-за условий (нет денег, клетка с домами) — нормален, бот просто ошибся
      if (s.players[a.player].bankrupt) { E.act(s, { type: 'endTurn', player: a.player }); continue; }
      if (['offerTrade', 'takeLoan', 'accept', 'unmortgage', 'repayLoan', 'mortgage'].includes(a.type)) {
        if (a.type === 'accept') E.act(s, { type: 'reject', player: a.player });
        continue;
      }
      stat.errors++; if (stat.errors < 10) console.log('ERR', phase, a, r.error); break;
    }
    if (phase !== 'auction' && s.phase === 'auction') stat.auctions++;
    if (a.type === 'bid' && s.phase !== 'auction') stat.auctionWins++;
    if (a.type === 'accept' && phase === 'offer') stat.trades++;
    if (a.type === 'takeLoan' && a.from === E.BANK) stat.loans++;
    if (a.type === 'mortgage') stat.mortgages++;
    if (prevPrize > 0 && s.prize === 0) stat.prizes++;
    prevPrize = s.prize;
    check(s);
    if (s.rules.prize === 'off' && s.prize) throw new Error('prize while off');
    if (s.grow > 1.5 || (s.rules.growth !== 'grow' && s.grow !== 1)) throw new Error('grow ' + s.grow);
    stat.maxGrow = Math.max(stat.maxGrow || 1, s.grow);
    if (a.type === 'endTurn') stat.turns++;
  }
  stat.games++; if (s.phase === 'over') stat.finished++;
}
stat.turns = Math.round(stat.turns / stat.games);
console.log(stat);
