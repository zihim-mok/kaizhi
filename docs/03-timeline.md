# 时间轴架构

这是整套东西的技术核心。读懂这一篇，剩下的都是排版细节。

## 一条原则

> **画面不是"演变"出来的，是"由 t 算出来"的。**

绝大多数网页动画是**过程式**的：到点了加个 class，过一会儿再改个属性。这种写法天生不可寻址 —— 你没法回答"第 137.4 秒的画面长什么样"，因为那个状态是累积出来的。

本工作流要求 `render(t)` 是**纯函数**：

```
render(t) → 画面
```

同样的 t，永远渲染出同样的画面。这带来三件事：

1. `?t=137.4` 可以直接跳到第 137.4 秒，一帧不差
2. 可以批量截图逐帧检查（`tools/snap.mjs`）
3. 掉帧只丢帧，不会累积误差，总长永远等于 `TOTAL`

## 三块数据

所有内容集中在 `<script>` 顶部，样式和渲染代码在下面。改内容只动这三块。

```js
/* 1. 全局参数 */
const TOTAL = 400;                  // 总时长（秒）

/* 2. 场景表：哪些场景，各自占哪一段 */
const SCENES = [
  { s: 0, t0: 0,   t1: 6   },
  { s: 1, t0: 6,   t1: 26  },
  { s: 2, t0: 26,  t1: 66  },
  // ...
];

/* 3. 字幕稿：绝对秒数，一句话一屏 */
const CUES = [
  [6.40, 10.20, '《汉书·艺文志》，中国现存最早的图书目录'],
  [10.40, 14.20, '它记了 <b>596 家</b>、<b>13269 卷</b>'],
];
```

**为什么字幕用绝对秒数而不是相对时长**：改分镜时要动的只有 `SCENES`，字幕自己带着坐标，挪动场景后一眼就能看出哪句超出了边界。相对时长会在多次改动后彻底失锚。

## 渲染循环

```js
let base = performance.now() / 1000 - T0;

function frame(now){
  render(now / 1000 - base);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

**必须用 `performance.now()`，不能用帧计数。** 帧计数在掉帧、切换标签页、系统休眠后会彻底失控。

`base` 减去 `T0` 是为了支持从任意点开始（`?t=`）。重播就是把 `base` 重置为当前时刻：

```js
function replay(){ base = performance.now() / 1000; curScene = -1; }
function seek(d){ base -= d; curScene = -1; }   // d 为正 = 前进
```

`curScene = -1` 是必须的：场景切换是靠"变化时切 class"实现的，重置时间后要强制它重新判断当前场景。

## 幂等渲染的写法

### ❌ 过程式（不可寻址）

```js
let lit = 0;
function frame(t){
  if (t >= lightStart + lit * step && lit < TOP){
    dots[lit].classList.add('lit');   // 状态被累积，seek 后全乱
    lit++;
  }
}
```

### ✅ 声明式（可寻址）

```js
function render(t){
  for (let i = 0; i < N; i++){
    // 每一帧都从 t 直接算出这个点该是什么状态
    const on = t >= litAt[i];
    dots[i].classList.toggle('lit', on);
  }
}
```

代价是每帧都要遍历全部元素。**288 个元素 × 60fps 完全无压力**，浏览器处理 `classList.toggle` 传相同值时不会触发重排。真要优化再上差分，不要提前优化。

### 进度映射

所有"渐变"都用同一个工具函数：

```js
const clamp = (v,a,b) => v<a ? a : v>b ? b : v;
const pr = (t,a,b) => clamp((t-a)/(b-a), 0, 1);   // 在 a→b 区间内取 0→1
const easeOut = x => 1 - Math.pow(1-x, 3);
```

用法：

```js
// 宽度从 0 涨到 448px，发生在 262.8 → 267.6 秒
set('bt1', 'width', (easeOut(pr(t, 262.8, 267.6)) * 448).toFixed(1) + 'px');

