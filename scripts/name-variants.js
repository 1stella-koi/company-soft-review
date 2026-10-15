#!/usr/bin/env node
/**
 * name-variants.js —— 软口碑检索「四层关键词矩阵」生成器
 *
 * 输入工商全称（+ 可选人工锚点），输出四层检索词、歧义等级、平台投放分配表。
 *
 * 用法：
 *   基础（只给全称，自动推导可用变体）：
 *     node name-variants.js "某某市某某企业管理咨询有限公司"
 *
 *   完整（补锚点，收益最大的一步）：
 *     node name-variants.js "某某市某某企业管理咨询有限公司" \
 *       --legal "法定代表人姓名" \
 *       --brand "品牌名/官网用名" \
 *       --product "产品名1,产品名2" \
 *       --selfname "员工自称/内部花名" \
 *       --addr "门牌号,写字楼名,园区,片区路名" \
 *       --biz "核心业务词,岗位词1,岗位词2" \
 *       --out "C:/path/to/output"
 *
 * 输出：
 *   - stdout：Markdown 检索词矩阵
 *   - <out>/name_variants.md    同上（存档）
 *   - <out>/name_variants.json  结构化数据（供 capture.js 等脚本消费）
 *   - <out>/_keywords.txt       自动写入「社区类平台应投放的全称+变体」，可直接喂给 capture.js
 *
 * 设计原则（见 SKILL.md / references/channels.md）：
 *   简称不替代全称，只作扩召回层；一切变体必须过「消歧闸门」才可采信。
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- 词表

// 行政区划前缀（长词优先匹配）
const REGIONS = [
  '中国', '中华',
  '内蒙古', '黑龙江', '新疆', '西藏', '宁夏', '广西',
  '北京', '天津', '上海', '重庆',
  '河北', '山西', '辽宁', '吉林', '江苏', '浙江', '安徽', '福建', '江西', '山东',
  '河南', '湖北', '湖南', '广东', '海南', '四川', '贵州', '云南', '陕西', '甘肃', '青海',
  '台湾', '香港', '澳门',
  '石家庄', '太原', '沈阳', '大连', '长春', '哈尔滨', '南京', '苏州', '无锡', '常州',
  '杭州', '宁波', '温州', '嘉兴', '金华', '合肥', '福州', '厦门', '泉州', '南昌',
  '济南', '青岛', '烟台', '郑州', '武汉', '长沙', '广州', '深圳', '珠海', '东莞',
  '佛山', '中山', '惠州', '南宁', '海口', '成都', '绵阳', '贵阳', '昆明',
  '西安', '兰州', '西宁', '银川', '乌鲁木齐', '拉萨', '天津', '浦东', '滨海', '两江',
];

// 行业/业务描述词（出现在字号之后，可剥离以取出字号）
const INDUSTRY_WORDS = [
  '企业管理咨询', '企业咨询', '管理咨询', '企业管理', '企业服务',
  '人力资源咨询', '人力资源服务', '人力资源', '劳务', '猎头',
  '信息技术咨询', '信息技术服务', '信息技术',
  '网络科技', '信息科技', '数据科技', '智能科技', '数字科技', '电子科技',
  '生物科技', '医疗科技', '环保科技', '新能源科技', '教育科技',
  '安全咨询', '安全科技', '安全技术', '工程技术', '技术服务', '技术咨询',
  '工程设计', '工程咨询', '工程管理', '建设', '建筑', '装饰',
  '文化传媒', '文化传播', '影视文化', '广告传媒', '传媒',
  '电子商务', '商贸', '贸易', '进出口', '供应链管理', '供应链', '物流',
  '软件开发', '软件技术', '软件', '网络技术', '信息技术开发',
  '计算机系统', '计算机', '系统集成', '电子', '通信技术', '通信',
  '教育咨询', '教育管理', '教育培训', '咨询', '科技', '实业', '投资管理', '投资',
  '餐饮管理', '酒店管理', '物业管理', '商业管理', '品牌管理',
  '服务', '中心', '研究所', '研究院',
];

// 组织形式后缀（从尾部剥离，可叠加）
const ORG_SUFFIXES = [
  '股份有限公司', '有限责任公司', '有限公司', '集团有限公司', '集团有限责任公司',
  '合伙企业', '有限合伙', '普通合伙', '分公司', '子公司', '公司', '厂', '店', '中心', '部',
];

// 通用词（剥离后若剩余为空，说明字号本身就是通用词 → 高危）
const GENERIC_TOKENS = ['科技', '咨询', '企业', '管理', '服务', '实业', '商务', '网络', '信息', '教育', '文化', '投资'];

// ---------------------------------------------------------------- 参数解析

function parseArgs(argv) {
  const out = { name: '', out: process.cwd(), list: [] };
  const multi = { product: [], addr: [], biz: [], selfname: [] };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--legal') out.legal = args[++i];
    else if (a === '--brand') out.brand = args[++i];
    else if (a === '--product') multi.product.push(...splitList(args[++i]));
    else if (a === '--addr') multi.addr.push(...splitList(args[++i]));
    else if (a === '--biz') multi.biz.push(...splitList(args[++i]));
    else if (a === '--selfname') multi.selfname.push(...splitList(args[++i]));
    else if (a === '--out') out.out = args[++i];
    else if (a === '--quiet') out.quiet = true;
    else if (!a.startsWith('--') && !out.name) out.name = a;
    else if (!a.startsWith('--')) out.list.push(a);
  }
  Object.assign(out, multi);
  return out;
}

function splitList(s) {
  if (!s) return [];
  return String(s)
    .split(/[,，、/|]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------- 拆名逻辑

const NORM = (s) => String(s || '').replace(/\s+/g, '').replace(/[（(]/g, '（').replace(/[）)]/g, '）');

/**
 * 从全称中剥离「组织形式后缀」，返回 { core, suffixStack }
 * 支持「...企业管理（集团）有限公司」这类嵌套
 */
