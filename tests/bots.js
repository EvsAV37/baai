// Проверка ботов: партии только ботами при всех правилах и ролях.
// Бот не должен предлагать движку запрещённые ходы, партия не должна вставать.
// Плюс дуэль: бот против «простака», который только покупает и бросает кубики.
// Запуск: node tests/bots.js
const E = require('../js/engine.js');
const D = require('../js/data.js');
const B = require('../js/bot.js');

const GAMES = Number(process.env.GAMES) || 300;
const stat = { games: 0, finished: 0, steps: 0, turns: 0, refused: 0, byType: {}, trades: 0, offers: 0, builds: 0, auctionBids: 0, abilities: 0, loans: 0 };

function simple(s, p) {
  const pl = s.players[p];
  switch (s.phase) {
    case 'roles': return { type: 'pickRole', role: 'toyon' };
    case 'omen': return { type: 'go' };
    case 'pick2': return { type: 'pickCard', k: 0 };
    case 'auction': return { type: 'pass' };
    case 'offer': return { type: 'reject' };
    case 'buy': return { type: pl.money >= E.price(s, s.pending.cell) ? 'buy' : 'decline' };
    case 'debt': {
      if (pl.money >= s.pending.amount) return { type: 'payDebt' };
      const own = Object.keys(s.own).map(Number).filter(i => s.own[i].owner === p);
      const sell = own.filter(i => E.canSell(s, p, i)); if (sell.length) return { type: 'sell', cell: sell[0] };
      const m = own.filter(i => E.canMortgage(s, p, i)); if (m.length) return { type: 'mortgage', cell: m[0] };
      return { type: 'bankrupt' };
    }
    case 'roll': return { type: 'roll' };
    case 'end': return { type: 'endTurn' };
  }
}

function play(n, rules, smart, minutes, cap = 40000) {
  const s = E.create(Array.from({ length: n }, (_, i) => ({ name: 'Б' + i, color: D.COLORS[i], bot: true })), { rules, minutes });
  let steps = 0;
  while (s.phase !== 'over' && steps < cap) {
    steps++;
    const p = E.actor(s);
    if (!smart[p]) {
      const a = simple(s, p); a.player = p;
      const r = E.act(s, a);
      if (!r.ok) { const f = B.fallback(s); f.player = p; E.act(s, f); }
      continue;
    }
    const phase = s.phase;
    const a = B.decide(s, p);
    if (!a) throw new Error('нет решения в фазе ' + phase);
    a.player = p;
    const r = E.act(s, a);
    if (!r.ok) {
      stat.refused++;
      if (stat.refused < 8) console.log('отказ', phase, JSON.stringify(a), r.error);
      const f = B.fallback(s); f.player = p; E.act(s, f);
      continue;
    }
    stat.byType[a.type] = (stat.byType[a.type] || 0) + 1;
    if (a.type === 'offerTrade') stat.offers++;
    if (a.type === 'accept' && phase === 'offer') stat.trades++;
    if (a.type === 'build') stat.builds++;
    if (a.type === 'bid') stat.auctionBids++;
    if (a.type === 'ability' || a.type === 'reroll') stat.abilities++;
    if (a.type === 'takeLoan') stat.loans++;
    if (a.type === 'endTurn') stat.turns++;
    s.players.forEach((q, i) => { if (q.money < 0 && !q.bankrupt) throw new Error('минус у ' + i); });
  }
  stat.steps += steps;
  return s;
}

// 1. Только умные боты, все сочетания правил
for (let g = 0; g < GAMES; g++) {
  const n = 2 + (g % 5);
  const rules = { auction: g & 1 ? 'sealed' : 'open', money: g & 2 ? 'hidden' : 'open', growth: g & 4 ? 'grow' : 'flat', prize: g & 8 ? 'off' : 'on', roles: ['off', 'pick', 'random'][g % 3] };
  const s = play(n, rules, Array(n).fill(true));
  stat.games++; stat.rounds = (stat.rounds || 0) + s.round;
  if (s.phase === 'over') stat.finished++;
}

// 2. Дуэль: умный бот против простака (по очереди за первым и вторым местом)
let wins = 0, done = 0;
// простак никогда не меняется, поэтому часть партий тянется бесконечно — такие не считаем
for (let g = 0; g < 100; g++) {
  const smart = g % 2 ? [true, false] : [false, true];
  const s = play(2, {}, smart, 0, 8000);
  if (s.phase !== 'over') continue;
  done++;
  if (smart[s.winner]) wins++;
}

stat.avgTurns = Math.round(stat.turns / stat.games);
stat.avgRounds = Math.round(stat.rounds / stat.games);
console.log(stat);
console.log(`Дуэль с простаком: бот выиграл ${wins} из ${done} законченных партий`);
if (stat.refused || stat.finished < stat.games * 0.97) { console.log('ОШИБКА: отказы движка или партии не заканчиваются'); process.exit(1); }
console.log('ОК');
