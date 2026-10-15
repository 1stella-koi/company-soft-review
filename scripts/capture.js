const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CDP = 'http://127.0.0.1:9222';

function log(...a) {
  console.log(...a);
}

(async () => {
  const outDir = process.argv[2];
  let keywords = process.argv.slice(3);
  if (!outDir) {
    log('用法: node capture.js <输出目录> [关键词...]');
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const kwFile = path.join(__dirname, '_keywords.txt');
  if (fs.existsSync(kwFile)) {
    const fromFile = fs
      .readFileSync(kwFile, 'utf8')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (fromFile.length) {
      keywords = fromFile;
      log('关键词来源: _keywords.txt');
    }
  }
  if (keywords.length === 0) {
    log('无关键词，退出');
    process.exit(1);
  }
  log('关键词: ' + JSON.stringify(keywords));

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP);
  } catch (e) {
    log('CDP_CONNECT_FAIL: ' + String(e.message).split('\n')[0]);
    log('提示：请先双击 start_debug_chrome.bat 启动浏览器');
    process.exit(2);
  }

  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => !p.url().startsWith('devtools://')) || (await ctx.newPage());

  // 先确认登录态
  await page.goto('https://www.xiaohongshu.com/explore', {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  await page.waitForTimeout(4000);
  const loginState = await page.evaluate(() => {
    const t = document.body ? document.body.innerText : '';
    return {
      url: location.href,
      isLoginPage: location.href.includes('/login'),
      hasLoginBtn: !!document.querySelector('.login-btn'),
      hasAvatar: !!document.querySelector('.user-avatar, .avatar-wrapper, img.avatar, .side-bar .user'),
      noteItems: document.querySelectorAll('section.note-item, .note-item').length,
      head: t.replace(/\n+/g, ' | ').slice(0, 160),
    };
  });
  log('### LOGIN_STATE ' + JSON.stringify(loginState));
  if (loginState.isLoginPage || loginState.hasLoginBtn) {
    log('### ABORT: 未检测到登录态，请先在浏览器窗口里登录小红书');
    try {
      await page.screenshot({ path: path.join(outDir, 'abort_not_logged_in.png') });
      log('已截图 abort_not_logged_in.png');
    } catch (e) {}
    process.exit(3);
  }
  log('### 登录态确认，开始搜索');

  const allNotes = [];

  for (const kw of keywords) {
    log('\n########## 搜索: ' + kw + ' ##########');
    const url =
      'https://www.xiaohongshu.com/search_result?keyword=' +
      encodeURIComponent(kw) +
      '&source=web_explore_feed';
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (e) {
      log('GOTO_ERR: ' + String(e.message).split('\n')[0]);
    }

    // 等笔记卡片渲染
    let got = 0;
    try {
      await page.waitForSelector('section.note-item, .note-item', { timeout: 15000 });
      got = await page.locator('section.note-item, .note-item').count();
    } catch (e) {
      got = await page.locator('section.note-item, .note-item').count();
    }
    log('卡片数: ' + got);

    // 滚动加载更多
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, 2200);
      await page.waitForTimeout(1600);
    }

    const state = await page.evaluate(() => {
      const t = document.body ? document.body.innerText : '';
      return {
        url: location.href,
        loginWall: t.includes('登录后查看') || t.includes('登录后查看更多'),
        risk: t.includes('300012') || t.includes('IP存在风险'),
        empty: t.includes('暂无') || t.includes('没有找到'),
      };
    });
    log('页面状态: ' + JSON.stringify(state));

    const notes = await page.evaluate(() => {
      const out = [];
      const seen = new Set();
      const cards = document.querySelectorAll('section.note-item, .note-item');
      cards.forEach((c) => {
        const a = c.querySelector('a.cover, a[href*="/explore/"], a[href*="/search_result/"]');
        let href = a ? a.getAttribute('href') || '' : '';
        if (href.startsWith('/')) href = 'https://www.xiaohongshu.com' + href;
        const img = c.querySelector('img');
        const cover = img ? img.currentSrc || img.src || img.getAttribute('data-src') || '' : '';
        const titleEl = c.querySelector('.title span, .title, a.title, .note-title');
        const authorEl = c.querySelector('.author .name, .name, .author-wrapper');
        const likeEl = c.querySelector('.like-wrapper .count, .count');
        const note = {
          title: titleEl ? titleEl.innerText.trim() : '',
          author: authorEl ? authorEl.innerText.trim() : '',
          likes: likeEl ? likeEl.innerText.trim() : '',
          cover,
          href,
          kw: '',
        };
        const key = note.href || note.cover;
        if (!key || seen.has(key)) return;
        seen.add(key);
        if (note.title || note.cover) out.push(note);
      });
      return out.slice(0, 40);
    });
    notes.forEach((n) => (n.kw = kw));
    log('提取笔记数: ' + notes.length);
    notes.slice(0, 12).forEach((n, i) => {
      log(`  [${i + 1}] ${n.title || '(无标题)'} | ${n.author || '-'} | 赞${n.likes || '-'}`);
    });

    const safe = kw.replace(/[^\u4e00-\u9fa50-9a-zA-Z]/g, '_');
    try {
      await page.screenshot({ path: path.join(outDir, `search_${safe}.png`), fullPage: false });
      log('截图: search_' + safe + '.png');
    } catch (e) {
      log('SHOT_ERR: ' + String(e.message).split('\n')[0]);
    }

    allNotes.push(...notes);
    await page.waitForTimeout(1500);
  }

  fs.writeFileSync(path.join(outDir, 'notes.json'), JSON.stringify(allNotes, null, 2), 'utf8');
  log('\n### 汇总: 共 ' + allNotes.length + ' 条笔记，已存 notes.json');
  log('### DONE');
  process.exit(0);
})();