function stripOrgSuffix(name) {
  let s = name;
  const stripped = [];
  let guard = 0;
  while (guard++ < 6) {
    let hit = false;
    // 先把裸括号形式的（集团）归一处理
    for (const suf of ORG_SUFFIXES) {
      if (s.endsWith(suf) && s.length > suf.length) {
        stripped.unshift(suf);
        s = s.slice(0, -suf.length);
        hit = true;
        break;
      }
    }
    if (!hit) break;
  }
  // 清理悬挂的「（集团）」「集团」以及末尾括号
  s = s.replace(/（集团）$/, '').replace(/（$/, '').replace(/）$/, '');
  if (s.endsWith('集团')) s = s.slice(0, -2);
  return { core: s, suffixStack: stripped };
}

/** 剥离行政区划前缀，返回 { core, region } */
function stripRegion(name) {
  // 白名单匹配（长词优先）
  for (const r of REGIONS.slice().sort((a, b) => b.length - a.length)) {
    if (name.startsWith(r) && name.length > r.length) {
      // 若白名单词后紧跟「市/省/区/县」，一并吞掉（避免「深圳」+「市腾讯…」的误切）
      const next = name[r.length];
      const region = next && '省市县区'.includes(next) ? r + next : r;
      return { core: name.slice(region.length), region };
    }
  }
  // 未在白名单中的地域前缀：形如「XX省」「XX市」「XX区」「XX县」
  const m = name.match(/^(.{2,4}?)(自治区|特别行政区|省|市|区|县)/);
  if (m && name.length > m[0].length) {
    return { core: name.slice(m[0].length), region: m[1] + m[2] };
  }
  return { core: name, region: '' };
}

/** 反复剥离尾部行业词，返回 { brand, industryWords } */
function stripIndustry(name) {
  let s = name;
  const removed = [];
  let guard = 0;
  while (guard++ < 6) {
    let hit = false;
    for (const w of INDUSTRY_WORDS.sort((a, b) => b.length - a.length)) {
      if (s.endsWith(w) && s.length > w.length) {
        removed.unshift(w);
        s = s.slice(0, -w.length);
        hit = true;
        break;
      }
    }
    if (!hit) break;
  }
  return { brand: s, industryWords: removed };
}

