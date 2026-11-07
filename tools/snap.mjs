#!/usr/bin/env node
/**
 * 批量逐帧截图，用来验证画面。不要用肉眼回放。
 *
 *   node tools/snap.mjs <file.html> 4 20 48 393     # 指定时间点
 *   node tools/snap.mjs <file.html>                 # 自动取每个场景的首/中/末
 *   node tools/snap.mjs <file.html> --size=1080x1920 --out=shots
 *
 * 依赖本机安装的 Chrome 或 Edge（headless 模式），不需要 npm install。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2);
const file = argv.find(a => !a.startsWith('--') && /\.html?$/i.test(a));
const outArg = argv.find(a => a.startsWith('--out='));
const sizeArg = argv.find(a => a.startsWith('--size='));
const SIZE = sizeArg ? sizeArg.split('=')[1] : '1080,1920';
const OUT = outArg ? outArg.split('=')[1] : 'snap';
const times = argv.filter(a => !a.startsWith('--') && a !== file).map(Number).filter(n => !isNaN(n));

if (!file) {
  console.error('用法: node tools/snap.mjs <file.html> [时间点...] [--size=1080x1920] [--out=snap]');
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error(`文件不存在: ${file}`);
  process.exit(1);
}

/* ---------------- 找浏览器 ---------------- */
const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
];
const BROWSER = CANDIDATES.find(p => fs.existsSync(p));
if (!BROWSER) {
  console.error('没找到 Chrome / Edge。装一个，或修改本脚本里的 CANDIDATES。');
  process.exit(1);
}

/* ---------------- 临时目录 ----------------
   headless 对含中文的路径经常静默失败（输出 0 字节），
   所以输入和输出都先走 ASCII 路径，最后再复制回来。 */
function pickTemp() {
  const t = os.tmpdir();
  if (!/[^\x00-\x7F]/.test(t)) return t;
  const root = path.parse(process.cwd()).root;          // 例如 D:\
  const alt = path.join(root, '_vibesnap_tmp');
  fs.mkdirSync(alt, { recursive: true });
  return alt;
}
const TMP = pickTemp();
const tmpHtml = path.join(TMP, 'snap_' + Date.now() + '.html');
fs.copyFileSync(file, tmpHtml);

/* ---------------- 时间点 ---------------- */
function autoTimes() {
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(/const\s+SCENES\s*=\s*\[([\s\S]*?)\n\s*\];/);
  if (!m) return [2, 10, 20];
  let scenes;
  try {
    scenes = new Function('return [' + m[1] + '];')();
  } catch {
    return [2, 10, 20];
  }
  const out = [];
  for (const s of scenes) {
    if (typeof s.t0 !== 'number' || typeof s.t1 !== 'number') continue;
    out.push(+Math.max(0, s.t0 + 0.6).toFixed(1));
    if (s.t1 - s.t0 > 4) out.push(+((s.t0 + s.t1) / 2).toFixed(1));
    out.push(+(s.t1 - 0.6).toFixed(1));
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

const list = times.length ? times : autoTimes();
if (!list.length) {
  console.error('没有可截的时间点');
  process.exit(1);
}

/* ---------------- 截图 ---------------- */
fs.mkdirSync(OUT, { recursive: true });
console.log(`浏览器: ${BROWSER}`);
console.log(`输出:   ${path.resolve(OUT)}`);
console.log(`时间点: ${list.join(', ')}\n`);

const tmpPng = path.join(TMP, 'snap_shot.png');
let ok = 0, fail = 0;

for (const t of list) {
  const label = 't' + String(t).replace('.', '_').padStart(4, '0');
  const dest = path.join(OUT, label + '.png');
  const url = pathToFileURL(tmpHtml).href + `?t=${t}&p&clean`;

  if (fs.existsSync(tmpPng)) fs.unlinkSync(tmpPng);

  try {
    execFileSync(BROWSER, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${SIZE}`,
      `--screenshot=${tmpPng}`,
      url,
    ], { stdio: 'ignore', timeout: 45000 });
  } catch {
    /* 超时或退出码异常，下面按文件判断 */
  }

  if (fs.existsSync(tmpPng) && fs.statSync(tmpPng).size > 1000) {
    fs.copyFileSync(tmpPng, dest);
    const kb = (fs.statSync(dest).size / 1024).toFixed(0);
    console.log(`  ✓ ${label}.png  ${String(kb).padStart(5)} KB   (${t}s)`);
    ok++;
  } else {
    console.log(`  ✗ ${label}.png  失败           (${t}s)`);
    fail++;
  }
}

/* 清理 */
try { fs.unlinkSync(tmpHtml); fs.unlinkSync(tmpPng); } catch {}

console.log(`\n完成：${ok} 张成功${fail ? `，${fail} 张失败` : ''}`);
if (fail) {
  console.log('失败常见原因：');
  console.log('  1. 时间点超出 TOTAL');
  console.log('  2. 浏览器版本过旧，不支持 --headless=new（改成 --headless）');
  console.log('  3. 页面 JS 报错，导致画面全黑 —— 先用 tools/check-js.mjs 查');
  process.exit(1);
}
console.log('\n逐张检查：溢出 / 空屏 / 断行 / 复读 / 孤字 / 比例。');
console.log('清单见 docs/05-verification.md');
