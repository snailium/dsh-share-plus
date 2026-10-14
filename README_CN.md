<div align="center">

# dsh-share-plus

**给 DeepSeek Harness 的会话加一个「分享」按钮，一键生成本次会话的只读快照链接，在局域网内分享，并默认对敏感内容脱敏。**

[English](./README.md) · 中文

</div>

`dsh-share-plus` 是一个 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 插件：在会话头部加一个「分享 / Share」按钮，点击后把当前会话冻结成一张自包含的只读 HTML 页面，并给出一个局域网链接（如 `http://192.168.1.20:3081/s/<token>`），同一局域网内任意设备用浏览器打开即可查看。

它还提供**只读目录分享**：把它指向一个构建产物目录，`http://192.168.1.20:3081/apk/` 就变成一个可浏览的文件列表 —— 于是在 session 里构建出的 APK，可以直接用手机打开安装。目录在 Plugins 页的插件设置卡里配置，也可以写在 `cordis.patch.yml`。

它 fork 自 [`@zljr/dsh-share`](https://github.com/zljr/dsh-share)（MIT），在原有能力之上加入了**内容脱敏**与**目录挂载**：因此快照可以放心发给同事、贴进 issue，或经由隧道公开，而不必担心泄露凭据、本地路径或内网地址。

主 Harness 始终监听 `127.0.0.1`（因此不会暴露 agent 的执行能力）。分享由**独立的只读 HTTP 服务器**承担：对合法 token 返回预渲染的快照页，或返回目录列表与其文件。

## 这个服务器会暴露什么

| URL | 内容 |
|-----|------|
| `/s/<token>` | 冻结的会话快照（分享时已脱敏）。 |
| `/<挂载名>/` | 某个已配置目录的只读可浏览列表。 |
| `/<挂载名>/<token>/` | 同上，当该目录配置了 token 时。 |
| `/<挂载名>/…/文件` | 文件本身，支持 `Range` / `HEAD` / `ETag`。 |
| `/` | 落地页，只列出**开放**的挂载（带 token 的不会在这里出现）。 |

只接受 `GET` 与 `HEAD`。这个端口上没有上传、没有删除，也没有 RPC。

## 功能

- 🛡️ **默认开启脱敏** — API key、云厂商 token、JWT、私钥块、`KEY=value` 形式的密钥、URL 中的密码、家目录路径与内网 IP，都会在写入快照前替换为 `«REDACTED»`；页面头部会显示脱敏了几处。
- 📁 **目录分享** — 在设置卡里添加一个本地目录，它立即出现在 `/<名称>/` 下，可浏览可下载，无需重启。
- 📱 **对 APK 友好** — `.apk` 以 `application/vnd.android.package-archive` 加 `Content-Disposition: attachment` 提供，手机浏览器会直接引导安装而不是丢一个二进制块。
- 🔗 **一键分享** — 会话头部（官方「Session log」按钮旁边）的「分享」按钮。
- 🔒 **只读且隔离** — 分享服务器单独绑 `0.0.0.0:<端口>`，只暴露 `GET /s/<token>`，无 RPC、无写入、查看时不读会话。
- 🧊 **冻结快照** — 转写与统计都在分享那一刻捕获，之后会话的修改 / 压缩不会影响已分享的页面。
- 🔑 **可撤销 + 可设过期** — 128 位随机 token；随时「停止分享」，或选 1 小时 / 24 小时 / 7 天过期。
- 📖 **默认可读** — 分享页只显示你发送的 prompt 和每一轮的最终回答。工具调用、注入上下文、系统消息与统计信息**默认关闭**（见「技术信息」）。
- 🎨 **与 Harness 同款外观** — 使用 Harness 自身的字体栈、中性色板与消息布局：提问是右对齐的品牌色气泡，回答是左对齐的整宽正文，内容列 680px。
- 📝 **Markdown 渲染** — 消息按 Markdown 渲染（安全：原始 HTML 被转义、`javascript:` 链接被拦截），并且**保留换行**，多行 prompt 按原样呈现。
- 🪗 **易读** — 长消息自动折叠为预览；连续的工具调用合并成一行「🛠 工具调用」分组。
- 📊 **会话统计摘要** — 轮次、步数、执行时长、工具调用时长、缓存命中、输入/输出 tokens，以及当前上下文占用与分项构成条。
- 🌗 **明暗主题** — 分享页跟随 `prefers-color-scheme`。
- 💾 **重启后仍有效** — 分享持久化在 `$DSH_HOME/.dsh/dsh-share-plus.json`，且只要有分享仍有效，服务器会在启动时重新绑定，因此已分享的链接不会因为 dsh 重启而失效。
- 📡 **智能选局域网地址** — 过滤虚拟网卡（WSL / Hyper-V / Docker / VPN 等），并用路由探测把手机可达的 IP 排最前。

## 目录分享

打开 **Plugins → dsh-share-plus → Configure**，每个目录加一行：

| 字段 | 含义 |
|------|------|
| `name` | URL 前缀。填 `apk` 即挂在 `/apk/`。必须以字母或数字开头，可含字母、数字、`.`、`_`、`-`；`s` 被会话分享保留。 |
| `path` | 目录的绝对路径。只有这个目录会被暴露。 |
| `token` | 可选。留空表示任何能访问该端口的人都能浏览；填写后地址变为 `/<名称>/<token>/…`。 |
| `index` | 访问目录时是否列出文件。关闭后只允许直接访问已知文件名。 |
| `hidden` | 是否提供以 `.` 开头的文件。**默认关闭** —— 构建目录里经常有 `.env`、`.gradle/`、签名 keystore。 |

设置卡会显示每个挂载的实时状态与可复制地址；路径不存在（或名称冲突）会显示为 **未生效** 并给出原因，且不影响会话分享继续工作。

同样的内容也可以写在配置文件里：

```yaml
- id: dsh-share-plus
  config:
    port: 3081
    mounts:
      - name: apk
        path: /home/me/app/android/app/build/outputs/apk/release
      # 目录里只要有私密内容，就应该带 token。
      - name: logs
        path: /var/log/mydaemon
        token: change-me
        index: false
        hidden: false
```

`mounts` 是唯一可实时编辑的字段：在设置卡里保存会改写 profile 的 `cordis.patch.yml` 中该行，服务器在下一次请求即生效。

### 目录分享不会做什么

约束在每次请求时强制执行，并且所有拒绝都返回 `404`（而不是 `403`），这样「被拒绝」与「不存在」无法被区分：

- **路径穿越** —— 请求路径**先**按 `/` 切分、**后**逐段百分号解码；解码后等于 `..`，或含分隔符、NUL 字节的段直接拒绝。`%2e%2e`、`%2f`、`%5c`、`%00` 各种变体都在测试覆盖内。
- **符号链接逃逸** —— 解析后的路径会再与挂载点自身的 `realpath` 比对，指向挂载目录之外的符号链接会被拒绝；指向目录内部的符号链接正常工作。
- **隐藏文件** —— 除非该挂载显式开启 `hidden: true`，否则不提供。
- **非普通文件** —— socket、FIFO、设备节点一律拒绝。
- **可执行内容** —— HTML、SVG、XML 永远不会在该源上内联呈现（同一源上还有带 token 的会话页面），一律强制下载；未知类型按不透明字节处理。

注意：目录分享**不做脱敏**。脱敏只作用于会话快照；被分享的构建目录是按原样发布的。请使用 token，并且不要把密钥放进被分享的目录。

### 资源上限

每个上限都是显式的，并且独立于传输层强制，不依赖可能变化的 Node 默认值：

| 上限 | 限制 | 超出时 |
|------|------|--------|
| 请求目标（URL） | 16 KiB 头部字节 | `431`，在路由之前由 HTTP 解析器拒绝 |
| 路径深度 | 128 段 | `414` |
| 单个路径段 | 255 字符（没有文件系统允许更长） | `414` |
| 目录列表 | 每次请求 5000 行，流式扫描 | 页面会说明已截断 |
| RPC 请求体 | 256 KiB，并且先按 `Content-Length` 判断 | `413` |
| 会话页面渲染缓存 | 总计 16 MiB，单页 4 MiB | 淘汰较旧页面；超大页面不缓存直接提供 |
| 已存分享数 | 100，超出淘汰最旧 | — |
| 慢请求 | 头部 10 秒、单请求 30 秒、keep-alive 5 秒 | 关闭连接 |

两点刻意**不**做的限制：

- **下载体积与时长**：大 APK 经弱 Wi-Fi 下载正是预期用法，因此不设 socket 空闲超时；上面的超时只约束客户端**发送**请求的时长。
- **快照体积**：不截断转写 —— 静默截断会话分享比页面变大更糟。提供的代价改由页面缓存约束：冻结快照只渲染一次，而不是每个请求渲染一次。

## 技术信息

分享页是给人读的，所以 session 里机器面的一半**默认关闭**。关闭时你得到的是自己输入的 prompt，以及每一轮得出结论的那条回答 —— 仅此而已。

| | 技术信息关闭（默认） | 技术信息开启 |
|---|---|---|
| Prompt、最终回答 | 显示 | 显示 |
| 中间过程的助手消息（"让我先看看 X…"） | 丢弃 | 显示 |
| 工具调用 / 结果 | 丢弃 | 显示（分组折叠） |
| 注入上下文（插件通知、技能调用、运行时上下文快照） | 丢弃 | 显示 |
| 统计信息头 | 不渲染（也不计算） | 显示 |
| 长消息 | 完整渲染 | 折叠到「展开全文」之后 |

两个地方可以控制：

- **Plugins → dsh-share-plus → Configure → 输出技术信息**：设置新分享的默认值。这是实时生效的设置，保存后下一次分享即采用。
- **分享对话框**里的单次勾选框，初始值取自上面的默认值 —— 这样你可以在不改全局设置的情况下，为某一次调试分享临时打开。

也可以写在配置文件里：

```yaml
- id: dsh-share-plus
  config:
    port: 3082
    technicalInfo: false   # 默认
```

在此设置出现之前创建的分享按「技术信息开启」处理 —— 它们本来就是这样。

## 脱敏

脱敏在 **Host 端**执行，位置是「把会话事件日志折叠成转写」的唯一收口处，因此所有下游产物（页面正文、由正文派生的页面标题）拿到的都已经是掩码后的文本。磁盘上的原始会话日志不会被修改。

### 会脱敏的内容

| 类别 | 匹配 | 默认 |
|------|------|------|
| `privateKey` | `-----BEGIN … PRIVATE KEY-----` 块，直到配对的 `END`（或文本结束） | 开 |
| `jwt` | 以 `eyJ` 开头的三段式 base64url token | 开 |
| `cloudKeys` | `sk-…`、`AKIA…`、`ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`、`github_pat_…` | 开 |
| `urlCredentials` | `scheme://user:password@host` | 开 |
| `envAssignment` | `*PASSWORD*`/`*SECRET*`/`*TOKEN*`/`*API_KEY*` `= value`，以及裸露的 `token=…` | 开 |
| `localPaths` | `/home/<user>/…/`、`/Users/<user>/…/`、`C:\Users\…` | 开 |
| `privateIps` | `10.x`、`172.16–31.x`、`192.168.x` | 开 |
| `emails` | `local@domain` | **关** |

两处刻意为之的行为，值得了解：

- **路径规则遮住目录前缀、保留最后一段**：`/home/ana/work/creds.txt` 会变成 `«REDACTED»creds.txt`。路径的目录结构通常才是敏感部分，保留文件名则让转写仍然可读。Windows 规则会遮住整条路径。
- **URL 凭据保留主机名**：`https://user:pw@db.internal:5432/app` 会变成 `«REDACTED»:5432/app`。

### 尽力而为，而非保证

脱敏是**模式匹配**。它能稳定清掉上表中的形态，仅此而已。格式不常见、被拆到多行、经过 base64 包裹，或写在自然语言里的密钥会原样通过。**发布快照前请自行检查一遍。** 插件会报告替换次数，以便判断功能是否真的生效（`Nothing to redact` 表示零匹配，而不是「已证明干净」）。

### 按次覆盖

对话框里的 **「分享前脱敏敏感信息（密钥、本地路径等）」** 复选框控制单次分享。取消勾选会刻意生成原始快照 —— 用于调试脱敏本身很方便。

若要修改默认值，在 `cordis.patch.yml` 中给该插件的行加一段 `redact`：

```yaml
- id: dsh-share-plus
  config:
    port: 3082
    redact:
      enabled: true
      replacement: '[masked]'
      classes:
        emails: true      # 选择脱敏邮箱
        privateIps: false # 保留内网 IP
```

单次分享的覆盖（对话框复选框）优先级始终高于这里的基准配置。

### 已知限制

若某一轮在模型响应前就失败，用户提示词可能只留在一条瞬时的 inbox 事件里，而转写折叠不会渲染该事件；这类分享可能显示为空白（或只有助手侧）的转写。正常完成的轮次一定包含用户消息。

## 原理

与其它 `dsh` 插件一样，`dsh-share-plus` 是一个双半部包：

| 半部 | 运行位置 | 职责 |
|------|----------|------|
| Host（`src/host`） | Node（harness 进程） | 把会话事件日志折叠成脱敏后的转写 + 统计，存储冻结快照，并用独立的 `node:http` 服务器同时提供快照页与全部目录挂载；暴露 `/dsh-share-plus` RPC（`create` / `revoke` / `list` / `mounts`）并声明设置 schema。 |
| Client（`src/client`） | 浏览器 | 在 `conversation.session.header.utilities` 注册「分享」按钮与对话框，并在 `plugins.row.config` 注册本插件的设置卡以管理目录挂载。 |

上下文构成的 token 估算复用 Harness 官方同款固定密度启发式（约 4 字符 ≈ 1 token），与 [`dsh-context`](https://github.com/bowenliang123/dsh-context) 一致。

`/dsh-share-plus` 通道是直接注册到注入的 web server 上的，而不是走 `ctx.connection.rpc.handle()`。原因见 `src/host/rpc.ts` 顶部的注释：在当前 dsh/cordis 的组合方式下，通用注册表在注册路由时解析到了错误的 context，导致整个 entry 激活失败。该通道沿用了 Connection 服务自身的 trusted-Host / 浏览器鉴权围栏，并使用相同的报文封装，因此与原生通道受到同等保护。

## 安装

### 从 npm 安装

```sh
dsh plugin --profile web add dsh-share-plus
dsh --profile web
```

发布包里已带构建好的 `lib/`，终端用户无需构建步骤。

### 从源码安装（本地开发）

```sh
# 1. 构建产物（lib/）
pnpm install
pnpm build

# 2. 安装进 web profile（本地路径）
dsh plugin --profile web add /absolute/path/to/dsh-share-plus

# 3. 重启 Web UI
dsh --profile web
```

打开任意会话，点击头部的**分享**按钮即可。

### 从 `dsh-share` 升级

0.4.0 把 loader 行 id、设置命名空间、RPC 通道和存储文件名统一改成了 `dsh-share-plus`。
有两处需要手动改，因为命名空间**就是**行 id，而存储文件名不会自动迁移：

```bash
# 1. profile 的 patch 层
sed -i 's/^- id: dsh-share$/ - id: dsh-share-plus/' ~/.dsh/profiles/<name>/cordis.patch.yml

# 2. 快照存储（保住已有分享）
mv ~/.dsh/.dsh/dsh-share.json ~/.dsh/.dsh/dsh-share-plus.json
```

漏了第 1 步会丢掉该行的配置（`publicDomain`、`mounts`、`port`）；漏了第 2 步所有已有分享会 404。

### 兼容性

本插件与 harness 的契约是**会话记录格式**，不是 harness 版本号。它只渲染 format 4
事件词表中的四种（`user/message`、`assistant/message`、`tool/result`、`tool/call`），
并通过 `ctx.sessionQuery` 读取会话；其余事件要么有意忽略，要么完全不碰。该约束声明在
清单的 `dsh.sessionFormat: 4` 字段里。

遇到更新格式写出的会话不会崩溃：未知事件类型会被安全跳过，分享页会明确提示
（"此分享的部分内容使用了较新的会话格式"），而不是悄悄显示成一段很短的对话。

### 互联网链接

默认生成的都是局域网地址（`http://<ip>:<端口>/...`）。想让手机等不在同网段的设备也能打开，就在设置卡里填写**绑定域名**（或配置 `publicDomain`），例如 `share.example.com`。之后生成的链接以 `https://share.example.com/s/<token>` 开头，局域网地址仍保留在列表里作为备选。

已有的分享也会立刻跟随域名：数据库里只存 token，从不存 URL，每条链接都在读取时按当前域名和绑定端口重新拼接——填域名（或改域名）不需要迁移，也不需要重启。

插件只负责**生成**带域名的链接，不开端口、不装证书——让域名真正可达需要你自己配：

- **Cloudflare Tunnel**（或 Caddy `reverse_proxy`）：把 `share.example.com/*` 转发到 `http://127.0.0.1:3082`。
- **frp / nps / tailscale funnel**：同理，公网域名进、本机端口出。

分享页只使用相对资源，代理加任何路径前缀都不影响打开。

只要**有东西可服务**（上次运行留下的分享，或已配置的目录挂载），分享服务器就会在 dsh 启动时自动绑定 —— 因此已经发出去的链接不会因为 dsh 重启而失效。没有东西可服务时不占用端口，由第一次分享（或设置卡）触发启动。

## 配置

插件行（loader row）的 id 是 `dsh-share-plus`。它从 `cordis.patch.yml`（或 profile 层）读取配置对象，未提供时回落到环境变量：

| 配置项 | 环境变量回落 | 默认值 | 说明 |
|--------|--------------|--------|------|
| `host` | `DSH_SHARE_HOST` | `0.0.0.0` | 只读分享服务器的绑定地址。 |
| `port` | `DSH_SHARE_PORT` | `3081` | 分享服务器端口。 |
| `redact.enabled` | — | `true` | 脱敏总开关。 |
| `redact.classes` | — | 见上表 | 按类别开关。 |
| `redact.replacement` | — | `«REDACTED»` | 替换文本。 |
| `technicalInfo` | — | `false` | 分享是否包含工具调用、注入上下文、系统消息与统计。可在设置卡里实时编辑。 |
| `publicDomain` | — | `''` | 可选的公网域名。填写后生成的链接使用 `https://<域名>/...` 形式（供反代或隧道把该域名转发到本服务器）。可在设置卡里实时编辑。 |
| `mounts` | — | `[]` | 只读目录分享（见上）。可在设置卡里实时编辑。 |

优先级为 **配置 > 环境变量 > 默认值**。`host` 与 `port` 只能写在配置文件里：服务器只绑定一次，因此刻意不在设置卡中提供。

> 在 Windows 上，首次监听 `0.0.0.0` 可能触发防火墙提示 —— 允许后其它设备才能访问链接。

## 安全模型

- **主 Harness 始终只在回环地址**；从局域网可达的只有只读的分享面。
- 分享 token 是 **128 位随机**（不可猜），并且可以被**撤销**或设为**过期**。
- `/dsh-share-plus` RPC 通道位于 Harness 的 trusted-Host/Origin 围栏与浏览器鉴权之后；未鉴权的调用返回 `401`。
- 目录挂载是**只读的**，并且**逐请求**做包含性校验（穿越、符号链接逃逸、隐藏文件、非普通文件）；拒绝一律表现为 `404`。
- 目录挂载**对任何能访问该端口的人开放**，除非你为它设置了 token。默认绑定 `0.0.0.0`，意味着整个局域网；若挂在隧道后面，就是整个互联网。任何你不愿公开的内容都请设置 token。
- 目录内容**不脱敏** —— 只有会话快照脱敏。
- 分享页**不含 JavaScript、不含外部资源**；消息文本按 Markdown 渲染，原始 HTML 被转义，危险 URL 被拦截。
- 快照**默认脱敏，但只是尽力而为** —— 发布前请自行检查（见上）。
- 快照是**冻结**的 —— 它不是会话的实时视图，创建后不会再从会话存储中读取。

## 开发

```sh
pnpm install     # 开发依赖（typescript、esbuild、react、jsdom 等）
pnpm build       # 打包 host（lib/index.js）与 client（lib/client.js）
pnpm test        # typecheck + host/client 功能测试
pnpm typecheck   # 仅 tsc --noEmit
```

`tests/host.test.mjs` 会把插件挂到一个模拟真实服务契约的假 context 上，通过真实 HTTP socket 提供该通道，并断言所有合成密钥类别都不会出现在渲染后的快照里。

### 目录结构

```
src/
  shared/          # 两个半部共享的通信契约（仅类型）
  host/
    index.ts       # /dsh-share-plus 通道、Config schema、分享服务器生命周期
    rpc.ts         # 通道路由注册 + 报文封装
    redact.ts      # 有序、按类别的敏感信息脱敏
    mounts.ts      # 目录挂载：名称/路径校验 + 包含性
    listing.ts     # 目录列表页与落地页
    mime.ts        # 内容类型（含 APK）与内联/下载策略
    server.ts      # 只读 HTTP 服务器 + 局域网地址选择
    store.ts       # token → 快照 注册表（持久化 JSON）
    transcript.ts  # 事件日志 → 人类可读转写（脱敏收口处）
    stats.ts       # 事件日志 → 会话统计
    pricing.ts     # token 估算启发式
    markdown.ts    # 安全的 Markdown 渲染
    html.ts        # 快照页渲染
  client/
    index.ts       # 头部按钮 + 设置卡注册
    components/    # ShareButton + 对话框、MountsCard
    i18n.ts        # 中英文案
scripts/build.mjs  # esbuild 构建（host ESM + client __ModuleLoader__ 包）
tests/             # host/client 功能测试（jsdom + 真实 React）
```

## 发布

```sh
npm login --registry=https://registry.npmjs.org
npm publish --registry=https://registry.npmjs.org
```

`prepublishOnly` 会在每次发布前重新构建 `lib/`，因此 tarball 里始终是新的 host + client 产物。

## 致谢

fork 自 zljr 的 [`zljr/dsh-share`](https://github.com/zljr/dsh-share)，MIT 许可。分享服务器、存储、转写折叠、统计、Markdown 渲染与快照页均为上游成果；脱敏、脱敏交互，以及直接注册通道是本 fork 的新增部分。

## 许可

[MIT](./LICENSE)
