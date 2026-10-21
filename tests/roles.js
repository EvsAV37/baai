// Проверка тайных ролей: каждая способность и каждый плюс/минус по отдельности.
// Запуск: node tests/roles.js
const E = require('../js/engine.js');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('ОШИБКА:', m); } else console.log('ок:', m); };
// Партия на двоих, у игрока 0 — роль role
function game(role, rules = {}) {
  const s = E.create([{ name: 'А' }, { name: 'Б' }], { rules: Object.assign({ roles: 'random' }, rules) });
  s.players[0].role = role; s.players[1].role = 'toyon' === role ? 'uus' : 'toyon';
  return s;
}
const act = (s, a) => E.act(s, Object.assign({ player: E.actor(s) }, a));
let seq = [];
E.setRandom(() => (seq.length ? seq.shift() : 0.5));
const dice = (a, b) => { seq = [(a - 1) / 6 + 0.01, (b - 1) / 6 + 0.01]; };

// Ойуун: пурга не уносит; переброс
{ const s = game('ojuun'); s.players[0].pos = 26; dice(1, 3); act(s, { type: 'roll' });
  ok(s.phase === 'omen', 'Ойуун видит кубики до хода');
  act(s, { type: 'go' }); ok(s.players[0].pos === 30 && !s.players[0].inJail, 'Ойуун: пурга не уносит в зимовьё');
  const t = game('ojuun'); dice(2, 3); act(t, { type: 'roll' }); dice(4, 6); act(t, { type: 'reroll' });
  ok(t.players[0].pos === 10 && t.players[0].roleUsed && t.players[0].roleShown, 'Ойуун: переброс 4+6'); }
// Уус: дом без группы, дешевле, продажа за треть
{ const s = game('uus'); s.own[1] = { owner: 0, houses: 0, mortgaged: false };
  const m = s.players[0].money; act(s, { type: 'ability', cell: 1 });
  ok(s.own[1].houses === 1 && m - s.players[0].money === 40, 'Уус: дом без группы за 40 вместо 50');
  ok(E.rentFor(s, 1) === 25, 'аренда с одним домом');
  act(s, { type: 'sell', cell: 1 }); ok(s.players[0].money === m - 40 + 16, 'Уус: продажа за треть'); }
// Булчут: две карты, засада, транспорт
{ const s = game('bulchut'); s.players[0].pos = 3; dice(2, 2); act(s, { type: 'roll' });
  ok(s.phase === 'pick2' && s.choice.ids.length === 2, 'Булчут: две карточки на выбор');
  act(s, { type: 'pickCard', k: 0 }); ok(!s.choice, 'Булчут выбрал карточку');
  const t = game('bulchut'); t.own[3] = { owner: 0, houses: 0, mortgaged: false }; act(t, { type: 'ability' });
  ok(t.players[0].trap && !t.players[0].roleShown, 'засада тайная'); t.phase = 'end'; act(t, { type: 'endTurn' });
  t.players[1].pos = 1; dice(1, 1); const m = t.players[1].money; act(t, { type: 'roll' });
  ok(t.players[1].pos === 3 && m - t.players[1].money === 12 && !t.players[0].trap, 'засада: аренда 6 → 12');
  const u = game('bulchut'); u.players[0].pos = 1; dice(2, 2); act(u, { type: 'roll' });
  ok(act(u, { type: 'buy' }).ok === false, 'Булчут не покупает транспорт'); }
// Атыыһыт: аукцион по стартовой, налог ×1.5, обмен без платы
{ const s = game('atyyhyt'); s.turn = 1; s.players[1].pos = 1; dice(2, 2); act(s, { type: 'roll' }); act(s, { type: 'decline' });
  ok(E.actor(s) === 0, 'аукцион: ставит Атыыһыт'); act(s, { type: 'ability' });
  ok(s.own[5] && s.own[5].owner === 0 && s.players[0].money === 1400, 'Атыыһыт забрал порт за 100');
  const t = game('atyyhyt'); t.players[0].pos = 0; dice(2, 2); act(t, { type: 'roll' }); ok(t.players[0].money === 1500 - 300, 'налог 300 вместо 200'); }
// Каюр: на транспорт, транспорт ×1.5, дубль не выводит
{ const s = game('kayur'); act(s, { type: 'ability', cell: 25 }); ok(s.players[0].pos === 25, 'Каюр уехал на АЯМ');
  s.own[5] = { owner: 0, houses: 0, mortgaged: false }; ok(E.rentFor(s, 5) === 38, 'транспорт Каюра 25 → 38');
  const t = game('kayur'); t.players[0].inJail = true; t.players[0].pos = 10; dice(3, 3); act(t, { type: 'roll' }); ok(t.players[0].inJail, 'Каюр: дубль не выводит'); }
// Тойон: сход, дань, аренда −10%
{ const s = game('toyon'); act(s, { type: 'ability' }); ok(s.players[0].money === 1530 && s.players[1].money === 1470, 'Тойон: сход +30');
  const t = game('toyon'); t.own[1] = { owner: 0, houses: 0, mortgaged: false }; t.own[3] = { owner: 0, houses: 0, mortgaged: false };
  ok(E.rentFor(t, 3) === 11, 'аренда группы 12 → 11'); t.players[0].pos = 38; dice(1, 2); act(t, { type: 'roll' });
  ok(t.players[0].money === 1500 + 200 + 25, 'дань на Старте +25'); }
// Олонхосут: приз издалека, +100 на Ысыахе, нет кредита банка
{ const s = game('olonkhosut'); s.prize = 300; act(s, { type: 'ability' }); ok(s.players[0].money === 1800 && s.prize === 0, 'приз издалека');
  ok(!act(s, { type: 'takeLoan', from: E.BANK, amount: 100 }).ok, 'банк не даёт кредит');
  const t = game('olonkhosut', { prize: 'off' }); t.players[0].pos = 15; dice(2, 3); act(t, { type: 'roll' }); ok(t.players[0].money === 1600, '+100 на Ысыахе'); }
// выбор ролей
{ const s = E.create([{ name: 'А' }, { name: 'Б' }], { rules: { roles: 'pick' } });
  ok(s.phase === 'roles' && E.actor(s) === 0, 'фаза выбора ролей'); act(s, { type: 'pickRole', role: 'uus' }); ok(E.actor(s) === 1, 'выбирает второй');
  act(s, { type: 'pickRole', role: 'uus' }); ok(s.phase === 'roll', 'игра началась'); }
console.log(fails ? `ошибок: ${fails}` : 'всё в порядке');
process.exit(fails ? 1 : 0);
