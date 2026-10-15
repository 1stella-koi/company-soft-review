const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');

const log = (...a) => console.log(...a);
const norm = (u) => u.split('?')[0].replace(/!.*$/, '');

function download(url, dst) {
  return new Promise((resolve, reject) => {
    const f = fs.createWriteStream(dst);
    https
      .get(
        url,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/152.0.0.0',
            Referer: 'https://www.xiaohongshu.com/',
            Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          },
        },
        (r) => {
          if (r.statusCode !== 200) {
            f.close();
            reject(new Error('HTTP ' + r.statusCode));
            return;
          }
          r.pipe(f);
          f.on('finish', () => f.close(resolve));
        }
      )
      .on('error', (e) => {
        f.close();
        reject(e);
      });
  });
}

(async () => {
  const outDir = process.argv[2];
  const kwIdx = parseInt(process.argv[3] || '1', 10);
  const maxCards = parseInt(process.argv[4] || '8', 10);

  const kwFile = path.join(__dirname, '_keywords.txt');
  const kws = fs
    .readFileSync(kwFile, 'utf8')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const kw = kws[kwIdx - 1];
  if (!kw) {
    log('关键词索引无效');
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  log('### KW[' + kwIdx + '] ' + kw + '   maxCards=' + maxCards);

  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => !p.url().startsWith('devtools://')) || (await ctx.newPage());
  page.setDefaultTimeout(22000);

  const searchUrl =
    'https://www.xiaohongshu.com/search_result?keyword=' +
    encodeURIComponent(kw) +
    '&source=web_explore_feed';

  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  try {
    await page.waitForSelector('section.note-item', { timeout: 20000 });
  } catch (e) {
    log('NO_CARDS');
    process.exit(4);
  }
  await page.waitForTimeout(4000);

  const results = [];

  for (let i = 1; i <= maxCards; i++) {
    log('\n' + '-'.repeat(18) + ' CARD ' + i + ' ' + '-'.repeat(18));

    // 确保在搜索页
    if (!page.url().includes('search_result')) {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(3500);
    }

    let cards = page.locator('section.note-item');
    let n = await cards.count();
    if (i > n) {
      log('超出卡片数 ' + n);
      break;
    }

    const cardText = (await cards.nth(i - 1).innerText().catch(() => '')).replace(/\n+/g, ' | ');
    log('CARD_TEXT ' + cardText.slice(0, 110));

    const before = ctx.pages().length;
    try {
      await cards.nth(i - 1).click({ timeout: 12000 });
    } catch (e) {
      log('CLICK_ERR ' + String(e.message).split('\n')[0]);
      try {
        await cards.nth(i - 1).locator('a').first().click({ timeout: 10000 });
      } catch (e2) {
        log('CLICK_A_ERR');
        continue;
      }
    }
    await page.waitForTimeout(5500);

    const after = ctx.pages();
    let tp = page;
    if (after.length > before) {
      tp = after[after.length - 1];
    }
    log('URL ' + tp.url().slice(0, 110));

    let info = { title: '', desc: '', author: '', date: '', body: '', imgs: [], hasDetail: false };
    try {
      info = await tp.evaluate(() => {
        const g = (s) => {
          const e = document.querySelector(s);
          return e ? e.innerText.trim() : '';
        };
        const body = document.body ? document.body.innerText : '';
        const imgs = [];
        document.querySelectorAll('img').forEach((im) => {
          const s = im.currentSrc || im.src || im.getAttribute('data-src') || '';
          if (/xhscdn/.test(s) && !/avatar|fe-static/.test(s)) imgs.push(s.split('?')[0]);
        });
        return {
          title: g('#detail-title') || g('.note-content .title') || '',
          desc: g('#detail-desc') || g('.note-content .desc') || '',
          author: g('.author-wrapper .name') || g('.username') || '',
          date: g('.bottom-container .date') || g('.date') || '',
          body: body.replace(/\n+/g, ' | ').slice(0, 4000),
          imgs: [...new Set(imgs)].slice(0, 20),
          hasDetail: !!document.querySelector('#detail-desc'),
        };
      });
    } catch (e) {
      log('EVAL_ERR ' + String(e.message).split('\n')[0]);
    }

    log('TITLE : ' + info.title);
    log('AUTHOR: ' + info.author + '  DATE: ' + info.date + '  DETAIL_NODE: ' + info.hasDetail);
    log('DESC  : ' + (info.desc || '(空)').slice(0, 600));
    log('BODY  : ' + (info.body || '').slice(0, 800));
    log('IMGS  : ' + (info.imgs || []).length);

    const saved = [];
    for (let k = 0; k < Math.min((info.imgs || []).length, 9); k++) {
      const dst = path.join(outDir, 'c' + String(i).padStart(2, '0') + '_' + (k + 1) + '.jpg');
      try {
        await download(norm(info.imgs[k]), dst);
        saved.push(path.basename(dst));
      } catch (e) {}
    }
    log('SAVED : ' + saved.length);

    try {
      await tp.screenshot({ path: path.join(outDir, 'c' + String(i).padStart(2, '0') + '_shot.png') });
    } catch (e) {}

    results.push({ idx: i, cardText, url: tp.url(), ...info, saved });

    // 清理：关闭新页面或 ESC
    try {
      if (tp !== page) {
        await tp.close();
      } else {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1200);
        if (!page.url().includes('search_result')) {
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        }
      }
    } catch (e) {}
    await page.waitForTimeout(1500);
  }

  fs.writeFileSync(path.join(outDir, 'traverse.json'), JSON.stringify(results, null, 2), 'utf8');
  log('\n### DONE  共处理 ' + results.length + ' 张卡片');
  process.exit(0);
})();
