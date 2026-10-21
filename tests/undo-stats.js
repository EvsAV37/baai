// Проверка пакета 3: итоги партии и отмена.
// Итоги: аренда, полученная всеми, равна заплаченной и сумме по клеткам; совпадает с платежами,
//        которые видно по плашке аренды; купленные клетки посчитаны все.
// Отмена: отменяемые действия не трогают случайность — после отмены и повтора партия та же,
//         а бросок, ставки, карточки и передача хода не отменяются.
// Запуск: node tests/undo-stats.js
const E = require('../js/engine.js');
const D = require('../js/data.js');
const B = require('../js/bot.js');

const GAMES = Number(process.env.GAMES) || 200;
let fails = 0, undos = 0, games = 0, rentSum = 0;
const fail = (...m) => { fails++; if (fails < 10) console.log('ОШИБКА', ...m); };

const NEVER = ['roll', 'reroll', 'go', 'bid', 'pass', 'decline', 'endTurn', 'takeLoan', 'repayLoan', 'payJail', 'useCard', 'pickCard', 'payDebt', 'bankrupt', 'ability', 'offerTrade', 'pickRole'];

function restore(s, json) {
  for (const k of Object.keys(s)) delete s[k];
  Object.assign(s, JSON.parse(json));
}

for (let g = 0; g < GAMES; g++) {
  const n = 2 + (g % 5);
  const rules = { auction: g & 1 ? 'sealed' : 'open', money: g & 2 ? 'hidden' : 'open', growth: g & 4 ? 'grow' : 'flat', prize: g & 8 ? 'off' : 'on', roles: ['off', 'pick', 'random'][g % 3] };
  const s = E.create(Array.from({ length: n }, (_, i) => ({ name: 'Б' + i, color: D.COLORS[i], bot: true })), { rules });
  let rentPaid = 0, rentWait = 0, steps = 0;
  const bought = Array(n).fill(0);
  while (s.phase !== 'over' && steps++ < 40000) {
    const p = E.actor(s);
    let a = B.decide(s, p) || B.fallback(s);
    a.player = p;
    const label = E.undoLabel(s, a);
    if (NEVER.includes(a.type) && label) fail('отменяется то, что нельзя:', a.type);
    if (a.type === 'reject' && label) fail('отменяется отказ');
    const before = JSON.stringify(s), seqRent = s.rentNote ? s.rentNote.seq : 0;
    const ownBefore = Object.keys(s.own);
    const debtRent = s.phase === 'debt' && s.pending.stat && s.pending.stat.kind === 'rent' ? s.pending.amount : 0;
    let r = E.act(s, a);
    if (!r.ok) { a = B.fallback(s); a.player = p; r = E.act(s, a); if (!r.ok) break; continue; }
    // отмена и повтор дают то же самое
    if (label && Math.random() < 0.5) {
      const after = JSON.stringify(s);
      restore(s, before);
      const r2 = E.act(s, a);
      undos++;
      if (!r2.ok || JSON.stringify(s) !== after) fail('после отмены и повтора партия другая:', a.type);
    }
    // аренда по плашке
    const R = s.rentNote;
    if (R && R.seq !== seqRent && R.amount > 0) {
      if (s.phase === 'debt' && s.pending.stat && s.pending.stat.kind === 'rent') rentWait = R.amount;
      else rentPaid += R.amount;
    }
    if (a.type === 'payDebt' && debtRent) { rentPaid += debtRent; rentWait = 0; }
    // новые клетки у игроков — покупка или аукцион
    for (const k of Object.keys(s.own)) if (!ownBefore.includes(k)) bought[s.own[k].owner]++;
  }
  games++;
  const S = s.stats;
  const tin = S.players.reduce((t, q) => t + q.rentIn, 0), tout = S.players.reduce((t, q) => t + q.rentOut, 0);
  const tcell = Object.values(S.cells).reduce((t, v) => t + v, 0);
  if (tin !== tout || tin !== tcell) fail(`игра ${g}: аренда получено ${tin}, заплачено ${tout}, по клеткам ${tcell}`);
  if (tout !== rentPaid) fail(`игра ${g}: аренда в итогах ${tout}, по платежам ${rentPaid}`);
  S.players.forEach((q, i) => { if (q.bought !== bought[i]) fail(`игра ${g}: у ${i} куплено ${q.bought}, на деле ${bought[i]}`); });
  const sum = E.summary(s);
  if (tcell && (!sum.best || sum.best.amount !== Math.max(...Object.values(S.cells)))) fail('самая доходная клетка неверна');
  rentSum += tout;
}

// миграция: старое сохранение без итогов получает пустые итоги
const old = E.create([{ name: 'А' }, { name: 'Б' }]); delete old.stats;
const m = E.migrate(JSON.parse(JSON.stringify(old)));
if (!m.stats || m.stats.players.length !== 2) fail('миграция итогов');

console.log({ games, undos, rentSum, fails });
if (fails) { console.log('ОШИБКА'); process.exit(1); }
console.log('ОК');
