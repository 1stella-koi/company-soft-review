const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const log = (...a) => console.log(...a);

(async () => {
  const outDir = process.argv[2];
  const url = process.argv[3];
  const tag = process.argv[4] || 'c';
  const scrolls = parseInt(process.argv[5] || '10', 10);
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => !p.url().startsWith('devtools://')) || (await ctx.newPage());
  page.setDefaultTimeout(22000);

  log('### GOTO ' + url.slice(0, 100));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(6000);

  // 滚动加载评论
  for (let i = 0; i < scrolls; i++) {
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(1600);
  }

  const data = await page.evaluate(() => {
    const items = [];
    document.querySelectorAll('.comment-item, .parent-comment, [class*="commentItem"]').forEach((el) => {
      const q = (s) => {
        const e = el.querySelector(s);
        return e ? e.innerText.trim() : '';
      };
      const name = q('.author .name') || q('.name') || q('[class*="author"]') || '';
      const content = q('.content') || q('[class*="content"]') || el.innerText.trim();
      const date = q('.date') || q('[class*="date"]') || '';
      const like = q('.like .count') || q('[class*="like"]') || '';
      if (content && content.length > 1) {
        items.push({ name: name.slice(0, 30), content: content.slice(0, 500), date, like });
      }
    });
    const body = document.body ? document.body.innerText : '';
    return {
      count: items.length,
      items: items.slice(0, 150),
      bodyLen: body.length,
      bodyTail: body.replace(/\n+/g, ' | ').slice(-2500),
    };
  });

  log('### 评论条数: ' + data.count);
  data.items.forEach((c, i) => {
    log('[' + (i + 1) + '] ' + c.name + ' (' + c.date + ' 赞' + c.like + '): ' + c.content.replace(/\n+/g, ' '));
  });
  if (data.count === 0) {
    log('### 页面尾部内容:');
    log(data.bodyTail);
  }

  fs.writeFileSync(path.join(outDir, 'comments_' + tag + '.json'), JSON.stringify(data, null, 2), 'utf8');
  try {
    await page.screenshot({ path: path.join(outDir, 'comments_' + tag + '_shot.png') });
  } catch (e) {}
  log('### DONE');
  process.exit(0);
})();
