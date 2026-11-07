#!/usr/bin/env node
/**
 * 从 HTML 里抽出 CUES 字幕稿，导出 SRT 和纯文本口播稿。
 *
 *   node tools/export-cues.mjs <file.html> [--audit]
 *
 * 输出同名 .srt 和 .txt；--audit 额外列出字幕里出现的所有数字，便于逐条核对。
 */
import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
const audit = process.argv.includes('--audit');

if (!file) {
  console.error('用法: node tools/export-cues.mjs <file.html> [--audit]');
  process.exit(1);
}

const src = fs.readFileSync(file, 'utf8');

/* 抓 CUES 数组字面量。new Function 只解析不执行，内容是我们自己的文件，安全。 */
const m = src.match(/const\s+CUES\s*=\s*\[([\s\S]*?)\n\s*\];/);
if (!m) {
  console.error('没找到 CUES 数组。确认页面里有: const CUES = [ [...], ... ];');
  process.exit(1);
}

let cues;
try {
  cues = new Function('return [' + m[1] + '];')();
} catch (e) {
  console.error('CUES 解析失败，检查数组里是否有语法错误：');
  console.error(e.message);
  process.exit(1);
}

const plain = html => html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim();
const pad = (n, l = 2) => String(n).padStart(l, '0');

function ts(sec) {
  const h = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  return `${pad(h)}:${pad(mm)}:${pad(ss)},${pad(ms, 3)}`;
}

/* ---- SRT ---- */
let srt = '';
cues.forEach((c, i) => {
  const [a, b, html] = c;
  srt += `${i + 1}\n${ts(a)} --> ${ts(b)}\n${plain(html)}\n\n`;
});

/* ---- 纯文本 ---- */
const total = Math.round(cues[cues.length - 1][1]);
let txt = `字幕稿 / 共 ${cues.length} 句 / 总长 ${total} 秒\n`;
txt += `（每句对应画面上的出现时间，配音时按此卡点）\n\n`;
cues.forEach(c => {
  const [a, , html] = c;
  txt += `[${pad(Math.floor(a / 60))}:${pad(Math.floor(a % 60), 2)}] ${plain(html)}\n`;
});

const base = path.basename(file, '.html');
const outDir = path.dirname(file);
fs.writeFileSync(path.join(outDir, base + '.srt'), srt, 'utf8');
fs.writeFileSync(path.join(outDir, base + '.txt'), txt, 'utf8');

console.log(`✓ 共 ${cues.length} 句，总长 ${total} 秒`);
console.log(`  ${base}.srt`);
console.log(`  ${base}.txt`);

/* ---- 数字核对 ---- */
if (audit) {
  const nums = [];
  cues.forEach((c, i) => {
    const t = plain(c[2]);
    const hits = t.match(/\d[\d,]*(?:\.\d+)?/g);
    if (hits) hits.forEach(h => nums.push({ n: h, line: t, idx: i + 1 }));
  });
  console.log(`\n=== 字幕里的数字（${nums.length} 处），逐条核对出处 ===`);
  nums.forEach(x => console.log(`  ${String(x.idx).padStart(2)}  ${x.n.padEnd(8)}  ${x.line}`));
  if (!nums.length) console.log('  （无）');
  console.log('\n提醒：每个数字都要能说出出处。查不到的，画面和字幕都应留空。');
}
