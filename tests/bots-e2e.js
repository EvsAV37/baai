// Боты в настоящем браузере.
// 1) Один телефон: человек и три бота, деньги соперников скрыты. Боты ходят сами,
//    телефон не просят передавать, чужие деньги не видны.
// 2) Один телефон: два человека и два бота — «Передайте телефон» только между людьми.
// 3) По Wi-Fi: хост добавляет двух ботов, гость подключается, боты ходят, у гостя то же состояние.
// Нужно: npm i ws playwright. Запуск: node tests/bots-e2e.js
// Если Chromium для Playwright не скачивается: CHROME=/путь/к/chromium node tests/bots-e2e.js
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:8080';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = m => { console.error('ОШИБКА:', m); process.exitCode = 1; };
const ok = m => console.log('ок:', m);

async function phone(browser, url, name, fast) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', e => fail(`${name}: ${e.message}`));
  if (fast) await ctx.addInitScript(() => { try { localStorage.setItem('baai.botfast', 'true'); } catch (e) { /* */ } });
  await page.goto(url);
  return { ctx, page, name };
}

const info = p => p.page.evaluate(() => {
  const G = BAAI.net.ui.getState();
  if (!G) return null;
  const E = BAAI.engine, a = E.actor(G);
  const sheet = document.getElementById('sheet');
  return {
    seq: G.seq, phase: G.phase, round: G.round, actor: a, actorBot: !!G.players[a].bot, me: BAAI.net.me,
    handoff: !sheet.hidden && sheet.dataset.kind === 'handoff',
    plates: [...document.querySelectorAll('#players .mn')].map(e => e.textContent),
    bots: G.players.map(p => !!p.bot), log: G.log.slice(-60), json: JSON.stringify(G, (k, v) => (['bids', 'role', 'roleUsed', 'trap'].includes(k) ? undefined : v)),
  };
});

// Человек жмёт кнопку, когда действует он. Ходы ботов не трогаем.
async function humanStep(p, onlyMe) {
  return p.page.evaluate(only => {
    const n = BAAI.net, G = n.ui.getState();
    if (!G || G.phase === 'over') return null;
    const a = BAAI.engine.actor(G);
    if (G.players[a].bot) return null;
    if (only && a !== n.me) return null;
    const sheet = document.getElementById('sheet');
    if (!sheet.hidden) { const c = sheet.querySelector('[data-act="close"]'); if (c) { c.click(); return 'close'; } }
    const btns = [...document.querySelectorAll('#actions [data-act]')].filter(b => !b.disabled && !b.classList.contains('off'));
    const pick = acts => btns.find(b => acts.includes(b.dataset.act));
    let b = null;
    if (G.phase === 'auction') b = pick(['pass']);
    else if (G.phase === 'offer') b = pick(['reject']);
    else if (G.phase === 'buy') b = pick(['buy']) || pick(['decline']);
    else if (G.phase === 'roles') b = pick(['pickRole']);
    else b = pick(['roll', 'payJail', 'payDebt', 'endTurn', 'bankrupt', 'go', 'pickCard']);
    if (!b) b = btns[0];
    if (!b) return 'none';
    b.click();
    return b.dataset.act;
  }, onlyMe);
}

async function setupLocal(page, humans, bots, hidden) {
  await page.click(`#count-seg [data-n="${humans}"]`);
  await page.click(`#bots-seg [data-b="${bots}"]`);
  if (hidden) await page.click('[data-rule="money"][data-v="hidden"]');
  const rows = await page.locator('#bot-names .bot-row').count();
  if (rows !== bots) fail(`в настройке ${rows} строк ботов вместо ${bots}`);
  await page.click('#btn-start');
  await sleep(800);
}

