// Автопрогон партий случайными «ботами»: проверяем, что движок не ломается.
// Запуск: node tests/sim.js
const E = require('../js/engine.js');
const D = require('../js/data.js');
let games = 0, finished = 0, errors = 0, turnsTotal = 0;
for (let g = 0; g < 2000; g++) {
  const n = 2 + (g % 5);
  const s = E.create(Array.from({ length: n }, (_, i) => ({ name: 'И' + i, color: D.COLORS[i] })));
  let steps = 0;
  while (s.phase !== 'over' && steps < 20000) {
    steps++;
    const p = s.turn, pl = s.players[p];
    let a;
    if (s.phase === 'roll') {
      if (pl.inJail && pl.freeCards.length && Math.random() < .5) a = { type: 'useCard' };
      else if (pl.inJail && pl.money >= 50 && Math.random() < .5) a = { type: 'payJail' };
      else a = { type: 'roll' };
    } else if (s.phase === 'buy') {
      a = { type: pl.money >= D.BOARD[s.pending.cell].price && Math.random() < .8 ? 'buy' : 'decline' };
    } else if (s.phase === 'end') {
      const can = D.BOARD.map((_, i) => i).filter(i => E.canBuild(s, p, i));
      if (can.length && pl.money > 300 && Math.random() < .7) a = { type: 'build', cell: can[0] };
      else a = { type: 'endTurn' };
    } else if (s.phase === 'debt') {
      const sell = D.BOARD.map((_, i) => i).filter(i => E.canSell(s, p, i));
      if (pl.money >= s.pending.amount) a = { type: 'payDebt' };
      else if (sell.length) a = { type: 'sell', cell: sell[0] };
      else a = { type: 'bankrupt' };
    } else throw new Error('bad phase ' + s.phase);
    a.player = p;
    const r = E.act(s, a);
    if (!r.ok) { errors++; if (errors < 10) console.log('ERR', s.phase, a, r.error); break; }
    s.players.forEach((q, i) => {
      if (!Number.isFinite(q.money) || (q.money < 0 && !q.bankrupt)) throw new Error('money ' + i + ' ' + q.money);
      if (q.pos < 0 || q.pos > 39) throw new Error('pos');
    });
    for (const k in s.own) if (s.players[s.own[k].owner].bankrupt) throw new Error('owner bankrupt');
    for (const d of ['bayanai', 'tyusyulge']) {
      const held = s.players.filter(q => !q.bankrupt).reduce((n, q) => n + q.freeCards.filter(x => x === d).length, 0);
      if (s.decks[d].length + held !== 16) throw new Error('deck ' + d);
    }
    if (a.type === 'endTurn') turnsTotal++;
  }
  games++; if (s.phase === 'over') finished++;
}
console.log({ games, finished, errors, avgTurns: Math.round(turnsTotal / games) });