// 某个块在 356.6 秒开始淡入，持续到 358.4
const o = pr(t, 356.6, 358.4);
```

这样写出来的每个动画都自带起止时间，**时间表就是代码本身**。

### 减少 DOM 写入

每帧重复写同一个值会触发不必要的样式计算。加一层缓存：

```js
function set(id, prop, val){
  const el = document.getElementById(id);
  if (!el) return;
  if (el.__k !== val){ el.__k = val; el.style[prop] = val; }
}
```

## 场景切换

每个场景是一个 `<section class="scene" data-s="N">`，绝对定位铺满画布，默认 `opacity:0`。

```js
let curScene = -1;

function render(t){
  let si = 0;
  for (let i = 0; i < SCENES.length; i++){
    if (t >= SCENES[i].t0) si = i;
  }
  if (si !== curScene){
    curScene = si;
    document.querySelectorAll('.scene').forEach(el => {
      el.classList.toggle('on', +el.dataset.s === SCENES[si].s);
    });
  }
  // ... 场景内的动画照常按 t 计算
}
```

**场景内动画不受场景切换影响。** 即使某个场景已经隐藏，它的 `pr(t, ...)` 依然在算 —— 因为 t 会一直增长。这意味着切回该场景时，画面直接是"已经演完"的状态，不需要补播。这正是幂等的好处。

## 可寻址参数

| 参数 | 作用 | 用途 |
|---|---|---|
| `?t=137` | 从第 137 秒开始播放 | 预览某一章 |
| `?t=137&p` | 跳到第 137 秒并**暂停** | 截图验证 |
| `?clean` | 隐藏右下角快捷键提示 | 录制时不进画面 |

`?p` 的处理有个坑：

```js
const PAUSED = QS.has('p');
if (PAUSED) document.getElementById('stage').classList.add('nofx');

if (PAUSED) { render(T0); }              // 只渲染一次，不进循环
else { requestAnimationFrame(frame); }
```

```css
.stage.nofx *{ transition: none !important; }
```

**为什么必须禁用 transition**：CSS 过渡是浏览器自己跑的，跟 `t` 无关。跳到 `t=284` 时，所有带 transition 的属体会从当前值慢慢过渡到目标值，截图截到的是过渡中间态。禁用之后，`render(T0)` 一次性写到最终状态。

这个坑第一次踩会以为是"截图工具坏了"。

## 描线动画

SVG 用 `stroke-dasharray` + `stroke-dashoffset` 做"一笔一笔画出来"的效果。仍由同一个 `t` 驱动：

```js
// 初始化：每条线按自己的长度设置 dash
const parts = [...svg.querySelectorAll('path,circle,ellipse,rect,line,polyline')];
parts.forEach((p, i) => {
  let L = 0;
  try { L = p.getTotalLength(); } catch(e) {}
  if (!L) L = 100;
  p.style.strokeDasharray = L + ' ' + (L + 4);
  p.style.strokeDashoffset = L;
  INKS.push({ p, L, i, svg });
});

// 每帧：按顺序逐条放开
function drawInk(t){
  for (const it of INKS){
    const at = +(it.svg.dataset.at || 0);      // 整幅图开始时间
    const dur = +(it.svg.dataset.dur || 1.2);  // 单笔时长
    const stg = +(it.svg.dataset.stagger || .06); // 笔与笔的间隔
    const a = at + it.i * stg;                  // 这一笔的起点
    const d = ((1 - pr(t, a, a + dur)) * it.L).toFixed(1);
    if (it.p.__d !== d){ it.p.__d = d; it.p.style.strokeDashoffset = d; }
  }
}
```

`getTotalLength()` 对 `<text>` 无效，所以图里的字**不能参与描线**，要单独等线条画完再淡入：

```js
const a = at + it.n * stg;          // n = 图里所有线条数，等它们全画完
const v = pr(t, a, a + dur * 0.9) * 0.85;
```

## 一个检查清单

写完一个页面，对照过一遍：

- [ ] 所有动画都能用 `render(任意t)` 复现（随便挑三个时间点截图对比）
- [ ] 没有 `setTimeout` / `setInterval` 驱动动画
- [ ] 没有用帧计数换算时间
- [ ] `SCENES` 首尾相接，末项 `t1 === TOTAL`
- [ ] `?p` 模式下无 transition 残留
- [ ] 重置（空格）后画面回到初始态，不残留上一个场景的元素
