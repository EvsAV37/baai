// Пакет 3 в настоящем браузере (один телефон):
// 1) старое сохранение переезжает в ячейку; 2) отмена покупки «↶» возвращает всё как было;
// 3) пять ячеек: новая партия занимает свободную, шестая спрашивает, какую заменить; переименование;
// 4) окончённая партия открывается с итогами.
// Нужно: npm i playwright. Запуск: node tests/save-e2e.js (или CHROME=/путь/к/chromium node tests/save-e2e.js)
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = m => { console.error('ОШИБКА:', m); process.exitCode = 1; };
const ok = m => console.log('ок:', m);

const st = page => page.evaluate(() => {
  const G = BAAI.net.ui.getState();
  return G && { phase: G.phase, turn: G.turn, money: G.players.map(p => p.money), own: Object.keys(G.own).length, log: G.log.slice(-3), seq: G.seq };
});
const slotCount = page => page.evaluate(() => (JSON.parse(localStorage.getItem('baai.slots.v1')) || []).filter(Boolean).length);

// Ходим за людей, пока не придём на свободную клетку
async function toBuy(page) {
  for (let k = 0; k < 400; k++) {
    const s = await st(page);
    if (s.phase === 'buy') return true;
    await page.evaluate(() => {
      const sheet = document.getElementById('sheet');
      if (!sheet.hidden) { const c = sheet.querySelector('[data-act="close"]'); if (c) { c.click(); return; } }
      const G = BAAI.net.ui.getState();
      const btns = [...document.querySelectorAll('#actions [data-act]')].filter(b => !b.disabled && !b.classList.contains('off'));
      const pick = acts => btns.find(b => acts.includes(b.dataset.act));
      const b = G.phase === 'auction' ? pick(['pass']) : G.phase === 'offer' ? pick(['reject'])
        : pick(['roll', 'payJail', 'payDebt', 'endTurn', 'bankrupt']) || btns[0];
      if (b) b.click();
    });
    await sleep(120);
  }
  return false;
}

async function newGameFromMenu(page) {
  await sleep(500);
  await page.evaluate(() => { const sh = document.getElementById('sheet'); if (!sh.hidden) { const c = sh.querySelector('[data-act="close"]'); if (c) c.click(); } });
  await page.click('#btn-menu');
  await page.click('#sheet [data-act="askNew"]', { timeout: 5000 });
  await page.click('#sheet [data-act="newGame"]', { timeout: 5000 });
  await sleep(200);
}

