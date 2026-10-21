// Проверка игры по сети в настоящем браузере: хост и два игрока на «разных телефонах».
// Боты жмут кнопки, проверяем, что у всех одинаковое состояние, работает переподключение,
// таймер аукциона и ничего не грузится из интернета.
// Нужно: npm i ws playwright. Запуск: node tests/net-e2e.js
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:8080';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = m => { console.error('ОШИБКА:', m); process.exitCode = 1; };
const external = [];

async function phone(browser, url, name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('request', r => { if (!r.url().startsWith(BASE) && !r.url().startsWith('ws://127.0.0.1') && !r.url().startsWith('data:')) external.push(r.url()); });
  page.on('pageerror', e => fail(`${name}: ${e.message}`));
  await page.goto(url);
  return { ctx, page, name };
}

const state = p => p.page.evaluate(() => { const n = BAAI.net, G = n.ui.getState(); return G ? { seq: G.seq, phase: G.phase, json: JSON.stringify(G), me: n.me, actor: BAAI.engine.actor(G) } : null; });

// Один шаг бота: если сейчас действует этот телефон — нажать подходящую кнопку
async function step(p) {
  return p.page.evaluate(() => {
    const n = BAAI.net, G = n.ui.getState();
    if (!G || G.phase === 'over' || BAAI.engine.actor(G) !== n.me) return null;
    const sheet = document.getElementById('sheet');
    if (!sheet.hidden) { const c = sheet.querySelector('[data-act="close"]'); if (c) { c.click(); return 'close'; } }
    const btns = [...document.querySelectorAll('#actions [data-act]')].filter(b => !b.disabled);
    const pick = acts => btns.find(b => acts.includes(b.dataset.act));
    const r = Math.random();
    let b = null;
    if (G.phase === 'auction') b = r < 0.5 ? pick(['bid']) : pick(['pass']);
    else if (G.phase === 'offer') b = pick([r < 0.5 ? 'accept' : 'reject']);
    else if (G.phase === 'buy') b = r < 0.6 ? pick(['buy']) : pick(['decline']);
    else b = pick(['roll', 'payJail', 'payDebt', 'endTurn', 'bankrupt']);
    if (!b) b = btns[0];
    if (!b) return 'none';
    b.click();
    return b.dataset.act;
  });
}

(async () => {
  const relay = spawn(process.execPath, [path.join(__dirname, '../tools/relay.js')], { stdio: 'inherit' });
  await sleep(700);
  const browser = await chromium.launch();
  try {
    const host = await phone(browser, `${BASE}/?host=127.0.0.1`, 'хост');
    await host.page.click('#btn-net');
    const a = await phone(browser, `${BASE}/?join`, 'игрок А');
    const b = await phone(browser, `${BASE}/?join`, 'игрок Б');
    await sleep(1200);
    const seats = await host.page.locator('#lobby .seat').count();
    if (seats !== 3) fail(`в комнате ${seats} игрока вместо 3`);
    if (!(await host.page.locator('#lobby .qr svg').count())) fail('нет QR-кода');
    // игрок А меняет имя и фигурку
    await a.page.fill('#net-name', 'Айаал');
    await a.page.click('#lobby .figs button:not([disabled]):not([aria-checked="true"])');
    await sleep(500);
    const lobbyText = await host.page.locator('#lobby').innerText();
    if (!lobbyText.includes('Айаал')) fail('хост не видит новое имя игрока');
    await host.page.click('[data-net="start"]');
    await sleep(1500);
    for (const p of [host, a, b]) if (await p.page.locator('#game').isHidden()) fail(`${p.name}: игра не открылась`);

    const phones = [host, a, b];
    let actions = 0, reconnected = false, timerChecked = false;
    for (let k = 0; k < 900 && actions < 260; k++) {
      for (const p of phones) { const r = await step(p); if (r && r !== 'none') actions++; }
      await sleep(60);
      // переподключение: игрок Б закрывает страницу и открывает снова
      if (!reconnected && actions > 60) {
        const before = (await state(b)).me;
        await b.page.close();
        await sleep(400);
        b.page = await b.ctx.newPage();
        b.page.on('pageerror', e => fail(`${b.name}: ${e.message}`));
        await b.page.goto(`${BASE}/?join`);
        await sleep(1500);
        const after = await state(b);
        if (!after || after.me !== before) fail('после переподключения игрок не вернулся на своё место');
        reconnected = true;
        console.log('переподключение: ок, место', after && after.me);
      }
      // таймер аукциона: никто не ставит — через 15 с автоматический «Пас»
      if (!timerChecked && actions > 100) {
        const s = await state(host);
        if (s.phase === 'auction') {
          const seq = s.seq;
          await sleep(16500);
          const s2 = await state(host);
          if (s2.seq === seq) fail('таймер аукциона не сработал');
          else console.log('таймер аукциона: ок');
          timerChecked = true;
        }
      }
    }
    await sleep(1200);
    const ref = await state(host);
    for (const p of [a, b]) {
      const s = await state(p);
      if (!s || s.json !== ref.json) fail(`${p.name}: состояние расходится с хостом (seq ${s && s.seq} / ${ref.seq})`);
    }
    console.log(`действий: ${actions}, seq ${ref.seq}, фаза ${ref.phase}${timerChecked ? '' : ' (аукцион без ставок не попался)'}`);
    if (external.length) fail('запросы в интернет: ' + [...new Set(external)].join(', '));
    else console.log('запросов в интернет нет');
    await host.page.screenshot({ path: process.env.SHOT_DIR ? path.join(process.env.SHOT_DIR, 'host.png') : 'host.png' });
    await a.page.screenshot({ path: process.env.SHOT_DIR ? path.join(process.env.SHOT_DIR, 'player.png') : 'player.png' });
  } finally {
    await browser.close();
    relay.kill();
  }
  console.log(process.exitCode ? 'есть ошибки' : 'всё в порядке');
})();
