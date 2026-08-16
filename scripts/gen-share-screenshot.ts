/**
 * Screenshot generator entry: renders a realistic share page through the REAL
 * renderShareHtml (so the screenshot matches production exactly), then prints
 * the HTML to stdout. Bundled to a runnable script by the screenshot step.
 */
import { renderShareHtml } from '../src/host/html'
import type { ShareStats, TranscriptEntry } from '../src/shared/types'

const stats: ShareStats = {
  turns: 8,
  steps: 24,
  durationMs: 4 * 60 * 1000 + 12 * 1000,
  toolCallMs: 1 * 60 * 1000 + 5 * 1000,
  cacheReadTokens: 1250000,
  cacheWriteTokens: 80000,
  inputTokens: 2400000,
  outputTokens: 96000,
  model: 'deepseek-v4-pro',
  provider: 'deepseek',
  contextWindow: 1048576,
  context: {
    system: 24000,
    tools: 56000,
    user: 180000,
    inject: 42000,
    assistant: 90000,
    tool: 310000,
    total: 702000,
  },
}

const LONG = ('这是一段很长的说明文字，用来演示长消息自动折叠的效果。' +
  '当一条消息超过 400 个字符时，分享页会自动把它折叠成一行预览，' +
  '只显示「展开全文」按钮，点击后才展示完整内容，避免刷屏。' +
  '这样可以保证分享页在小屏幕手机上也能轻松浏览。').repeat(6)

const entries: TranscriptEntry[] = [
  { role: 'user', time: 1730000000000, text: '帮我写一个 Python 脚本，读取 CSV 并统计每个分类的数量，然后画一张柱状图。' },
  { role: 'assistant', time: 1730000003000, text: '好的，我分三步来做：\n\n1. 用 `pandas` 读取 CSV\n2. 用 `value_counts()` 统计分类\n3. 用 `matplotlib` 画柱状图\n\n先看一下数据文件结构：' },
  { role: 'tool', time: 1730000005000, calls: ['bash', 'read'] },
  { role: 'tool', time: 1730000007000, tool: 'bash' },
  { role: 'tool', time: 1730000009000, tool: 'read' },
  { role: 'assistant', time: 1730000015000, text: '数据文件是 `sales.csv`，包含 `category` 和 `amount` 两列。这是完整的脚本：\n\n```python\nimport pandas as pd\nimport matplotlib.pyplot as plt\n\ndf = pd.read_csv("sales.csv")\ncounts = df["category"].value_counts()\ncounts.plot(kind="bar")\nplt.show()\n```' },
  { role: 'user', time: 1730000020000, text: LONG },
  { role: 'assistant', time: 1730000030000, text: '当然可以。这是**重点结论**和 `inline code`，以及一个引用块：\n\n> 柱状图是最直观的分类对比方式。\n\n| 分类 | 数量 |\n|------|------|\n| A | 12 |\n| B | 8 |\n| C | 5 |' },
]

console.log(renderShareHtml({
  title: '用 Python 统计 CSV 分类并画柱状图',
  createdAt: 1730000000000,
  entries,
  stats,
}))
