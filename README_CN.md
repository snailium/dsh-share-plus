<div align="center">

# dsh-share

**给 DeepSeek Harness 的会话加一个「分享」按钮，一键生成本次会话的只读快照链接，在局域网内分享。**

[English](./README.md) · 中文

</div>

`dsh-share` 是一个 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 插件：在会话头部加一个「分享 / Share」按钮，点击后把当前会话冻结成一张自包含的只读 HTML 页面，并给出一个局域网链接（如 `http://192.168.1.20:3081/s/<token>`），同一局域网内任意设备用浏览器打开即可查看。

主 Harness 始终监听 `127.0.0.1`（因此不会暴露 agent 的执行能力）。分享由**独立的只读 HTTP 服务器**承担，它只会对合法 token 返回一张预渲染的快照页。

## 功能

- 🔗 **一键分享** — 会话头部（官方「Session log」按钮旁边）的「分享」按钮。
- 🔒 **只读且隔离** — 分享服务器单独绑 `0.0.0.0:<端口>`，只暴露 `GET /s/<token>`，无 RPC、无写入、查看时不读会话。
- 🧊 **冻结快照** — 转写与统计都在分享那一刻捕获，之后会话的修改 / 压缩不会影响已分享的页面。
- 🔑 **可撤销 + 可设过期** — 128 位随机 token；随时「停止分享」，或选 1 小时 / 24 小时 / 7 天过期。
- 📝 **Markdown 渲染** — 用户与助手消息按 Markdown 渲染（安全：原始 HTML 被转义、`javascript:` 链接被拦截）。
- 🪗 **易读** — 长消息自动折叠为预览；连续的工具调用合并成一行「🛠 工具调用」分组。
- 📊 **会话统计摘要** — 轮次、步数、执行时长、工具调用时长、缓存命中、输入/输出 tokens，以及当前上下文占用与分项构成条。
- 🌗 **明暗主题** — 分享页跟随 `prefers-color-scheme`。
- 💾 **重启后仍有效** — 分享持久化在 `~/.dsh/dsh-share.json`。
- 📡 **智能选局域网地址** — 过滤虚拟网卡（WSL / Hyper-V / Docker / VPN 等），并用路由探测把手机可达的 IP 排最前。

## 原理

与其它 `dsh` 插件一样，`dsh-share` 是一个双半部包：

| 半部 | 运行位置 | 职责 |
|------|----------|------|
| Host（`src/host`） | Node（harness 进程） | 把会话事件日志折叠成转写 + 统计，存储冻结快照，并用独立的 `node:http` 服务器在 `/s/<token>` 提供页面；同时暴露 `/dsh-share` RPC（`create` / `revoke` / `list`）。 |
| Client（`src/client`） | 浏览器 | 在 `conversation.session.header.utilities` 注册「分享」按钮，渲染分享对话框（有效期选择、复制 / 撤销 / 打开）。 |

上下文构成的 token 估算复用 Harness 官方同款固定密度启发式（约 4 字符 ≈ 1 token），与 [`dsh-context`](https://github.com/bowenliang123/dsh-context) 一致。

## 安装

```sh
# 1. 构建产物（lib/）
pnpm install
pnpm build

# 2. 安装到 web profile（本地路径）
dsh plugin --profile web add /dsh-share/的绝对路径

# 3. 重启 web UI
dsh --profile web
```

打开任意会话，点击头部的「分享」即可。分享服务器在首次使用时懒启动。

## 配置

环境变量（或在 `cordis.patch.yml` 里以 config 覆盖）：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DSH_SHARE_HOST` | `0.0.0.0` | 只读分享服务器的绑定地址。 |
| `DSH_SHARE_PORT` | `3081` | 分享服务器端口。 |

> Windows 下首次监听 `0.0.0.0` 可能触发防火墙提示，放行后其它设备才能访问链接。

## 安全模型

- **主 Harness 始终锁在 loopback**，只有只读分享面暴露给局域网。
- 分享 token 为 **128 位随机数**（不可猜测），可**撤销**、可设**过期**。
- 分享页**无 JavaScript、无外部资源**；消息文本以 Markdown 渲染，原始 HTML 被转义、危险 URL 被拦截。
- 快照是**冻结**的——它不是会话的实时视图，创建后也不会再从会话存储读取。

## 本地开发

```sh
pnpm install     # 安装开发依赖（typescript、esbuild、react、jsdom 等）
pnpm build       # 打包 host（lib/index.js）与 client（lib/client.js）
pnpm test        # typecheck + host/client 功能测试
pnpm typecheck   # 仅 tsc --noEmit
```

### 目录结构

```
src/
  shared/          # 双半部共享的 wire 契约（纯类型）
  host/
    index.ts       # /dsh-share RPC + 懒启动分享服务器生命周期
    server.ts      # 只读 HTTP 服务器 + 局域网地址选择
    store.ts       # token → 快照注册表（JSON 持久化）
    transcript.ts  # 事件日志 → 人类可读转写
    stats.ts       # 事件日志 → 会话统计
    pricing.ts     # token 估算启发式
    markdown.ts    # 安全的 Markdown 渲染
    html.ts        # 快照页渲染
  client/
    index.ts       # 头部按钮注册
    components/    # ShareButton 与对话框
scripts/build.mjs  # esbuild 构建（host ESM + client __ModuleLoader__ bundle）
tests/             # host/client 功能测试（jsdom + 真实 React）
```

## License

[MIT](./LICENSE)
