#!/usr/bin/env node
/**
 * Functional smoke test for the packaged host half: mounts the plugin on a
 * fake ctx that mimics the real service contract, drives the `/dsh-share`
 * Connection RPC channel over REAL HTTP (envelope, admission fence, unknown
 * routes), and asserts transcript folding, snapshot serving, list, and revoke.
 * The share server binds 127.0.0.1 on an ephemeral port (port 0) and the store
 * file is redirected to a temp dir via DSH_HOME, so nothing touches the real
 * home or listens on 0.0.0.0.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmpHome = await mkdtemp(join(tmpdir(), 'dsh-share-test-'))
process.env.DSH_HOME = tmpHome

const { apply } = await import('../lib/index.js')

let handler = null
const disposers = []

const events = [
  { seq: 1, type: 'request/header', time: 1000, data: { header: { config: { model: 'deepseek-v4', provider: 'deepseek' }, system: 'sys', tools: [] } } },
  { seq: 2, type: 'user/message', time: 2000, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Hello there <script>alert(1)</script>' }] }, surfaceOp: 'append' },
  { seq: 3, type: 'assistant/message', time: 3000, data: { message: { source: { kind: 'model' }, content: [{ type: 'text', text: 'Hi! I can help.' }] } }, surfaceOp: 'append' },
  { seq: 4, type: 'tool/call', time: 4000, data: { callId: 'c1', name: 'bash' } },
  { seq: 5, type: 'tool/result', time: 4100, data: { message: { source: { kind: 'tool', callId: 'c1' }, content: [{ type: 'tool-result', callId: 'c1', content: [{ type: 'text', text: 'ok' }] }] } }, surfaceOp: 'append' },
  { seq: 6, type: 'assistant/message', time: 5000, data: { message: { source: { kind: 'model' }, content: [{ type: 'tool-call', name: 'bash', arguments: '{}' }] } }, surfaceOp: 'append' },
  { seq: 7, type: 'user/message', time: 6000, data: { source: { kind: 'plugin', form: 'notice', plugin: 'dsh-x' }, content: [{ type: 'text', text: 'injected note' }] }, surfaceOp: 'append' },
  // A replacement copy (model-only restatement) must NOT appear in the transcript.
  { seq: 8, type: 'assistant/message', time: 7000, data: { message: { source: { kind: 'model' }, content: [{ type: 'text', text: 'shadowed restatement' }] } }, surfaceOp: { op: 'replace', start: 2, end: 3 } },
  // A long message must be auto-folded.
  { seq: 9, type: 'user/message', time: 8000, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'L'.repeat(600) }] }, surfaceOp: 'append' },
  // Markdown must render, while raw HTML stays escaped.
  { seq: 10, type: 'assistant/message', time: 9000, data: { message: { source: { kind: 'model' }, content: [{ type: 'text', text: '**bold** and `code` and <script>alert(2)</script>' }] } }, surfaceOp: 'append' },
  // Regression: a multi-line prompt. Its line structure must reach the page.
  { seq: 11, type: 'user/message', time: 10000, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'first line\nsecond line\nthird line' }] }, surfaceOp: 'append' },
  // Regression: the harness's own runtime-context snapshot is NOT the user's
  // words, even though it arrives as a `user/message` event.
  { seq: 12, type: 'user/message', time: 11000, data: { source: { kind: 'runtime-context', form: 'snapshot' }, content: [{ type: 'text', text: 'RUNTIME-CONTEXT-SNAPSHOT-BODY' }] }, surfaceOp: 'append' },
  { seq: 13, type: 'assistant/message', time: 12000, data: { message: { source: { kind: 'model' }, content: [{ type: 'text', text: 'closing answer' }] } }, surfaceOp: 'append' },
]

// A session loaded with every secret class (and a private model/provider id).
// Every raw value below MUST be absent from the served snapshot.
const secrets = {
  openaiKey: 'sk-abc123def456ghi789jkl012mno',
  awsKey: 'AKIAIOSFODNN7EXAMPLE',
  githubPat: 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz12',
  githubFinePat: 'github_pat_11ABCDEFG0abcdefghijklmn_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxy',
  jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  envLine: 'DB_PASSWORD=hunter2supersecret',
  bearerLine: 'token: "abc123def456ghi789"',
  urlCreds: 'https://user:hunter2pass@db.example.com:5432/app',
  localPath: '/home/gwang/.dsh/sessions/abc.jsonl',
  winPath: 'C:\\Users\\gwang\\.env',
  privateIp: '192.168.111.101',
  privateKeyBlock: '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA7v5x\n-----END RSA PRIVATE KEY-----',
}
const s3events = [
  { seq: 1, type: 'request/header', time: 1000, data: { header: { config: { model: '/home/gwang/models/private-ft.gguf', provider: 'internal-gw' }, system: 'sys', tools: [] } } },
  { seq: 2, type: 'user/message', time: 2000, data: { source: { kind: 'user' }, content: [{ type: 'text', text: `my key is ${secrets.openaiKey} and the aws one is ${secrets.awsKey}` }] }, surfaceOp: 'append' },
  { seq: 3, type: 'assistant/message', time: 3000, data: { message: { source: { kind: 'model' }, content: [{ type: 'text', text: `here is the pat ${secrets.githubPat} and ${secrets.githubFinePat}\njwt: ${secrets.jwt}` }] } }, surfaceOp: 'append' },
  // Over-redaction guard: an ordinary dotted filename is not a JWT.
  { seq: 3.5, type: 'assistant/message', time: 3500, data: { message: { source: { kind: 'model' }, content: [{ type: 'text', text: 'artifacts: build.tar.gz and v1.2.3' }] } }, surfaceOp: 'append' },
  { seq: 4, type: 'assistant/message', time: 3500, data: { message: { source: { kind: 'model' }, content: [{ type: 'text', text: `env:\n${secrets.envLine}\n${secrets.bearerLine}` }] } }, surfaceOp: 'append' },
  { seq: 5, type: 'assistant/message', time: 4000, data: { message: { source: { kind: 'model' }, content: [{ type: 'text', text: `connect at ${secrets.urlCreds} or ${secrets.privateIp}` }] } }, surfaceOp: 'append' },
  { seq: 6, type: 'assistant/message', time: 4500, data: { message: { source: { kind: 'model' }, content: [{ type: 'text', text: `logs at ${secrets.localPath} and ${secrets.winPath}` }] } }, surfaceOp: 'append' },
  { seq: 7, type: 'assistant/message', time: 5000, data: { message: { source: { kind: 'model' }, content: [{ type: 'text', text: secrets.privateKeyBlock }] } }, surfaceOp: 'append' },
  // Regression (§3.2): an assistant message that EMBEDS a tool-result block
  // containing a secret. firstText must not pull the raw output into the text.
  { seq: 8, type: 'assistant/message', time: 6000, data: { message: { source: { kind: 'model' }, content: [
    { type: 'text', text: 'ran it' },
    { type: 'tool-result', callId: 'c9', content: [{ type: 'text', text: `env dump\nGITHUB_TOKEN=${secrets.githubPat}` }] },
  ] } }, surfaceOp: 'append' },
]

// A session written by a FUTURE format: alongside ordinary v4 events it carries
// two event types this build has never seen. The plugin's contract is the
// session record format (v4), not a harness version, so this is exactly the
// case that must be reported rather than silently rendered short.
const s4events = [
  { seq: 1, type: 'request/header', time: 1000, data: { header: { config: { model: 'm', provider: 'p' }, system: 'sys', tools: [] } } },
  { seq: 2, type: 'user/message', time: 2000, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'legit prompt' }] }, surfaceOp: 'append' },
  // Ordinary v4 noise: knowing about these must NOT raise the banner.
  { seq: 3, type: 'step/start', time: 2500, data: {} },
  { seq: 4, type: 'llm/retry', time: 2600, data: {} },
  { seq: 5, type: 'quantum/entangled', time: 3000, data: { payload: 'from the future' } },
  { seq: 6, type: 'assistant/message', time: 4000, data: { message: { source: { kind: 'model' }, content: [{ type: 'text', text: 'legit answer' }] } }, surfaceOp: 'append' },
  { seq: 7, type: 'future/thing', time: 5000, data: {} },
]

// Two turns with a 90s idle gap between them: active execution = 2s, while the
// wall-clock span is 91s. `durationMs` must report the former.
const s2events = [
  { seq: 1, type: 'turn/start', time: 10000 },
  { seq: 2, type: 'assistant/message', time: 11000, data: { message: { source: { kind: 'model' }, content: [{ type: 'text', text: 'a' }] } }, surfaceOp: 'append' },
  { seq: 3, type: 'turn/end', time: 11000 },
  { seq: 4, type: 'turn/start', time: 100000 },
  { seq: 5, type: 'assistant/message', time: 101000, data: { message: { source: { kind: 'model' }, content: [{ type: 'text', text: 'b' }] } }, surfaceOp: 'append' },
  { seq: 6, type: 'turn/end', time: 101000 },
]

// The plugin registers its channel route directly on the injected web server
// (see src/host/rpc.ts). This fake web server answers every request through the
// registered route, so the RPC channel is exercised over a real HTTP socket.
let channelRoute = null
let fenceRejection
const rpcServer = createServer((req, res) => {
  if (channelRoute === null) {
    res.writeHead(503)
    res.end('no route')
    return
  }
  void channelRoute.handler(req, res)
})
await new Promise((resolve) => rpcServer.listen(0, '127.0.0.1', resolve))
const rpcPort = rpcServer.address().port

const webServer = {
  register(route) {
    assert.equal(route.kind, 'prefix')
    assert.equal(route.path, '/dsh-share')
    channelRoute = route
    return () => { channelRoute = null }
  },
}

const ctx = {
  get(name) {
    if (name === 'sessionQuery') return {
      readSession: async (id) => {
        const sessions = { s1: events, s2: s2events, s3: s3events, s4: s4events }
        const found = sessions[id]
        if (found === undefined) throw new Error(`session ${id} not found`)
        return { session: { id }, events: found }
      },
      readTitle: async () => 'Test title',
    }
    return undefined
  },
  effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); return () => {} },
  // Mirrors cordis `ctx.inject(deps, cb)`: run the callback with a context that
  // carries the requested services.
  inject(deps, cb) {
    assert.deepEqual(deps, ['connection', 'webServer'])
    cb(childCtx)
    return () => {}
  },
  connection: { requestRejection: () => fenceRejection },
  webServer,
}
const childCtx = { ...ctx, connection: ctx.connection, webServer }

// A public domain is configured from the start: every URL the Host reports must
// derive it at read time — nothing is persisted, so an existing share picked up
// after a restart shows the current domain and bound port immediately.
apply(ctx, { host: '127.0.0.1', port: 0, publicDomain: 'share.example.com' })
assert.ok(channelRoute !== null, 'RPC channel route must be registered')

/** Drive the channel exactly as the browser caller does. */
async function callRpc(endpoint, payload) {
  const rpcId = randomUUID()
  const res = await fetch(`http://127.0.0.1:${rpcPort}/dsh-share/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload }),
  })
  if (res.status !== 200) {
    // Refusals (fence, malformed body) answer with a plain-text status line.
    await res.text()
    return { status: res.status, result: undefined }
  }
  const body = await res.json()
  assert.equal(body.type, 'server-response', 'response envelope type')
  assert.equal(body.rpcId, rpcId, 'rpcId echoed')
  return { status: res.status, result: body.result }
}

/** Convenience: assert a successful call and return its value. */
async function rpc(endpoint, payload) {
  const { status, result } = await callRpc(endpoint, payload)
  assert.equal(status, 200, `RPC ${endpoint} HTTP status`)
  return result
}

// -- create --
const res = await rpc('create', { sessionId: 's1' })
assert.equal(res.ok, true, `create should succeed: ${JSON.stringify(res)}`)
const share = res.value.share
assert.ok(share.token.length > 0, 'token minted')
assert.equal(share.sessionId, 's1')
assert.equal(share.title, 'Hello there <script>alert(1)</script>'.slice(0, 40))
assert.ok(Array.isArray(share.urls) && share.urls.length > 0, 'urls returned')
// The configured domain leads the URL list; LAN fallbacks follow.
assert.equal(share.url, `https://share.example.com/s/${share.token}`, 'public URL is primary')
assert.match(share.urls[0], /^https:\/\/share\.example\.com\/s\//, 'first URL carries the public domain')
assert.ok(share.urls.length >= 2, 'LAN fallbacks are still listed')
for (const u of share.urls.slice(1)) {
  assert.match(u, /^http:\/\/\d{1,3}(\.\d{1,3}){3}:/, `LAN url after the public one: ${u}`)
}

// -- mounts RPC reports the domain alongside its URLs --
const mounts = await rpc('mounts', {})
assert.equal(mounts.ok, true, `mounts should succeed: ${JSON.stringify(mounts)}`)
assert.equal(mounts.value.publicDomain, 'share.example.com', 'mounts result carries the public domain')

// -- serve the snapshot over the ephemeral server --
// The primary URL is the public domain (not reachable from this host), so
// resolve the bound port from a LAN fallback instead.
// The primary URL is the public domain (not reachable from this host), so
// resolve the bound port from any LAN fallback instead of the primary.
const port = new URL(share.urls[1] ?? share.url).port
const served = await fetch(`http://127.0.0.1:${port}/s/${share.token}`)
assert.equal(served.status, 200)
const html = await served.text()

// DEFAULT IS THE READABLE VIEW: prompts and the final answer only.
assert.match(html, /Hello there/, 'user text present')
assert.match(html, /Hi! I can help\./, 'assistant text present')
assert.doesNotMatch(html, /🔧 调用工具/, 'tool calls are not shown by default')
assert.doesNotMatch(html, /↩ 工具结果/, 'tool results are not shown by default')
assert.doesNotMatch(html, /class="toolrun"/, 'no tool-run group by default')
assert.doesNotMatch(html, /injected note/, 'injected context is not shown by default')
assert.doesNotMatch(html, /上下文占用/, 'no stats header by default')
assert.doesNotMatch(html, /deepseek-v4/, 'no model id by default')
assert.doesNotMatch(html, /<details class="fold"/, 'a readable share never folds the answer away')
// With nothing folded, the long message is simply present in full.
assert.match(html, new RegExp('L{600}'), 'long message rendered in full, unfolded')
// Only the LAST assistant message of a turn survives; the interim one does not.
assert.match(html, /<strong>bold<\/strong>/, 'markdown still rendered in the readable view')
assert.doesNotMatch(html, /<script>alert/, 'message text is HTML-escaped')
assert.doesNotMatch(html, /<script>alert\(2\)/, 'raw HTML in message stays escaped')
assert.match(html, /class="row user"/, 'user entries keep their row class')
assert.match(html, /class="row assistant"/, 'answer rows are present')

// Line structure must survive extraction AND rendering. Collapsing whitespace
// in firstText() previously destroyed newlines before Markdown saw them, which
// rendered a multi-line prompt as one long run.
assert.match(html, /first line<br>/, 'single newlines render as line breaks')
assert.match(html, /second line/, 'every line is present')
assert.doesNotMatch(html, /first line second line/, 'the prompt is not collapsed onto one line')

// The runtime-context snapshot is harness-injected, not user-typed.
assert.doesNotMatch(html, /RUNTIME-CONTEXT-SNAPSHOT-BODY/, 'runtime-context is not shown in the readable view')

// -- technical: true keeps the machine-facing view --
const tech = (await rpc('create', { sessionId: 's1', technical: true })).value.share
const techHtml = await (await fetch(`http://127.0.0.1:${port}/s/${tech.token}`)).text()
assert.match(techHtml, /🔧 调用工具/, 'tool calls present when technical output is on')
assert.match(techHtml, /↩ 工具结果/, 'tool results present when technical output is on')
assert.match(techHtml, /class="toolrun"/, 'consecutive tool calls grouped into one disclosure')
assert.match(techHtml, /🛠 工具调用/, 'tool-run summary label present')
assert.match(techHtml, /injected note/, 'context injection present')
assert.doesNotMatch(techHtml, /shadowed restatement/, 'replacement copy excluded')
assert.match(techHtml, /<details class="fold"/, 'long message folded in the technical view')
assert.match(techHtml, /<span class="preview">/, 'fold preview rendered')
assert.match(techHtml, new RegExp('L{600}'), 'folded full text still present (escaped)')
assert.match(techHtml, /<strong>bold<\/strong>/, 'markdown bold rendered')
assert.match(techHtml, /<code>code<\/code>/, 'markdown inline code rendered')
assert.match(techHtml, /deepseek-v4/, 'ordinary model id rendered in the technical stats header')
assert.match(techHtml, /RUNTIME-CONTEXT-SNAPSHOT-BODY/, 'runtime-context shown as injected context in the technical view')
assert.match(techHtml, /first line<br>/, 'line breaks also render in the technical view')
assert.match(techHtml, /上下文占用/, 'context occupancy heading (technical only)')
assert.match(techHtml, /轮次/, 'turns stat')
assert.match(techHtml, /步数/, 'steps stat')
assert.match(techHtml, /执行时长/, 'duration stat')
assert.match(techHtml, /工具调用时长/, 'tool-call time stat')
assert.match(techHtml, /缓存命中/, 'cache-hit stat')
assert.match(techHtml, /输入 tokens/, 'input tokens stat')
assert.match(techHtml, /输出 tokens/, 'output tokens stat')

// -- list -- (two shares exist: the readable one and the technical one)
const list = await rpc('list', {})
assert.equal(list.ok, true)
assert.equal(list.value.shares.length, 2)
assert.ok(list.value.shares.some((s) => s.token === share.token), 'readable share listed')
assert.ok(list.value.shares.some((s) => s.token === tech.token), 'technical share listed')

// -- defaults endpoint reflects the configured defaults --
const defaults = await rpc('defaults', {})
assert.equal(defaults.ok, true)
assert.equal(defaults.value.technical, false, 'technical output is off by default')
assert.equal(defaults.value.redact, true, 'redaction is on by default')

// -- a session from a newer format is REPORTED, never silently truncated ----
// The contract this plugin actually depends on is the session record format
// (v4), not a harness or @deepseek-ai/dsh version: it renders four event types
// out of the vocabulary's 59. A session carrying a type outside that
// vocabulary is a format this build does not know, and a page that quietly
// dropped the content would read as an empty conversation.
const future = (await rpc('create', { sessionId: 's4' })).value.share
const futurePort = new URL(future.urls[1] ?? future.url).port
const futureHtml = await (await fetch(`http://127.0.0.1:${futurePort}/s/${future.token}`)).text()
assert.match(futureHtml, /legit prompt/, 'known events of the future session still render')
assert.match(futureHtml, /legit answer/, 'the answer renders too')
assert.match(futureHtml, /较新的会话格式/, 'the page says the format is newer than this build')
assert.match(futureHtml, /2 条记录未渲染/, 'and reports how many events were skipped')
assert.doesNotMatch(futureHtml, /from the future/, 'an unknown event never leaks its payload into the page')

// An ORDINARY session must carry no such banner: `step/start`, `llm/retry`,
// `turn/start` and friends are format-v4 events this build deliberately
// ignores, and warning about them would be crying wolf on every real session.
const ordinary = (await rpc('create', { sessionId: 's2' })).value.share
const ordinaryPort = new URL(ordinary.urls[1] ?? ordinary.url).port
const ordinaryHtml = await (await fetch(`http://127.0.0.1:${ordinaryPort}/s/${ordinary.token}`)).text()
assert.doesNotMatch(ordinaryHtml, /较新的会话格式/, 'an ordinary session raises no format banner')

// -- revoke -> 404 --
const revoke = await rpc('revoke', { token: share.token })
assert.equal(revoke.ok, true)
assert.equal(revoke.value.removed, true)
const gone = await fetch(`http://127.0.0.1:${port}/s/${share.token}`)
assert.equal(gone.status, 404)

// -- redaction: default ON, every secret class masked, count reported --
const res3 = await rpc('create', { sessionId: 's3' })
assert.equal(res3.ok, true, `s3 create should succeed: ${JSON.stringify(res3)}`)
const s3share = res3.value.share
assert.ok(s3share.redactedCount > 0, 'redactedCount reported and > 0')
const s3html = await (await fetch(`http://127.0.0.1:${port}/s/${s3share.token}`)).text()
for (const [label, raw] of Object.entries(secrets)) {
  for (const line of raw.split('\n')) {
    const needle = line.trim()
    if (needle.length >= 8) assert.doesNotMatch(s3html, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `raw secret [${label}] must be redacted: ${needle.slice(0, 24)}…`)
  }
}
assert.match(s3html, /«REDACTED»/, 'redaction marker present')
// The count lives on the RPC result (the dialog's job); the served page carries
// a static redaction marker. Both must be present.
assert.match(s3html, /已脱敏/ , 'redaction marker shown in page header')
// firstText bypass regression: the embedded tool-result output must not leak.
assert.doesNotMatch(s3html, /env dump/, 'embedded tool-result output must not enter the snapshot')

// The same session with technical output ON: the stats header renders
// `model · provider`, so these leak surfaces only exist in that view.
const s3tech = (await rpc('create', { sessionId: 's3', technical: true })).value.share
const s3techHtml = await (await fetch(`http://127.0.0.1:${port}/s/${s3tech.token}`)).text()
assert.match(s3techHtml, /build\.tar\.gz and v1\.2\.3/, 'ordinary dotted names are NOT mistaken for JWTs')
assert.doesNotMatch(s3techHtml, /\/home\/gwang\/models\//, 'stats model path prefix must be redacted')
assert.match(s3techHtml, /private-ft\.gguf/, 'stats model keeps its final segment')
assert.match(s3techHtml, /internal-gw/, 'ordinary provider id is not over-redacted')
assert.doesNotMatch(s3techHtml, /env dump/, 'tool-result output still never enters the snapshot')
for (const [label, raw] of Object.entries(secrets)) {
  for (const line of raw.split('\n')) {
    const needle = line.trim()
    if (needle.length >= 8) assert.doesNotMatch(s3techHtml, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `raw secret [${label}] must be redacted in the technical view too`)
  }
}

// -- redaction override: a deliberate raw share (per-create) skips redaction --
const resRaw = await rpc('create', { sessionId: 's3', redact: { enabled: false } })
assert.equal(resRaw.ok, true)
const rawHtml = await (await fetch(`http://127.0.0.1:${port}/s/${resRaw.value.share.token}`)).text()
assert.match(rawHtml, new RegExp(secrets.openaiKey), 'raw share keeps the original key')
assert.equal(resRaw.value.share.redactedCount, 0, 'raw share reports zero redactions')

// -- error paths --
const missing = await rpc('create', {})
assert.equal(missing.ok, false)
assert.match(missing.error.message, /sessionId/)
const unknown = await rpc('nope', {})
assert.equal(unknown.ok, false)
assert.match(unknown.error.message, /unknown endpoint/)

// -- execution duration = sum of turn spans, not wall-clock span --
// Stats live in the technical view, so ask for it explicitly.
const res2 = await rpc('create', { sessionId: 's2', technical: true })
assert.equal(res2.ok, true, 's2 create should succeed')
const s2html = await (await fetch(`http://127.0.0.1:${port}/s/${res2.value.share.token}`)).text()
assert.match(s2html, /执行时长<\/span><b>2s<\/b>/, 'duration is the active turn time (2s), excluding idle gaps')
assert.doesNotMatch(s2html, /1m 31s/, 'idle gap between turns is not counted')

// -- oversized RPC bodies: refused up front, and the stream is torn down ----
const declaredHuge = await fetch(`http://127.0.0.1:${rpcPort}/dsh-share/create`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'content-length': String(64 * 1024 * 1024) },
  body: '{}',
}).catch(() => null)
// A declared length over the cap is refused without reading a byte; the
// connection may be reset, which counts as refused.
assert.ok(declaredHuge === null || declaredHuge.status === 413, 'a declared oversized body is refused')

const streamedHuge = await fetch(`http://127.0.0.1:${rpcPort}/dsh-share/create`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'client-request', rpcId: 'big', method: 'create', payload: { sessionId: 'x'.repeat(1024 * 1024) } }),
}).catch(() => null)
assert.ok(streamedHuge === null || streamedHuge.status === 413, 'a streamed oversized body is refused')
// The channel must still work after both refusals.
assert.equal((await rpc('list', {})).ok, true, 'the channel survives oversized requests')

