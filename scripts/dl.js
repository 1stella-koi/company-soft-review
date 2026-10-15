const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const log = (...a) => console.log(...a);

function fetchTo(url, dst, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) {
      reject(new Error('too many redirects'));
      return;
    }
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
          Referer: 'https://www.xiaohongshu.com/',
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Accept-Encoding': 'identity',
        },
      },
      (r) => {
        if ([301, 302, 303, 307, 308].includes(r.statusCode)) {
          const next = new URL(r.headers.location, url).toString();
          r.resume();
          fetchTo(next, dst, depth + 1).then(resolve, reject);
          return;
        }
        if (r.statusCode !== 200) {
          r.resume();
          reject(new Error('HTTP ' + r.statusCode));
          return;
        }
        const ct = r.headers['content-type'] || '';
        const f = fs.createWriteStream(dst);
        r.pipe(f);
        f.on('finish', () => f.close(() => resolve({ ct, size: fs.statSync(dst).size })));
      }
    );
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
  });
}

(async () => {
  const jsonPath = process.argv[2];
  const outDir = process.argv[3];
  const prefix = process.argv[4] || 'p';
  fs.mkdirSync(outDir, { recursive: true });

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const arr = Array.isArray(data) ? data : [data];
  log('记录数: ' + arr.length);

  let ok = 0;
  let fail = 0;

  for (let i = 0; i < arr.length; i++) {
    const rec = arr[i];
    const imgs = rec.imgs || [];
    const tag = prefix + String(i + 1).padStart(2, '0');
    log('\n[' + tag + '] ' + (rec.title || rec.cardText || '(无标题)').slice(0, 60) + '  图片数=' + imgs.length);
    for (let k = 0; k < Math.min(imgs.length, 6); k++) {
      const u = imgs[k];
      const ext = /\.png$/i.test(u) ? '.png' : '.jpg';
      const dst = path.join(outDir, tag + '_' + (k + 1) + ext);
      try {
        const r = await fetchTo(u, dst);
        log('  OK   ' + (k + 1) + '  ' + r.ct + '  ' + r.size + 'B  ' + path.basename(dst));
        ok++;
      } catch (e) {
        log('  FAIL ' + (k + 1) + '  ' + String(e.message).split('\n')[0] + '  :: ' + u.slice(0, 80));
        fail++;
      }
    }
  }

  log('\n### 成功 ' + ok + ' / 失败 ' + fail);
  process.exit(0);
})();
