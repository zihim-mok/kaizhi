# 排版规范

画面只有 1080×1920。所有数值都是实测出来的，不是审美偏好。

## 画布与版心

```css
.stage{
  width:1080px; height:1920px;
  position:absolute; left:50%; top:50%;
  transform:translate(-50%,-50%) scale(var(--s,1));
  transform-origin:center center;
}
```

自适应缩放，永远保证 9:16 不变形：

```js
function fit(){
  const s = Math.min(innerWidth/1080, innerHeight/1920);
  document.documentElement.style.setProperty('--s', s);
}
```

| 项 | 值 | 说明 |
|---|---|---|
| 画布 | 1080 × 1920 | 9:16 |
| 左右安全边 | 84px | 内容区宽 **912px** |
| 上边距 | 86px | 标题区 |
| 底部字幕区 | 高 196px，距底 104px | 占用 1080×1920 的下部 300px |
| 内容可用高度 | 约 1450px | 1920 − 86 − 300 − 余量 |

**版面必须垂直居中。** 最常见的翻车是全挤在顶部、中下部大片空白 —— 因为用了 `flex-direction:column` 但没加 `justify-content:center`。手机上看起来像页面加载失败。

```css
.scene{
  position:absolute; inset:0;
  padding:86px 84px 340px;   /* 底部留出字幕区 */
  display:flex; flex-direction:column;
  justify-content:center;     /* ← 这一行不能漏 */
}
```

## 字幕

```css
.cue{
  font-size:56px;
  font-weight:600;
  line-height:1.5;
  color:#F2ECDF;
  text-align:center;
  text-wrap:balance;
  text-shadow:0 2px 24px rgba(0,0,0,.9);
}
```

**56px ≈ 屏宽的 5.2%。** 这是手机端竖屏视频的可读下限。之前用过 49px，手机上偏小一圈 —— 因为那是按"有人念、字幕只是辅助"给的，纯画面时必须更大。

**必须有 text-shadow。** 深色底上叠内容时，字幕会糊掉。

## 中文断行

浏览器允许任意字间断行，中文尤其难看：

```
改前：刘向领了活：每一种
      书，校勘、编目、写提要        ← "书"孤零零掉下一行
```

解法是内置一个断行函数：**只在标点后断，断点取最接近视觉中点的那个。**

```js
const CUE_MAX = 16.0;              // 一行能放的全角字数（912px / 56px ≈ 16.3）
const BREAKS = '，、：。？！；';

function textWidth(s){             // 半角字符算 0.55
  let w = 0;
  for (const ch of s) w += (ch.codePointAt(0) < 0x2E80 ? 0.55 : 1);
  return w;
}

function balanceCue(html){
  if (html.includes('<br>')) return html;        // 手写换行优先，不覆盖
  const plain = html.replace(/<[^>]+>/g, '');
  if (textWidth(plain) <= CUE_MAX) return html;  // 一行放得下，不动

  const pts = [];
  for (let i = 0; i < plain.length; i++){
    if (BREAKS.includes(plain[i])) pts.push(i + 1);
    else if (plain[i] === '—' && plain[i+1] === '—') pts.push(i + 2);  // 破折号整体断
  }
  if (!pts.length) return html;                  // 没标点，交给浏览器

  const target = textWidth(plain) / 2;
  let best = pts[0], bestD = Infinity;
  for (const p of pts){
    const d = Math.abs(textWidth(plain.slice(0, p)) - target);
    if (d < bestD){ bestD = d; best = p; }
  }
  return insertAt(html, best);
}
```

**破折号那个分支是必须的。** 第一版没处理，断成了：

```
改前：经史子集—
      —最多的
改后：经史子集——
      最多的
```

**想强制换行**：直接在 `CUES` 里写 `<br>`，函数会跳过这一句。

```js
[271.40, 276.20, '存目，就是<br>“知道有这本书，但不收”'],
```

## 标点

| 不要 | 要 |
|---|---|
| 直角引号 `「」` | 中文弯引号 `“”` |
| 半角括号 `()` | 全角 `（）`，或直接不用 |
| 英文逗号 `,` | 中文逗号 `，` |

直角引号在小红书/杂志排版里好看，但在竖屏视频字幕里，两个尖角在大字号下会显得刺眼。统一用弯引号。

数字和单位之间留空格：`596 家`、`13269 卷`、`3461 种`。数字本身用 `font-variant-numeric: tabular-nums`，避免跳动时宽度变化。

## 画面文字与字幕的分工

**这是最容易犯、也最毁片的错误。**

| 角色 | 负责什么 | 举例 |
|---|---|---|
| 画面文字 | 书面金句、硬数据、结论 | 「存目的数量，是收录的两倍」 |
| 字幕 | 口播白话、解释、过渡 | 「存目，就是知道有这本书，但不收」 |

重复的后果：观众同时读两遍同一句话，感觉像"字幕在拖后腿"，且浪费一半信息位。

真实翻车记录：第一版开场画面写「你现在能说出的古籍名字，大概不超过二十个」，字幕也是这句，一字不差。整屏等于复读。

**检查方法**：把所有画面文字和 `CUES` 并排放，逐条比对。有完全相同的，删一个。

## 字号阶梯

| 用途 | 字号 | 字重 |
|---|---|---|
| 开场/收尾大字 | 78–96px | 700 |
| 场景内结论 | 44–52px | 600 |
| 字幕 | 56px | 600 |
| 章节标题 | 23–26px | 500，加 `letter-spacing:.2em` |
| 数据标注 | 26–30px | 500 |
| 大数字 | 90–130px | 700，`tabular-nums` |

**大数字要敢给大。** 目录学那期「公元前 26 年」的 26 用了 120px 以上，是整屏视觉锚点。数字小了就等于没做。

## 配色

深色底只有一种成立方式：**近黑背景 + 单一暖色 + 大量灰阶**。

```css
background: radial-gradient(120% 70% at 50% -10%, #161B26 0%, #0B0E14 52%, #06070B 100%);
```

```css
--gold:#C9973A;   /* 主色，用于强调、点亮 */
--gold-hi:#F0C568;/* 高亮，用于最关键的那个数 */
--ink-1:#F2ECDF;  /* 主文字 */
--ink-2:#A9A292;  /* 次文字 */
--ink-3:#5C6473;  /* 说明、章节号 */
```

**只用一种彩色。** 加入第二种颜色（除红绿语义外）会让画面立刻变成 PPT。

## 留白

两条经验：

**1. 一屏只放一个视觉重心。** 八个 132px 的金字占满画面时，再加任何插图都会打架 —— 目录学那期 S6 试过右上角人物和左下角人物，都不成立，最后删掉，留白反而更好。

**2. 结论页要把背景压暗。**

```css
.stage.done .grid{ opacity:.26; filter:saturate(.5); }
.stage.done .stats{ opacity:.18; }
```

视线必须被强制交给那句话。这是短版和长版收尾的通用手法。
