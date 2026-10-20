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

  let rand = Math.random;
  const die = () => 1 + Math.floor(rand() * 6);
  const rub = n => n.toLocaleString('ru-RU').replace(/ /g, ' ') + ' ₽';

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
    return {
      v: 1,
      players: players.map(p => ({
        name: p.name, color: p.color, figure: p.figure || 'horse',
        money: RULES.startMoney, pos: 0,
        inJail: false, jailTries: 0, freeCards: [], bankrupt: false,
      })),
      own: {},                 // номер клетки → { owner, houses } (5 домов = отель)
      turn: 0,
      phase: 'roll',           // roll | buy | end | debt | over
      dice: null,
      doubles: 0,
      extra: false,            // выпал дубль — после хода бросаешь ещё
      pending: null,           // { kind:'buy', cell } | { kind:'debt', amount, to, reason, after }
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
    };
  }

  // ---------- вспомогательное ----------
  const cur = s => s.players[s.turn];
  const nameOf = (s, i) => i === BANK ? 'банк' : (i === 'each' ? 'игрокам' : s.players[i].name);

  function log(s, text) {
    s.log.push(text);
    if (s.log.length > 100) s.log.splice(0, s.log.length - 100);
  }

  function groupCells(g) {
    const out = [];
    BOARD.forEach((c, i) => { if (c.type === 'prop' && c.group === g) out.push(i); });
    return out;
  }

  function ownsGroup(s, p, g) {
    return groupCells(g).every(i => s.own[i] && s.own[i].owner === p);
  }

  function countOwned(s, p, type) {
    return BOARD.reduce((n, c, i) => n + (c.type === type && s.own[i] && s.own[i].owner === p ? 1 : 0), 0);
  }

  function rentFor(s, i, opts = {}) {
    const c = BOARD[i], o = s.own[i];
    if (!o) return 0;
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

  function netWorth(s, p) {
    let w = s.players[p].money;
    for (const k in s.own) {
      const o = s.own[k];
      if (o.owner !== p) continue;
      const c = BOARD[k];
      w += c.price;
      if (c.type === 'prop') w += o.houses * GROUPS[c.group].house;
    }
    return w;
  }

  // ---------- строительство ----------
  function canBuild(s, p, i) {
    const c = BOARD[i], o = s.own[i];
    if (!c || c.type !== 'prop' || !o || o.owner !== p) return false;
    if (!ownsGroup(s, p, c.group) || o.houses >= 5) return false;
    const min = Math.min(...groupCells(c.group).map(j => s.own[j].houses));
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

  // Сколько игрок может собрать, продав все дома
  function liquidValue(s, p) {
    let v = s.players[p].money;
    for (const k in s.own) if (s.own[k].owner === p && BOARD[k].type === 'prop') v += s.own[k].houses * sellValue(k);
    return v;
  }

  // Продать дома автоматически (для игроков, которые платят не в свой ход)
  function autoSell(s, p, need) {
    let sold = 0;
    while (s.players[p].money < need) {
      let best = -1;
      for (const k in s.own) {
        const i = Number(k);
        if (canSell(s, p, i) && (best < 0 || BOARD[i].price > BOARD[best].price)) best = i;
      }
      if (best < 0) break;
      doSell(s, p, best); sold++;
    }
    if (sold) log(s, `${s.players[p].name} продаёт домов: ${sold}`);
  }

  // ---------- деньги ----------
  // Заплатить: to — номер игрока, BANK или 'each' (поровну всем остальным)
  function charge(s, p, to, amount, reason, after) {
    const pl = s.players[p];
    if (amount <= 0) { if (after) runAfter(s, after); return; }
    if (pl.money < amount && p !== s.turn) autoSell(s, p, amount);
    if (pl.money >= amount) {
      pay(s, p, to, amount);
      log(s, `${pl.name} платит ${rub(amount)} (${reason})`);
      if (after) runAfter(s, after);
      return;
    }
    if (p === s.turn) {
      // Свой ход — даём самому продать дома или объявить банкротство
      s.pending = { kind: 'debt', amount, to, reason, after: after || null };
      s.phase = 'debt';
      log(s, `${pl.name} не хватает денег: нужно ${rub(amount)} (${reason})`);
    } else {
      bankrupt(s, p, to === 'each' ? BANK : to);
    }
  }

  function pay(s, p, to, amount) {
    s.players[p].money -= amount;
    if (to === 'each') {
      const others = alive(s).filter(i => i !== p);
      const part = Math.floor(amount / Math.max(1, others.length));
      others.forEach(i => { s.players[i].money += part; });
    } else if (to !== BANK) {
      s.players[to].money += amount;
    }
  }

  const alive = s => s.players.map((_, i) => i).filter(i => !s.players[i].bankrupt);

  function bankrupt(s, p, to) {
    const pl = s.players[p];
    for (const k in s.own) {
      const o = s.own[k];
      if (o.owner !== p) continue;
      if (BOARD[k].type === 'prop' && o.houses) { pl.money += o.houses * sellValue(k); o.houses = 0; }
      if (to === BANK) delete s.own[k]; else o.owner = to;
    }
    if (to === BANK) {
      pl.freeCards.forEach(d => s.decks[d].push(DECKS[d].findIndex(c => c.free)));
    } else {
      s.players[to].money += Math.max(0, pl.money);
      s.players[to].freeCards.push(...pl.freeCards);
    }
    pl.freeCards = []; pl.money = 0; pl.bankrupt = true; pl.inJail = false;
    log(s, `💥 ${pl.name} — банкрот. Имущество получает ${nameOf(s, to)}.`);

    const left = alive(s);
    if (left.length <= 1) {
      s.phase = 'over'; s.pending = null;
      s.winner = left[0] ?? null;
      s.overReason = 'last';
      log(s, `🏆 Победитель: ${s.players[s.winner].name}`);
      return;
    }
    if (p === s.turn) { s.pending = null; s.extra = false; s.phase = 'end'; }
  }

  // ---------- движение ----------
  function passStart(s, p) {
    s.players[p].money += RULES.passStart;
    log(s, `${s.players[p].name} проходит Старт: +${rub(RULES.passStart)}`);
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
        const rent = rentFor(s, i, opts);
        charge(s, p, o.owner, rent, `аренда: ${c.name} → ${s.players[o.owner].name}`);
        return;
      }
      case 'tax':
        charge(s, p, BANK, c.amount, c.name);
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
        if (o && o.owner !== p) {
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
    if (s.phase === 'buy' || s.phase === 'debt' || s.phase === 'over') return;
    const pl = cur(s);
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
    let best = null, bw = -1;
    alive(s).forEach(i => { const w = netWorth(s, i); if (w > bw) { bw = w; best = i; } });
    s.phase = 'over'; s.winner = best; s.overReason = 'time'; s.pending = null;
    log(s, `⏰ Время вышло. Самый богатый: ${s.players[best].name} (${rub(bw)})`);
  }

  // ---------- действия ----------
  // action = { type, player, cell? }. Возвращает { ok } или { ok:false, error }.
  function act(s, a) {
    const r = actInner(s, a);
    if (r.ok) s.seq++;
    return r;
  }

  function actInner(s, a) {
    if (s.phase === 'over') return err('Партия окончена');
    const p = a.player;
    if (p !== s.turn) return err('Сейчас не ваш ход');
    const pl = cur(s);

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
        s.own[i] = { owner: p, houses: 0 };
        s.pending = null; s.phase = 'moving';
        log(s, `🏠 ${pl.name} покупает ${c.name} за ${rub(c.price)}`);
        settle(s);
        return ok();
      }

      case 'decline': {
        if (s.phase !== 'buy') return err('Нечего покупать');
        log(s, `${pl.name} не покупает ${BOARD[s.pending.cell].name}`);
        s.pending = null; s.phase = 'moving';
        settle(s);
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
        if (!['roll', 'end', 'debt'].includes(s.phase)) return err('Сейчас продавать нельзя');
        if (!canSell(s, p, a.cell)) return err('Здесь продавать нельзя');
        const was = s.own[a.cell].houses;
        doSell(s, p, a.cell);
        log(s, `${pl.name} продаёт ${was === 5 ? 'отель' : 'дом'}: ${BOARD[a.cell].name} (+${rub(sellValue(a.cell))})`);
        return ok();
      }

      case 'payDebt': {
        if (s.phase !== 'debt') return err('Долга нет');
        const d = s.pending;
        if (pl.money < d.amount) return err('Всё ещё не хватает денег');
        s.pending = null; s.phase = 'moving';
        pay(s, p, d.to, d.amount);
        log(s, `${pl.name} платит ${rub(d.amount)} (${d.reason})`);
        if (d.after) runAfter(s, d.after);
        settle(s);
        return ok();
      }

      case 'bankrupt': {
        if (s.phase !== 'debt') return err('Банкротство объявляют, только если не хватает на долг');
        const to = s.pending.to === 'each' ? BANK : s.pending.to;
        bankrupt(s, p, to);
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
    create, act, rentFor, netWorth, canBuild, canSell, ownsGroup, groupCells,
    liquidValue, sellValue, rub, BANK,
    setRandom(fn) { rand = fn; },
  };
  root.BAAI = root.BAAI || {};
  root.BAAI.engine = Engine;
  if (typeof module !== 'undefined') module.exports = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
