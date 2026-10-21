// Пакет 4 в браузере: каждое нажатие даёт ответ, предложение обмена с цветами клеток.
// 1) один телефон: кредит взят — шторка закрылась, сообщение, кнопка «К возврату 600 ₽»;
//    неактивная кнопка объясняет, почему нельзя; предложение обмена — клетки с цветом, игрок с фишкой.
// 2) по Wi-Fi: гость берёт кредит — шторка закрывается, сообщение приходит.
// Нужно: npm i ws playwright. Запуск: node tests/feedback-e2e.js (или CHROME=/путь/к/chromium)
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:8080';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = m => { console.error('ОШИБКА:', m); process.exitCode = 1; };
const ok = m => console.log('ок:', m);
const SHOTS = process.env.SHOTS || '.';

const toastText = page => page.evaluate(() => { const t = document.getElementById('toast'); return t.hidden ? '' : t.className + '|' + t.textContent; });
const sheetOpen = page => page.evaluate(() => !document.getElementById('sheet').hidden);

async function phone(browser, url, name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => fail(`${name}: ${e.message}`));
  await page.goto(url);
  return { ctx, page, name };
}

// закрыть карточки и дождаться своего хода в начале (фаза roll)
async function toMyRoll(page, me) {
  for (let k = 0; k < 200; k++) {
    const s = await page.evaluate(() => { const G = BAAI.net.ui.getState(); return G && { phase: G.phase, actor: BAAI.engine.actor(G) }; });
    const mine = me === undefined ? await page.evaluate(() => BAAI.net.me) : me;
    if (s && s.phase === 'roll' && s.actor === mine) return true;
    await page.evaluate(() => { const sh = document.getElementById('sheet'); if (!sh.hidden) { const c = sh.querySelector('[data-act="close"]'); if (c) c.click(); } });
    await sleep(400);
  }
  return false;
}

