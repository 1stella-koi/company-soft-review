// 搜索并切到"用户"标签，提取用户列表 + 检查相关搜索词
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const log = (...a) => console.log(...a);

(async () => {
  const outDir = process.argv[2];
  const kwFile = path.join(__dirname, '_keywords.txt');
  const kws = fs.readFileSync(kwFile, 'utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => !p.url().startsWith('devtools://')) || (await ctx.newPage());
  page.setDefaultTimeout(22000);

  for (const kw of kws) {
    log('\n########## 搜索: ' + kw + ' ##########');
    const url = 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(kw) + '&source=web_explore_feed';
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(4000);

    // 相关搜索词（kws 从 Node 侧序列化传入浏览器上下文）
    const rel = await page.evaluate((kwList) => {
      const out = [];
      document.querySelectorAll('a, span, div').forEach((e) => {
        const t = (e.innerText || '').trim();
        if (t && t.length <= 14 && kwList.some((k) => k && t.includes(k)) && !out.includes(t)) out.push(t);
      });
      return out.slice(0, 20);
    }, kws);
    log('页面含关键词元素: ' + JSON.stringify(rel));

    // 切到用户标签
    try {
      const userTab = page.locator('div.tab-item, .search-tabs .tab-item, [class*="channel"] >> text=用户').first();
      await userTab.click({ timeout: 8000 });
      await page.waitForTimeout(3500);
    } catch (e) {
      log('用户标签点击失败: ' + String(e.message).split('\n')[0]);
    }

    const users = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('.user-item, section.user-item, [class*="user"] .name, .info-box').forEach((e) => {
        const name = (e.querySelector('.name, [class*="name"]') || e).innerText.trim();
        const desc = e.querySelector('.desc, [class*="desc"]') ? e.querySelector('.desc, [class*="desc"]').innerText.trim() : '';
        if (name && name.length < 30) out.push({ name, desc: desc.slice(0, 80) });
      });
      return out.slice(0, 15);
    });
    log('用户列表: ' + JSON.stringify(users, null, 1));

    const safe = kw.replace(/[^\u4e00-\u9fa50-9a-zA-Z]/g, '_');
    await page.screenshot({ path: path.join(outDir, 'users_' + safe + '.png') });
    log('截图: users_' + safe + '.png');
    await page.waitForTimeout(1200);
  }
  process.exit(0);
})();