/** 完整拆名：全称 → { region, regionShort, brand(字号), industry, org } */
function decompose(fullName) {
  const norm = NORM(fullName);
  const { core: noOrg, suffixStack } = stripOrgSuffix(norm);
  const { core: noRegion, region } = stripRegion(noOrg);
  const { brand, industryWords } = stripIndustry(noRegion);
  // 检索词用短地域：员工不会写「深圳市腾讯」，只会写「深圳腾讯」
  const regionShort = region.replace(/(自治区|特别行政区|省|市|区|县)$/, '');
  return {
    full: norm,
    region,
    regionShort: regionShort || region,
    brand,
    industryWords,
    org: suffixStack.join(''),
    nameBody: noRegion, // 无地域无组织形式的主体串
  };
}

/** 拼音首字母（仅用于标注「禁用」） */
function initials(str) {
  // 极简实现：不引入拼音库，无法准确转写中文 → 仅对已知全称给出占位提示
  return '';
}

// ---------------------------------------------------------------- 四层矩阵构建

/**
 * L1 全称锚定层 —— 一切渠道的基准词，招聘类平台唯一用词
 */
function buildL1(d) {
  const list = [{ kw: d.full, note: '工商全称（最精确锚点）' }];
  if (d.full !== NORM(d.full).replace(/有限公司$/, '')) {
    // 无组织形式版本（部分平台收录时省略）
  }
  const noOrgFull = d.region + d.nameBody;
  if (noOrgFull && noOrgFull !== d.full) {
    list.push({ kw: noOrgFull, note: '全称去组织形式（部分页面标题省略"有限公司"）' });
  }
  return list;
}

/**
 * L2 名称变体层 —— 简称 / 品牌名 / 字号 / 产品名 / 员工自称
 * 社区类平台的主力，收益最高也最容易误配
 */
function buildL2(d, opt) {
  const list = [];
  const push = (kw, note, risk) => {
    if (!kw) return;
    if (list.some((x) => x.kw === kw)) return;
    if (kw.length < 2) return; // 单字禁用
    list.push({ kw, note, risk: risk || riskOf(kw) });
  };

  push(d.brand, '字号（最常用简称）');
  push(d.regionShort + d.brand, '地域+字号（短地域，贴近员工口语写法）');
  if (d.brand && d.industryWords.length) {
    push(d.brand + shortIndustry(d.industryWords), '字号+行业简写');
  }
  if (d.nameBody && d.nameBody !== d.brand) push(d.nameBody, '去地域主体名');
  push(opt.brand, '品牌名（官网/公众号用名）', '低');
  (opt.product || []).forEach((p) => push(p, '产品名/项目名（内部黑话，命中即高概率真实员工）', '低'));
  (opt.selfname || []).forEach((p) => push(p, '员工自称/花名（专属性最强的变体）', '低'));
  return list;
}

/** 行业词取前 2 字作为简写：企业管理咨询 → 咨询；网络科技 → 科技 */
function shortIndustry(words) {
  const w = words[words.length - 1] || '';
  const map = {
    企业管理咨询: '咨询', 企业咨询: '咨询', 管理咨询: '咨询', 人力资源: '人力',
    人力资源服务: '人力', 教育咨询: '教育', 安全咨询: '安全',
    网络科技: '科技', 信息科技: '科技', 数据科技: '科技', 智能科技: '科技',
    生物科技: '生物', 医疗科技: '医疗', 环保科技: '环保',
    文化传媒: '传媒', 文化传播: '文化', 电子商务: '电商', 供应链管理: '供应链',
  };
  if (map[w]) return map[w];
  return w.length > 4 ? w.slice(0, 3) : w;
}

/**
 * L3 场景锚点层 —— 对付「完全不带公司名」的匿名吐槽（必需项）
 */
function buildL3(d, opt) {
  const list = [];
  (opt.addr || []).forEach((a) => list.push({ kw: a, note: '门牌/写字楼/园区（同片区可定位）' }));
  (opt.biz || []).forEach((b) => list.push({ kw: b, note: '业务词/岗位词（匿名吐槽常带岗位）' }));
  (opt.product || []).forEach((p) => list.push({ kw: p, note: '产品名（兼作场景锚点）' }));
  return list;
}

