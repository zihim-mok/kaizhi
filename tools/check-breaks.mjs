#!/usr/bin/env node
/**
 * 检查字幕断行：每句会折成几行、断在哪个字后面、有没有行超宽。
 *
 *   node tools/check-breaks.mjs <file.html> [--max=16]
 *
 * 这套逻辑和页面里的 balanceCue() 一致，用来在不打开浏览器的情况下
 * 提前发现「断在词中间」「破折号被拆开」这类问题。
 */
import fs from 'node:fs';

const file = process.argv[2];
const maxArg = process.argv.find(a => a.startsWith('--max='));
const CUE_MAX = maxArg ? parseFloat(maxArg.split('=')[1]) : 16.0;

if (!file) {
  console.error('用法: node tools/check-breaks.mjs <file.html> [--max=16]');
  process.exit(1);
}

const src = fs.readFileSync(file, 'utf8');
const m = src.match(/const\s+CUES\s*=\s*\[([\s\S]*?)\n\s*\];/);
if (!m) {
  console.error('没找到 CUES 数组');
  process.exit(1);
}

const cues = new Function('return [' + m[1] + '];')();
const BREAKS = '，、：。？！；';
const strip = s => s.replace(/<[^>]+>/g, '');

/* 半角算 0.55 字宽，和页面里的 textWidth 一致 */
function tw(s) {
  let w = 0;
  for (const ch of s) w += ch.codePointAt(0) < 0x2e80 ? 0.55 : 1;
  return w;
}

/**
 * 返回 { kind, lines[] }
 * kind: 'one' 一行 / 'manual' 手写换行 / 'auto' 自动断 / 'nopunct' 无标点可断
 */
function analyze(html) {
  const plain = strip(html);

  if (html.includes('<br>')) {
    const lines = html.split(/<br\s*\/?>/i).map(strip);
    return { kind: 'manual', lines };
  }
  if (tw(plain) <= CUE_MAX) return { kind: 'one', lines: [plain] };

  const pts = [];
  for (let i = 0; i < plain.length; i++) {
    if (BREAKS.includes(plain[i])) pts.push(i + 1);
    else if (plain[i] === '—' && plain[i + 1] === '—') pts.push(i + 2);
  }
  if (!pts.length) return { kind: 'nopunct', lines: [plain] };

  const target = tw(plain) / 2;
  let best = pts[0], bd = Infinity;
  for (const p of pts) {
    const d = Math.abs(tw(plain.slice(0, p)) - target);
    if (d < bd) { bd = d; best = p; }
  }
  return { kind: 'auto', lines: [plain.slice(0, best), plain.slice(best)] };
}

const stat = { one: 0, manual: 0, auto: 0, nopunct: 0, over: 0, triple: 0 };

console.log(`\n断行检查 · 单行上限 ${CUE_MAX} 全角字 · 共 ${cues.length} 句`);
console.log('─'.repeat(64));

cues.forEach((c, i) => {
  const [a, , html] = c;
  const r = analyze(html);
  stat[r.kind]++;

  const t = `[${String(Math.floor(a / 60)).padStart(2, '0')}:${String(Math.floor(a % 60)).padStart(2, '0')}]`;
  const idx = String(i + 1).padStart(2);
  const total = tw(strip(html)).toFixed(1).padStart(5);

  const widths = r.lines.map(tw);
  const widest = Math.max(...widths);
  const bad = widest > CUE_MAX + 0.3;
  if (bad) stat.over++;
  if (r.lines.length > 2) stat.triple++;

  const shown = r.lines.map(s => s.trim()).join(' ⏎ ');
  const mark = bad ? `   ← 行宽 ${widths.map(w => w.toFixed(1)).join(' / ')} 超限` : '';
  const tag = r.kind === 'manual' ? '  ⟨手写⟩' : r.kind === 'nopunct' ? '  ⟨无标点⟩' : '';

  console.log(`${idx}${t} ${total}  ${shown}${tag}${mark}`);
});

console.log('─'.repeat(64));
console.log(
  `一行 ${stat.one}　自动两行 ${stat.auto}　手写换行 ${stat.manual}　` +
  `无标点 ${stat.nopunct}　超宽行 ${stat.over}`
);

if (stat.over || stat.triple) {
  console.log('\n超宽的句子建议直接改写（比调字号有效）；');
  console.log('实在改不了，就在该句里手动加 <br>。\n');
  process.exit(1);
}
console.log('\n✓ 每行都在限宽内\n');