// -- the rendered-page cache honours revocation and expiry -------------------
const cachedShare = (await rpc('create', { sessionId: 's1' })).value.share
// The primary URL is the public domain; resolve the port from a LAN fallback.
const cachedUrl = `http://127.0.0.1:${new URL(cachedShare.urls[1] ?? cachedShare.url).port}/s/${cachedShare.token}`
const firstHit = await fetch(cachedUrl)
assert.equal(firstHit.status, 200)
const firstBody = await firstHit.text()
// Second hit is served from cache; bytes must be identical.
const secondHit = await fetch(cachedUrl)
assert.equal(secondHit.status, 200)
assert.equal(await secondHit.text(), firstBody, 'the cached page is byte-identical')
// Revoking must drop the cached render immediately, not when it ages out.
await rpc('revoke', { token: cachedShare.token })
assert.equal((await fetch(cachedUrl)).status, 404, 'revocation invalidates the cached page at once')

// A cached page must never outlive the share's own expiry.
const expiring = (await rpc('create', { sessionId: 's1', expiresInSec: 0.2 })).value.share
const expiringUrl = `http://127.0.0.1:${new URL(expiring.urls[1] ?? expiring.url).port}/s/${expiring.token}`
assert.equal((await fetch(expiringUrl)).status, 200, 'an unexpired share serves')
await new Promise((r) => setTimeout(r, 400))
assert.equal((await fetch(expiringUrl)).status, 404, 'the cache does not outlive the share expiry')