/**
 * L4 人名锚点层 —— 法人 / 实控人 / 高管（员工吐槽常以人名视角出现）
 */
function buildL4(d, opt) {
  const list = [];
  if (opt.legal) list.push({ kw: opt.legal, note: '法定代表人（搜后切"用户"标签找企业号/员工号）' });
  return list;
}

/** 组合词生成：锚点 × 主体，用于提高召回精度 */
function buildCombos(d, opt) {
  const combos = [];
  const anchors = [];
  if (d.regionShort) anchors.push(d.regionShort);
  (opt.biz || []).slice(0, 3).forEach((b) => anchors.push(b));
  (opt.addr || []).slice(0, 2).forEach((a) => anchors.push(a));
  anchors.forEach((a) => {
    combos.push({ kw: `${d.brand} ${a}`, note: `字号+锚点共现（过 R1 消歧）` });
  });
  return combos;
}

/** 歧义风险评估 */
function riskOf(kw) {
  const len = kw.replace(/\s/g, '').length;
  if (len <= 2) return '高';
  if (len === 3) return '中';
  return '低';
}

/** 失效清单（禁用词） */
function buildBanned(d) {
  return [
    { kw: '拼音首字母（如 ' + (d.brand ? d.brand + '→' + 'xx' : 'XX') + '）', why: '中文语境无人使用，噪音≈100%' },
    { kw: '单字简称', why: '歧义爆炸' },
    { kw: '纯通用词（咨询/科技/服务）', why: '无主体指向' },
  ];
}

// ---------------------------------------------------------------- 平台分配

const PLATFORM_ASSIGN = [
  { platform: '职Q / BOSS直聘 / 职友集 / 猎聘', use: 'L1', why: '招聘平台已做主体绑定，全称直达主体页，简称反而丢精度' },
  { platform: '小红书 / 知乎 / 贴吧 / NGA', use: 'L1+L2+L3+L4', why: '用户自发发言、不愿写全称，四层都要跑' },
  { platform: '工商数据库（企查查/天眼查）', use: 'L1', why: '精确匹配，简称会撞车' },
];

// ---------------------------------------------------------------- 输出

function renderMarkdown(ctx) {
  const { d, L1, L2, L3, L4, combos, banned, opt } = ctx;
  const L = [];
  L.push(`# 四层检索词矩阵 · ${d.full}`);
  L.push('');
  L.push(`- **拆解结果**：地域「${d.region || '—'}」｜字号「${d.brand || '—'}」｜行业「${d.industryWords.join('') || '—'}」｜组织形式「${d.org || '—'}」`);  L.push(`- 生成时间：${new Date().toLocaleString('zh-CN')}`);
  L.push('');
  L.push('> 使用铁律：**简称不替代全称，只作扩召回层**；任何变体命中都必须过「消歧闸门」才可写入报告。');
  L.push('');

  const table = (title, rows, startNo) => {
    L.push(`## ${title}`);
    if (!rows.length) {
      L.push('_（无，需人工补充锚点）_');
      L.push('');
      return startNo;
    }
    L.push('');
    L.push('| # | 检索词 | 说明 | 歧义 |');
    L.push('|---|---|---|---|');
    let n = startNo;
    rows.forEach((r) => {
      L.push(`| ${n++} | \`${r.kw}\` | ${r.note || ''} | ${r.risk || '—'} |`);
    });
    L.push('');
    return n;
  };

  let n = 1;
  n = table('L1 全称锚定层（所有渠道基准）', L1, n);
  n = table('L2 名称变体层（社区平台主力）', L2, n);
  n = table('L3 场景锚点层（对付无公司名的匿名吐槽，必需）', L3, n);
  n = table('L4 人名锚点层', L4, n);
  n = table('组合词（字号线 × 锚点，提高精度）', combos, n);

  L.push('## 平台投放分配');
  L.push('');
  L.push('| 平台类型 | 投放层 | 原因 |');
  L.push('|---|---|---|');
  PLATFORM_ASSIGN.forEach((p) => L.push(`| ${p.platform} | **${p.use}** | ${p.why} |`));
  L.push('');

  L.push('## 消歧闸门（三条，缺一不可）');
  L.push('');
  L.push('- **R1 共现规则**：2 字简称单独出现**不予采信**，必须与至少一个锚点（地域/行业词/人名/门牌/岗位）同现。');
  L.push('- **R2 碰撞检测**：结果中出现形近字或同前缀的其他主体，**立即标红并单列**，不得混入证据表。');
  L.push('- **R3 归属验证（一票否决）**：任何要写入报告的内容，必须能落到公司主体上（职Q `companyDetail` 链接、笔记内的公司名/门牌/产品名等硬指代）。验证不了 → 降级为线索或直接弃用。');
  L.push('');

  L.push('## 禁用词（勿浪费查询）');
  L.push('');
  banned.forEach((b) => L.push(`- ${b.kw} —— ${b.why}`));
  L.push('');
  L.push('> 例外：超知名企业的花名（鹅厂 / 开水团）本身已是唯一指代，可单独搜。');
  L.push('');

  L.push('## 下一步');
  L.push('');
  L.push('1. 把 L1+L2+L3+L4 的本体词写入 `_keywords.txt`（已自动生成），交给 `capture.js` / `deepscroll.js` 在小红书站内跑。');
  L.push('2. 招聘类平台（职Q/BOSS/职友集/猎聘）**只用 L1 全称**检索。');
  L.push('3. 采集结果逐条过消歧闸门，再进证据分级（S/A/B）。');
  L.push('');
  L.push('---');
  L.push('');
  L.push('_本文件由 company-soft-review 技能的 `scripts/name-variants.js` 生成。_');
  return L.join('\n');
}

