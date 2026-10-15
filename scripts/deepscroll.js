// 深度滚动搜索页，抓取尽量多的卡片标题，筛出疑似相关项
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const log = (...a) => console.log(...a);

(async () => {
  const outDir = process.argv[2];
  const kwIdx = parseInt(process.argv[3] || '1', 10);
  const scrollTimes = parseInt(process.argv[4] || '10', 10);
  fs.mkdirSync(outDir, { recursive: true });

  const kwFile = path.join(__dirname, '_keywords.txt');
  const kws = fs.readFileSync(kwFile, 'utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const kw = kws[kwIdx - 1];
  log('### KW: ' + kw + '  scrolls=' + scrollTimes);

  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => !p.url().startsWith('devtools://')) || (await ctx.newPage());
  page.setDefaultTimeout(25000);

  const url = 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(kw) + '&source=web_explore_feed';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(5000);

  for (let i = 0; i < scrollTimes; i++) {
    await page.mouse.wheel(0, 2400);
    await page.waitForTimeout(1800);
  }

  const notes = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    document.querySelectorAll('section.note-item, .note-item').forEach((c) => {
      const a = c.querySelector('a.cover, a[href*="/explore/"], a[href*="/search_result/"]');
      let href = a ? a.getAttribute('href') || '' : '';
      if (href.startsWith('/')) href = 'https://www.xiaohongshu.com' + href;
      const titleEl = c.querySelector('.title span, .title, a.title, .note-title');
      const authorEl = c.querySelector('.author .name, .name, .author-wrapper');
      const likeEl = c.querySelector('.like-wrapper .count, .count');
      const t = titleEl ? titleEl.innerText.trim() : '';
      const au = authorEl ? authorEl.innerText.trim() : '';
      const key = href || t + au;
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push({ title: t, author: au, likes: likeEl ? likeEl.innerText.trim() : '', href });
    });
    return out;
  });

  log('### 卡片总数: ' + notes.length);
  notes.forEach((n, i) => log(`[${i + 1}] ${n.title || '(无标题)'} | ${n.author} | 赞${n.likes || '-'}`));

  // 筛选疑似相关：标题/作者命中任一检索词（kws 含四层关键词），或命中通用负面/疑问词
  const rel = notes.filter((n) => {
    const t = (n.title || '') + (n.author || '');
    const kwHit = kws.some((k) => k && t.includes(k));
    const negHit = /问|怎么样|怎样|靠谱|避雷|拖欠|工资|离职|面试|加班|PUA/.test(t);
    return kwHit || negHit;
  });
  log('\n### 疑似相关 ' + rel.length + ' 条:');
  rel.forEach((n, i) => log(`  [${i + 1}] ${n.title} | ${n.author} | ${n.href.slice(0, 100)}`));

  fs.writeFileSync(path.join(outDir, 'deep_notes.json'), JSON.stringify({ kw, total: notes.length, notes, rel }, null, 2), 'utf8');
  await page.screenshot({ path: path.join(outDir, 'deep_shot.png') });
  log('### DONE');
  process.exit(0);
})();