// -- a page must not outlive its share when the STORE evicts it ---------------
// `add` drops the oldest shares past MAX_SHARES. The rendered-page cache has to
// follow, or a page would keep serving for a share the store no longer holds.
const victim = (await rpc('create', { sessionId: 's1' })).value.share
const victimUrl = `http://127.0.0.1:${new URL(victim.urls[1] ?? victim.url).port}/s/${victim.token}`
assert.equal((await fetch(victimUrl)).status, 200, 'the victim share serves and is cached')
for (let i = 0; i < 101; i += 1) {
  await rpc('create', { sessionId: 's1' })
}
assert.equal((await fetch(victimUrl)).status, 404, 'an evicted share stops serving, cache included')

// -- admission fence: the Connection service's rejection is honoured verbatim --
fenceRejection = 403
const fenced = await callRpc('list', {})
assert.equal(fenced.status, 403, 'a refused request never reaches the handler')
fenceRejection = 401
assert.equal((await callRpc('list', {})).status, 401, 'unauthenticated request is 401')
fenceRejection = undefined

// -- envelope and routing failures --
const notPost = await fetch(`http://127.0.0.1:${rpcPort}/dsh-share/list`)
assert.equal(notPost.status, 404, 'non-POST is refused')
const badJson = await fetch(`http://127.0.0.1:${rpcPort}/dsh-share/list`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json',
})
assert.equal(badJson.status, 400, 'non-JSON body is refused')
const badEnvelope = await fetch(`http://127.0.0.1:${rpcPort}/dsh-share/list`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'nope' }),
})
assert.equal(badEnvelope.status, 400, 'malformed envelope is refused')

// cleanup
for (const d of disposers.reverse()) await d?.()
await new Promise((resolve) => rpcServer.close(resolve))
await rm(tmpHome, { recursive: true, force: true })

console.log('✔ host half functional test passed (RPC over HTTP, fence, envelope, size limits, page cache, readable-vs-technical view, transcript fold, HTML escape, serve/list/revoke, error paths)')