// ---------------------------------------------------------------- main

function main() {
  const opt = parseArgs(process.argv);
  if (!opt.name) {
    console.error('用法: node name-variants.js "<工商全称>" [--legal 法人] [--brand 品牌名] [--product 产品名,产品名] [--selfname 员工自称] [--addr 门牌] [--biz 业务词] [--out 输出目录]');
    process.exit(1);
  }

  const d = decompose(opt.name);
  const L1 = buildL1(d);
  const L2 = buildL2(d, opt);
  const L3 = buildL3(d, opt);
  const L4 = buildL4(d, opt);
  const combos = buildCombos(d, opt);
  const banned = buildBanned(d);

  const ctx = { d, L1, L2, L3, L4, combos, banned, opt };
  const md = renderMarkdown(ctx);

  // 落盘
  const outDir = opt.out;
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'name_variants.md'), md, 'utf8');

    // _keywords.txt：社区类平台应投放的「本体词」（不含组合词，组合词由 capture 逐条处理）
    const kwLines = []
      .concat(L1.map((x) => x.kw))
      .concat(L2.map((x) => x.kw))
      .concat(L3.map((x) => x.kw))
      .concat(L4.map((x) => x.kw));
    const uniq = [...new Set(kwLines)];
    fs.writeFileSync(path.join(outDir, '_keywords.txt'), uniq.join('\n') + '\n', 'utf8');

    fs.writeFileSync(
      path.join(outDir, 'name_variants.json'),
      JSON.stringify(
        {
          full: d.full,
          parts: { region: d.region, brand: d.brand, industry: d.industryWords.join(''), org: d.org },
          layers: { L1, L2, L3, L4, combos },
          platform_assign: PLATFORM_ASSIGN,
          banned,
          keywords: uniq,
          generated_at: new Date().toISOString(),
        },
        null,
        2
      ),
      'utf8'
    );
  } catch (e) {
    console.error('写盘失败: ' + e.message);
  }

  if (!opt.quiet) {
    console.log(md);
    console.log('');
    console.log(`[已写出] ${path.join(outDir, 'name_variants.md')}`);
    console.log(`[已写出] ${path.join(outDir, '_keywords.txt')}  ← 可直接喂给 capture.js`);
    console.log(`[已写出] ${path.join(outDir, 'name_variants.json')}`);
  }
}

main();
