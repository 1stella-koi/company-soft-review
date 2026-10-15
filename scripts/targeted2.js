// 一次加载搜索页，同页连续点击多个目标（避免结果洗牌）
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const log = (...a) => console.log(...a);

(async () => {
  const outDir = process.argv[2];
  const kwIdx = parseInt(process.argv[3] || '1', 10);
  const authors = process.argv.slice(4);
  fs.mkdirSync(outDir, { recursive: true });

  const kwFile = path.join(__dirname, '_keywords.txt');
  const kws = fs.readFileSync(kwFile, 'utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const kw = kws[kwIdx - 1];
  log('### KW: ' + kw + '  targets: ' + JSON.stringify(authors));

  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => !p.url().startsWith('devtools://')) || (await ctx.newPage());
  page.setDefaultTimeout(25000);

  const url = 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(kw) + '&source=web_explore_feed';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(5000);

  // 预滚动几轮加载足够多的卡片
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 2200);
    await page.waitForTimeout(1600);
  }

  const results = [];
  const pending = [...authors];

  while (pending.length) {
    const target = pending[0];
    log('\n' + '='.repeat(18) + ' TARGET: ' + target);

    const idx = await page.evaluate((t) => {
      const cards = document.querySelectorAll('section.note-item, .note-item');
      for (let i = 0; i < cards.length; i++) {
        const au = cards[i].querySelector('.author .name, .name, .author-wrapper');
        const ti = cards[i].querySelector('.title span, .title, a.title');
        if (au && au.innerText.trim() === t) return i;
        if (ti && ti.innerText.trim().includes(t)) return i;
      }
      return -1;
    }, target);

    if (idx < 0) {
      // 滚动加载，最多再试4轮
      let found = false;
      for (let r = 0; r < 4 && !found; r++) {
        await page.mouse.wheel(0, 2400);
        await page.waitForTimeout(1700);
        const i2 = await page.evaluate((t) => {
          const cards = document.querySelectorAll('section.note-item, .note-item');
          for (let i = 0; i < cards.length; i++) {
            const au = cards[i].querySelector('.author .name, .name, .author-wrapper');
            const ti = cards[i].querySelector('.title span, .title, a.title');
            if (au && au.innerText.trim() === t) return i;
            if (ti && ti.innerText.trim().includes(t)) return i;
          }
          return -1;
        }, target);
        if (i2 >= 0) { found = true; pending.shift(); await openCard(i2, target, page, ctx, outDir, results); break; }
      }
      if (!found) {
        log('NOT_FOUND: ' + target);
        results.push({ target, found: false });
        pending.shift();
      }
      continue;
    }
    pending.shift();
    await openCard(idx, target, page, ctx, outDir, results);
  }

  fs.writeFileSync(path.join(outDir, 'targets.json'), JSON.stringify(results, null, 2), 'utf8');
  log('\n### DONE ' + results.length + ' 条');
  process.exit(0);

  async function openCard(idx, target, page, ctx, outDir, results) {
    log('FOUND at card ' + (idx + 1) + '  url-before: ' + page.url().slice(0, 80));
    const cards = page.locator('section.note-item, .note-item');
    try {
      await cards.nth(idx).click({ timeout: 12000 });
    } catch (e) {
      log('CLICK_ERR ' + String(e.message).split('\n')[0]);
      return;
    }
    await page.waitForTimeout(5000);

    // 滚动加载评论（在弹层内）
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 1500);
      await page.waitForTimeout(1400);
    }

    const info = await page.evaluate(() => {
      const g = (s) => { const e = document.querySelector(s); return e ? e.innerText.trim() : ''; };
      const comments = [];
      document.querySelectorAll('.comment-item, .parent-comment, [class*="commentItem"]').forEach((el) => {
        const q = (s) => { const e = el.querySelector(s); return e ? e.innerText.trim() : ''; };
        const name = q('.author .name') || q('.name') || '';
        const content = q('.content') || '';
        const date = q('.date') || '';
        if (content) comments.push({ name: name.slice(0, 24), content: content.slice(0, 400), date });
      });
      const imgs = [];
      document.querySelectorAll('img').forEach((im) => {
        const s = im.currentSrc || im.src || im.getAttribute('data-src') || '';
        if (/xhscdn/.test(s) && !/avatar|fe-static/.test(s)) imgs.push(s.split('?')[0]);
      });
      return {
        title: g('#detail-title') || g('.note-content .title') || '',
        desc: g('#detail-desc') || g('.note-content .desc') || '',
        author: g('.author-wrapper .name') || '',
        date: g('.bottom-container .date') || g('.date') || '',
        url: location.href,
        comments,
        imgs: [...new Set(imgs)].slice(0, 15),
      };
    });

    log('TITLE : ' + info.title);
    log('AUTHOR: ' + info.author + '  DATE: ' + info.date);
    log('DESC  : ' + (info.desc || '(空)').slice(0, 400));
    log('评论数: ' + info.comments.length);
    info.comments.slice(0, 25).forEach((c, i) =>
      log('  [' + (i + 1) + '] ' + c.name + ' (' + c.date + '): ' + c.content.replace(/\n+/g, ' ').slice(0, 150))
    );

    const safe = target.replace(/[^\u4e00-\u9fa50-9a-zA-Z]/g, '_');
    try { await page.screenshot({ path: path.join(outDir, 't_' + safe + '.png') }); } catch (e) {}

    results.push({ target, found: true, ...info });

    // ESC 关闭弹层（保持搜索页状态）
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1800);
  }
})();