(async () => {
  const relay = spawn(process.execPath, [path.join(__dirname, '../tools/relay.js')], { stdio: 'inherit' });
  await sleep(700);
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME, args: ['--no-sandbox'] } : {});
  try {
    // ---------- 1. один телефон ----------
    const { page } = await phone(browser, BASE + '/', 'телефон');
    await sleep(1800);
    await page.click('#count-seg [data-n="1"]');
    await page.click('#bots-seg [data-b="3"]');
    await page.click('#btn-start'); await sleep(800);
    if (!(await toMyRoll(page, 0))) fail('не дождались своего хода');

    await page.click('#actions [data-act="loanOpen"]'); await sleep(300);
    await page.click('#sheet [data-act="lTake"]'); await sleep(300);
    const t1 = await toastText(page);
    if (await sheetOpen(page)) fail('после «Взять кредит» шторка осталась');
    else if (!t1.includes('ok') || !t1.includes('Кредит взят')) fail('нет сообщения «Кредит взят»: ' + t1);
    else ok('кредит: шторка закрылась, сообщение «' + t1.split('|')[1] + '»');
    await page.screenshot({ path: path.join(SHOTS, 'fb-loan.png') });
    const lbl = await page.textContent('#actions [data-act="loanOpen"]');
    if (!lbl.includes('К возврату 600')) fail('на кнопке не «К возврату 600 ₽»: ' + lbl);
    else ok('кнопка «' + lbl.trim() + '»');

    // неактивная кнопка: денег на досрочный возврат нет
    await page.evaluate(() => { BAAI.net.ui.getState().players[0].money = 10; BAAI.net.ui.refresh(); });
    await page.click('#actions [data-act="loanOpen"]'); await sleep(300);
    await page.click('#sheet [data-act="loanRepay"]', { force: true }); await sleep(200);
    const t2 = await toastText(page);
    if (!t2.includes('bad') || !t2.includes('Не хватает')) fail('неактивная кнопка молчит: ' + t2);
    else ok('неактивная кнопка объясняет: «' + t2.split('|')[1] + '»');
    await page.click('#sheet [data-act="close"]');

    // предложение обмена от бота: Алдан за 290 ₽
    await page.evaluate(() => {
      const G = BAAI.net.ui.getState();
      G.players[0].money = 900;
      G.own[16] = { owner: 0, houses: 0, mortgaged: false };
      G.offer = { kind: 'trade', from: 2, to: 0, give: { cells: [], money: 290, cards: 0 }, get: { cells: [16], money: 0, cards: 0 }, back: 'roll' };
      G.phase = 'offer';
      BAAI.net.ui.refresh();
    });
    await sleep(900);
    const tags = await page.evaluate(() => ({
      cells: [...document.querySelectorAll('#actions .swap .ctag')].map(e => e.textContent.trim()),
      who: [...document.querySelectorAll('#actions .whotag')].map(e => e.textContent.trim()),
      give: document.querySelector('#actions .swap .give') && document.querySelector('#actions .swap .give').textContent,
    }));
    if (!tags.give || !tags.give.includes('Алдан') || !tags.cells.some(t => t.includes('Алдан'))) fail('в «Вы отдаёте» нет плашки Алдана: ' + JSON.stringify(tags));
    else if (!tags.who.length) fail('нет игрока с фишкой');
    else ok(`обмен: клетки ${JSON.stringify(tags.cells)}, игрок ${JSON.stringify(tags.who)}`);
    await page.screenshot({ path: path.join(SHOTS, 'fb-offer.png'), fullPage: true });
    await page.click('#actions [data-act="reject"]'); await sleep(300);
    await page.context().close();

    // ---------- 2. по Wi-Fi: гость берёт кредит ----------
    const host = await phone(browser, `${BASE}/?host=127.0.0.1`, 'хост');
    await host.page.click('#btn-net');
    const a = await phone(browser, `${BASE}/?join`, 'гость');
    await sleep(1200);
    await host.page.click('[data-net="start"]');
    await sleep(1500);
    // ходим за хоста, пока не настанет ход гостя
    for (let k = 0; k < 240; k++) {
      const s = await a.page.evaluate(() => { const G = BAAI.net.ui.getState(); return G && { phase: G.phase, actor: BAAI.engine.actor(G), me: BAAI.net.me }; });
      if (s && s.phase === 'roll' && s.actor === s.me) break;
      await host.page.evaluate(() => {
        const n = BAAI.net, G = n.ui.getState();
        if (BAAI.engine.actor(G) !== n.me) return;
        const sh = document.getElementById('sheet'); if (!sh.hidden) { const c = sh.querySelector('[data-act="close"]'); if (c) { c.click(); return; } }
        const b = [...document.querySelectorAll('#actions [data-act]')].find(b => !b.classList.contains('off') && ['roll', 'endTurn', 'decline', 'pass', 'payDebt', 'payJail'].includes(b.dataset.act));
        if (b) b.click();
      });
      await a.page.evaluate(() => { const sh = document.getElementById('sheet'); if (!sh.hidden) { const c = sh.querySelector('[data-act="close"]'); if (c) c.click(); } });
      await sleep(500);
    }
    await a.page.click('#actions [data-act="loanOpen"]'); await sleep(300);
    await a.page.click('#sheet [data-act="lTake"]'); await sleep(900);
    const t3 = await toastText(a.page);
    if (await sheetOpen(a.page)) fail('по сети: после «Взять кредит» шторка осталась');
    else if (!t3.includes('Кредит взят')) fail('по сети: нет сообщения «Кредит взят»: ' + t3);
    else ok('по сети: шторка закрылась, сообщение «' + t3.split('|')[1] + '»');
    if (await a.page.evaluate(() => document.body.classList.contains('busy'))) fail('по сети: кнопки остались заблокированы');
    // повторное «Взять кредит» — хост отказывает, гость видит причину
    await a.page.click('#actions [data-act="loanOpen"]'); await sleep(300);
    const repay = await a.page.$('#sheet [data-act="loanRepay"]');
    if (!repay) fail('по сети: нет экрана кредита с возвратом');
    else ok('по сети: при открытом кредите — экран возврата');
    await a.page.screenshot({ path: path.join(SHOTS, 'fb-net.png') });
  } finally {
    await browser.close();
    relay.kill();
  }
  console.log(process.exitCode ? 'есть ошибки' : 'всё в порядке');
})();