(async () => {
  const relay = spawn(process.execPath, [path.join(__dirname, '../tools/relay.js')], { stdio: 'inherit' });
  await sleep(700);
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME, args: ['--no-sandbox'] } : {});
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.on('pageerror', e => fail(e.stack || e.message));
    await page.goto('http://127.0.0.1:8080/');
    await sleep(1800);

    // 1. старое сохранение
    await page.evaluate(() => localStorage.setItem('baai.save.v2', JSON.stringify(BAAI.engine.create([{ name: 'Старый', color: '#c8473d' }, { name: 'Друг', color: '#23395d' }]))));
    await page.reload(); await sleep(1800);
    if (await slotCount(page) !== 1 || !(await page.textContent('#resume-box')).includes('Старый')) fail('старое сохранение не переехало');
    else ok('старое сохранение в ячейке 1');

    // 2. отмена покупки
    await page.click('#count-seg [data-n="2"]');
    await page.click('#bots-seg [data-b="0"]');
    await page.click('#btn-start'); await sleep(600);
    if (!(await toBuy(page))) fail('не дошли до покупки');
    await page.evaluate(() => { const c = document.querySelector('#sheet [data-act="close"]'); if (c && !document.getElementById('sheet').hidden) c.click(); });
    const before = await st(page);
    await page.click('#actions [data-act="buy"]'); await sleep(300);
    const bought = await st(page);
    if (bought.own !== before.own + 1) fail('покупка не прошла');
    await page.screenshot({ path: path.join(process.env.SHOTS || '.', 'undo.png') });
    const undoBtn = await page.$('#actions [data-act="undo"]');
    if (!undoBtn) fail('нет кнопки ↶ после покупки');
    else {
      await undoBtn.click(); await sleep(300);
      const after = await st(page);
      if (after.phase !== 'buy' || after.own !== before.own || after.money.join() !== before.money.join()) fail('отмена не вернула партию: ' + JSON.stringify(after));
      else if (!after.log.some(l => l.includes('↶ Отменено'))) fail('нет строки об отмене в журнале');
      else ok('↶ вернул покупку: деньги и клетки как были');
      if (await page.$('#actions [data-act="undo"]')) fail('кнопка ↶ осталась, хотя отменять нечего');
    }
    // после броска отмены нет
    await page.click('#actions [data-act="buy"]'); await sleep(200);
    for (let k = 0; k < 60; k++) {
      const s = await st(page);
      if (s.turn !== before.turn && s.phase === 'roll') break;
      if (s.phase === 'roll') { await page.click('#actions [data-act="roll"]'); await sleep(900); continue; }
      await page.evaluate(() => { const sh = document.getElementById('sheet'); if (!sh.hidden) { const c = sh.querySelector('[data-act="close"]'); if (c) c.click(); return; }
        const b = [...document.querySelectorAll('#actions [data-act]')].find(b => !b.disabled && !b.classList.contains('off') && ['endTurn', 'pass', 'reject', 'payDebt', 'buy', 'decline', 'bankrupt'].includes(b.dataset.act)); if (b) b.click(); });
      await sleep(150);
    }
    await page.evaluate(() => { const sh = document.getElementById('sheet'); if (!sh.hidden) { const c = sh.querySelector('[data-act="close"]'); if (c) c.click(); } });
    if (await page.$('#actions [data-act="undo"]')) fail('после передачи хода можно отменить');
    else ok('после передачи хода отмены нет');

    // 3. ячейки
    await newGameFromMenu(page);
    if (await slotCount(page) !== 2) fail('после новой партии не 2 сохранения');
    for (let n = 3; n <= 5; n++) { await page.click('#btn-start'); await sleep(400); await newGameFromMenu(page); }
    if (await slotCount(page) !== 5) fail('не 5 сохранений');
    else ok('5 сохранённых партий');
    await page.click('#btn-start'); await sleep(300);
    const asks = await page.$$('#sheet [data-act="slotNew"]');
    if (asks.length !== 5) fail('не спросили, какую ячейку заменить');
    else { await asks[2].click(); await sleep(400); ok('шестая партия заменила выбранную ячейку'); }
    if (await slotCount(page) !== 5) fail('после замены не 5 сохранений');
    await newGameFromMenu(page);
    await page.click('#resume-box [data-act="slotRename"] >> nth=0');
    await page.fill('#slot-name', 'Вечер у Бори');
    await page.click('#sheet [data-act="slotRenameOk"]'); await sleep(200);
    if (!(await page.textContent('#resume-box')).includes('Вечер у Бори')) fail('переименование не сохранилось');
    else ok('переименование');
    await page.screenshot({ path: path.join(process.env.SHOTS || '.', 'slots.png') });
    await page.click('#resume-box [data-act="slotDel"] >> nth=1');
    await page.click('#sheet [data-act="slotDelOk"]'); await sleep(200);
    if (await slotCount(page) !== 4) fail('удаление не сработало'); else ok('удаление');

    // 4. окончённая партия с итогами
    await page.evaluate(() => {
      const E = BAAI.engine, g = E.create([{ name: 'Боря', figure: 'bear', color: '#c8473d' }, { name: 'Мичил', figure: 'deer', color: '#23395d' }]);
      g.phase = 'over'; g.winner = 0; g.overReason = 'last'; g.players[1].bankrupt = true;
      g.stats.players[0] = { rentIn: 3450, rentOut: 120, tax: 200, prize: 300, bought: 7, spent: 1800, auctions: 2 };
      g.stats.cells[34] = 3450;
      g.own[34] = { owner: 0, houses: 3, mortgaged: false };
      localStorage.setItem('baai.slot.1', JSON.stringify(g));
      const m = JSON.parse(localStorage.getItem('baai.slots.v1')); m[1] = { name: 'Итоги', date: Date.now(), round: 9, players: [], over: true, winner: 'Боря' };
      localStorage.setItem('baai.slots.v1', JSON.stringify(m));
    });
    await page.reload(); await sleep(1800);
    await page.click('#resume-box [data-act="slotLoad"][data-k="1"]'); await sleep(1200);
    const txt = await page.textContent('#sheet');
    if (!txt.includes('Итоги партии') || !txt.includes('Мирный') || !/3\s450/.test(txt)) fail('итоги не показаны: ' + txt.slice(0, 200));
    else ok('окончённая партия открывается с итогами, самая доходная клетка — Мирный');
    await page.screenshot({ path: path.join(process.env.SHOTS || '.', 'victory-stats.png'), fullPage: false });
  } catch (e) { fail(e.stack); }
  await browser.close();
  relay.kill();
  if (!process.exitCode) console.log('всё в порядке');
})();