(async () => {
  const relay = spawn(process.execPath, [path.join(__dirname, '../tools/relay.js')], { stdio: 'inherit' });
  await sleep(700);
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME, args: ['--no-sandbox'] } : {});
  try {
    // ---------- 1. один человек и три бота ----------
    {
      const p = await phone(browser, BASE + '/', 'телефон 1', true);
      await setupLocal(p.page, 1, 3, true);
      let s = await info(p);
      if (!s || s.bots.join() !== 'false,true,true,true') fail('боты не попали в партию: ' + (s && s.bots));
      let handoffs = 0, botMoves = 0, lastActor = -1, hiddenOk = true;
      const t0 = Date.now();
      while (Date.now() - t0 < 70000) {
        s = await info(p);
        if (s.phase === 'over') break;
        if (s.handoff) handoffs++;
        if (s.actorBot && s.actor !== lastActor) botMoves++;
        lastActor = s.actor;
        // деньги ботов скрыты, свои видны
        if (s.plates.slice(1).some(t => !t.includes('•') && t !== '—')) hiddenOk = false;
        if (s.plates[0].includes('•')) hiddenOk = false;
        await humanStep(p, false);
        await sleep(120);
      }
      s = await info(p);
      if (handoffs) fail(`один человек, а «Передайте телефон» показали ${handoffs} раз`); else ok('одному человеку телефон передавать не просят');
      if (botMoves < 6) fail(`боты почти не ходили: ${botMoves}`); else ok(`боты ходят сами (смен хода ботов: ${botMoves}, круг ${s.round})`);
      if (!hiddenOk) fail('скрытые деньги: видны деньги ботов или не видны свои'); else ok('деньги ботов скрыты, свои видны');
      if (!s.log.some(t => /Айаал|Сардаана|Мичил/.test(t) && /покупает|ставка|пас|строит|не покупает/.test(t))) fail('в журнале нет решений ботов');
      else ok('боты принимают решения (покупка, аукцион, стройка)');
      await p.page.screenshot({ path: path.join(process.env.SHOT_DIR || '.', 'bots-local.png') });
      await p.ctx.close();
    }

    // ---------- 2. два человека и два бота ----------
    {
      const p = await phone(browser, BASE + '/', 'телефон 2', true);
      await setupLocal(p.page, 2, 2, false);
      let wrong = 0, shown = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 40000) {
        const s = await info(p);
        if (s.phase === 'over') break;
        if (s.handoff) { shown++; if (s.actorBot) wrong++; }
        await humanStep(p, false);
        await sleep(120);
      }
      if (wrong) fail(`«Передайте телефон» показали для бота ${wrong} раз`);
      else if (!shown) fail('между двумя людьми телефон передавать не попросили');
      else ok(`телефон передают только между людьми (${shown} раз)`);
      await p.ctx.close();
    }

    // ---------- 3. по Wi-Fi: хост, гость и два бота ----------
    {
      const host = await phone(browser, `${BASE}/?host=127.0.0.1`, 'хост', true);
      await host.page.click('#btn-net');
      await sleep(500);
      await host.page.click('[data-net="addBot"]');
      await host.page.click('[data-net="addBot"]');
      const guest = await phone(browser, `${BASE}/?join`, 'гость');
      await sleep(1500);
      const lobby = await guest.page.locator('#lobby').innerText();
      if (!/бот/i.test(lobby)) fail('гость не видит ботов в комнате');
      const seats = await host.page.locator('#lobby .seat').count();
      if (seats !== 4) fail(`в комнате ${seats} места вместо 4`);
      await host.page.click('[data-net="start"]');
      await sleep(1500);
      let botMoves = 0, last = -1;
      const t0 = Date.now();
      while (Date.now() - t0 < 50000) {
        await humanStep(host, true);
        await humanStep(guest, true);
        const s = await info(host);
        if (s.phase === 'over') break;
        if (s.actorBot && s.actor !== last) botMoves++;
        last = s.actor;
        await sleep(150);
      }
      if (botMoves < 4) fail(`боты по сети почти не ходили: ${botMoves}`); else ok(`по Wi-Fi боты ходят (смен хода ботов: ${botMoves})`);
      const online = await guest.page.evaluate(() => BAAI.net.online);
      if (!online || !online[2] || !online[3]) fail('боты у гостя «без связи»'); else ok('боты всегда на связи');
      // дождаться спокойного момента и сравнить состояние
      for (let k = 0; k < 40; k++) { const s = await info(host); if (!s.actorBot) break; await sleep(300); }
      await sleep(800);
      const a = await info(host), b = await info(guest);
      if (a.json !== b.json) fail(`у гостя другое состояние (seq ${b.seq} / ${a.seq})`); else ok('у гостя то же состояние, что у хоста');
      await guest.page.screenshot({ path: path.join(process.env.SHOT_DIR || '.', 'bots-guest.png') });
    }
  } finally {
    await browser.close();
    relay.kill();
  }
  console.log(process.exitCode ? 'есть ошибки' : 'всё в порядке');
})();
