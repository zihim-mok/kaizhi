#!/usr/bin/env node
/**
 * 语法检查 + 反模式体检。
 *
 *   node tools/check-js.mjs <file.html>
 *
 * 不只是 node --check：还会挑出「能跑但违反工作流约束」的写法，
 * 这些写法不会报错，但会让 ?t= 失效、字幕复读、字体回退。
 */
import fs from 'node:fs';
import vm from 'node:vm';

const file = process.argv[2];
if (!file) {
  console.error('用法: node tools/check-js.mjs <file.html>');
  process.exit(1);
}

const src = fs.readFileSync(file, 'utf8');
const errors = [];
let warns = [];

/* ---------- 1. 语法 ---------- */
const blocks = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
if (!blocks.length) errors.push('页面里没有内联 <script>');

let js = '';
blocks.forEach((b, i) => {
  const code = b[1];
  js += code + '\n';
  try {
    new vm.Script(code, { filename: `script#${i + 1}` });
  } catch (e) {
    errors.push(`<script> #${i + 1} 语法错误：${e.message}`);
  }
});

/* ---------- 2. 结构 ---------- */
if (!/const\s+CUES\s*=\s*\[/.test(js)) {
  errors.push('没有 CUES 字幕数组 —— 字幕必须内嵌在 HTML 里');
}
/* 只有多个场景时才要求 SCENES；单场景的短版不需要 */
const sceneBlocks = (src.match(/class="scene"/g) || []).length;
if (sceneBlocks >= 2 && !/const\s+SCENES\s*=\s*\[/.test(js)) {
  errors.push(`有 ${sceneBlocks} 个场景，但没有 SCENES 时间表`);
}

/* ---------- 3. 反模式 ---------- */
const patterns = [
  [/https?:\/\/(?!www\.w3\.org)/g, '引用了外部资源（录屏时会加载失败或字体回退）'],
  [/setTimeout\s*\(/g, 'setTimeout 驱动动画 —— 应改为 render(t) 从 t 算'],
  [/setInterval\s*\(/g, 'setInterval 驱动动画 —— 应改为 render(t) 从 t 算'],
  [/「/g, '直角引号 「 —— 竖屏字幕应用中文弯引号 “'],
  [/」/g, '直角引号 」 —— 竖屏字幕应用中文弯引号 ”'],
];

patterns.forEach(([re, msg]) => {
  const hits = [...js.matchAll(re)];
  if (hits.length) {
    const lines = hits.slice(0, 3).map(h => {
      const upto = js.slice(0, h.index);
      return upto.split('\n').length;
    });
    warns.push(`${msg}（${hits.length} 处，约第 ${lines.join('/')} 行）`);
  }
});

/* ---------- 4. 可寻址能力 ---------- */
if (!/URLSearchParams/.test(js)) {
  errors.push('没有解析网址参数 —— 少了 ?t= 就没法逐帧验证');
} else {
  if (!/has\(['"]p['"]\)/.test(js) && !/PAUSED/.test(js)) {
    warns.push('没有 ?p 暂停模式 —— 截图会截到动画中间态');
  }
  if (!/nofx/.test(js) && !/transition\s*:\s*none/.test(src)) {
    warns.push('没有禁用 transition 的机制 —— ?p 截图可能仍是半透明');
  }
}

/* ---------- 5. 字幕断行 ---------- */
if (/const\s+CUES/.test(js) && !/balanceCue|textWrap|text-wrap\s*:\s*balance/.test(src)) {
  warns.push('没有中文字幕断行处理 —— 会出现「每一种 / 书」这类断在词中间');
}

/* ---------- 6. 画面文字与字幕是否复读 ----------
   这是最隐蔽的错误：两个位置说同一句话，观众读两遍，
   而且浪费了一半的屏幕。人眼很难逐条比对，交给代码。 */
if (/const\s+CUES/.test(js)) {
  function norm(x){ return x.replace(/[\s，。、：；？！“”‘’（）《》·—…]/g, '').trim(); }

  // 画面上的文字：剥掉 script/style，按标签切段
  let bodyHtml = src;
  const bm = src.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bm) bodyHtml = bm[1];
  bodyHtml = bodyHtml
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  const screenTexts = bodyHtml
    .split(/<[^>]+>/)
    .map(norm)
    .filter(t => t.length >= 6 && !/^[{};:,\d.%px]+$/.test(t));

  // 字幕文本
  let cueTexts = [];
  const cm = src.match(/const\s+CUES\s*=\s*\[([\s\S]*?)\n\s*\];/);
  if (cm) {
    try {
      const arr = new Function('return [' + cm[1] + '];')();
      cueTexts = arr.map(c => norm(String(c[2]).replace(/<[^>]+>/g, '')));
    } catch { /* 语法问题上面已经报过 */ }
  }

  const dup = new Set();
  for (const t of screenTexts) {
    for (const c of cueTexts) {
      if (t === c) dup.add(`画面与字幕完全相同：「${t}」`);
      else if (t.length >= 8 && c.length >= 8 &&
               Math.abs(t.length - c.length) < 6 &&
               (c.includes(t) || t.includes(c))) {
        // 长度接近又互相包含，说明两边说的是同一句；
        // 画面写书名、字幕把它讲成一句话（差 6 字以上）是正常分工，不报
        dup.add(`画面与字幕高度重合：「${t}」 ↔ 「${c}」`);
      }
    }
  }

  /* --- 6b. 短标签：上面按 >=6 字过滤，会漏掉「经史子集」这类四字格 --- */
  const shortLabels = bodyHtml.split(/<[^>]+>/).map(norm).filter(t => t.length >= 1 && t.length <= 3);
  const labelSet = new Set(shortLabels);

  for (const c of cueTexts) {
    if (c.length < 3 || c.length > 6) continue;
    // 字幕的每个字都能在画面上找到一个独立短标签 —— 等于在逐字念标签
    const hit = [...new Set([...c])].filter(ch => labelSet.has(ch));
    if (hit.length >= 3) {
      dup.add(`画面与字幕逐字重复：「${c}」 全是画面标签`);
    }
  }

  /* --- 6c. 数字：字幕把画面上已有的数字再念一遍，是最常见的复读 ---
     数字常常被拆在多个标签里（<span>596</span><i>/300</i>），
     所以按「场景」聚合，而不是按标签聚合。
     注意：必须先把标签剥掉，否则 SVG 的 cx="26" d="M0 27" 这类
     坐标会被当成画面上的数字，满屏假阳性。 */
  const numList = s => (s.match(/\d[\d,]*/g) || []).map(x => x.replace(/,/g, ''));
  const textOnly = s => s.replace(/<[^>]+>/g, ' ');

  const scenes = bodyHtml.split(/<section[^>]*class="scene"/i).slice(1);
  const sceneNums = (scenes.length ? scenes : [bodyHtml]).map(sc => new Set(numList(textOnly(sc))));

  for (const c of cueTexts) {
    const cn = [...new Set(numList(c))];
    if (cn.length < 2 || c.length > 26) continue;
    for (const sn of sceneNums) {
      if (cn.every(n => sn.has(n))) {
        dup.add(`画面与字幕都在念数字：「${c}」`);
        break;
      }
    }
  }

  dup.forEach(d => warns.push(d));
}

/* ---------- 输出 ---------- */
const rel = file.replace(/\\/g, '/').split('/').pop();
console.log(`\n检查 ${rel}\n${'─'.repeat(46)}`);

if (!errors.length && !warns.length) {
  console.log('✓ 全部通过\n');
  process.exit(0);
}

const dups = warns.filter(w => w.includes('画面与字幕'));
warns = warns.filter(w => !w.includes('画面与字幕'));

errors.forEach(e => console.log(`✗ ${e}`));
warns.forEach(w => console.log(`! ${w}`));
if (dups.length) {
  console.log('');
  dups.forEach(d => console.log(`✗ ${d}   ← 改掉其中一个`));
}

console.log(
  `\n${errors.length ? '✗ ' + errors.length + ' 个错误' : '✓ 语法无误'}` +
  (warns.length ? `，${warns.length} 条提醒` : '') +
  (dups.length ? `，${dups.length} 处复读` : '') + '\n'
);

process.exit(errors.length || dups.length ? 1 : 0);
