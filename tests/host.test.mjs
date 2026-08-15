#!/usr/bin/env node
/**
 * Functional smoke test for the packaged host half: mounts the plugin on a
 * fake ctx, drives the captured RPC handler with a synthetic event log, and
 * asserts transcript folding, snapshot serving, list, and revoke. The share
 * server binds 127.0.0.1 on an ephemeral port (port 0) and the store file is
 * redirected to a temp dir via DSH_HOME, so nothing touches the real home or
 * listens on 0.0.0.0.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
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

const ctx = {
  get(name) {
    if (name === 'sessionQuery') return {
      readSession: async (id) => {
        const sessions = { s1: events, s2: s2events }
        const found = sessions[id]
        if (found === undefined) throw new Error(`session ${id} not found`)
        return { session: { id }, events: found }
      },
      readTitle: async () => 'Test title',
    }
    return undefined
  },
  effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); return () => {} },
  connection: {
    rpc: {
      handle(channel, fn, options) {
        assert.equal(channel, '/dsh-share')
        assert.deepEqual(options, { authority: 'trusted-host' })
        handler = fn
        return async () => {}
      },
    },
  },
}

apply(ctx, { host: '127.0.0.1', port: 0 })
assert.ok(handler !== null, 'RPC handler must be registered')

// -- create --
const res = await handler('create', { sessionId: 's1' })
assert.equal(res.ok, true, `create should succeed: ${JSON.stringify(res)}`)
const share = res.value.share
assert.ok(share.token.length > 0, 'token minted')
assert.equal(share.sessionId, 's1')
assert.equal(share.title, 'Hello there <script>alert(1)</script>'.slice(0, 40))
assert.ok(Array.isArray(share.urls) && share.urls.length > 0, 'urls returned')

// -- serve the snapshot over the ephemeral server --
const port = new URL(share.url).port
const served = await fetch(`http://127.0.0.1:${port}/s/${share.token}`)
assert.equal(served.status, 200)
const html = await served.text()
assert.match(html, /Hello there/, 'user text present')
assert.match(html, /Hi! I can help\./, 'assistant text present')
assert.match(html, /🔧 调用工具/, 'tool call collapsed')
assert.match(html, /↩ 工具结果/, 'tool result collapsed')
assert.match(html, /class="toolrun"/, 'consecutive tool calls grouped into one disclosure')
assert.match(html, /🛠 工具调用/, 'tool-run summary label present')
assert.match(html, /injected note/, 'context injection present')
assert.doesNotMatch(html, /shadowed restatement/, 'replacement copy excluded')
assert.doesNotMatch(html, /<script>alert/, 'message text is HTML-escaped')
assert.match(html, /class="fold"/, 'long message folded')
assert.match(html, /展开全文/, 'fold toggle label present')
assert.match(html, new RegExp('L{600}'), 'folded full text still present (escaped)')

// -- markdown rendering (safe: raw HTML escaped) --
assert.match(html, /<strong>bold<\/strong>/, 'markdown bold rendered')
assert.match(html, /<code>code<\/code>/, 'markdown inline code rendered')
assert.doesNotMatch(html, /<script>alert\(2\)/, 'raw HTML in message stays escaped')

// -- stats header rendered (frozen at share time) --
assert.match(html, /上下文占用/, 'context occupancy heading')
assert.match(html, /轮次/, 'turns stat')
assert.match(html, /步数/, 'steps stat')
assert.match(html, /执行时长/, 'duration stat')
assert.match(html, /工具调用时长/, 'tool-call time stat')
assert.match(html, /缓存命中/, 'cache-hit stat')
assert.match(html, /输入 tokens/, 'input tokens stat')
assert.match(html, /输出 tokens/, 'output tokens stat')

// -- list --
const list = await handler('list', {})
assert.equal(list.ok, true)
assert.equal(list.value.shares.length, 1)
assert.equal(list.value.shares[0].token, share.token)

// -- revoke -> 404 --
const revoke = await handler('revoke', { token: share.token })
assert.equal(revoke.ok, true)
assert.equal(revoke.value.removed, true)
const gone = await fetch(`http://127.0.0.1:${port}/s/${share.token}`)
assert.equal(gone.status, 404)

// -- error paths --
const missing = await handler('create', {})
assert.equal(missing.ok, false)
assert.match(missing.error.message, /sessionId/)
const unknown = await handler('nope', {})
assert.equal(unknown.ok, false)
assert.match(unknown.error.message, /unknown endpoint/)

// -- execution duration = sum of turn spans, not wall-clock span --
const res2 = await handler('create', { sessionId: 's2' })
assert.equal(res2.ok, true, 's2 create should succeed')
const s2html = await (await fetch(`http://127.0.0.1:${port}/s/${res2.value.share.token}`)).text()
assert.match(s2html, /执行时长<\/span><b>2s<\/b>/, 'duration is the active turn time (2s), excluding idle gaps')
assert.doesNotMatch(s2html, /1m 31s/, 'idle gap between turns is not counted')

// cleanup
for (const d of disposers.reverse()) await d?.()
await rm(tmpHome, { recursive: true, force: true })

console.log('✔ host half functional test passed (RPC, transcript fold, HTML escape, serve/list/revoke, error paths)')
