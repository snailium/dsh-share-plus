#!/usr/bin/env node
/**
 * Functional smoke test for the packaged client half: mounts the built client
 * bundle with the ACTUAL react/react-dom inside jsdom, drives the RPC with a
 * synthetic snapshot, and asserts the header button registers, renders, and
 * opens a dialog that calls `list`.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import React from 'react'
import { createRoot } from 'react-dom/client'

const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
globalThis.window = dom.window
globalThis.document = dom.window.document

// ---- module table: real React ----
let handoff = null
globalThis.window.__ModuleLoader__ = { load(h) { handoff = h } }
const requireFn = (spec) => {
  if (spec === 'react') return React
  throw new Error(`unexpected module: ${spec}`)
}
const start = bundle.indexOf('factory: (require) => {') + 'factory: (require) => {'.length
const end = bundle.indexOf('    return module.exports;')
const factory = new Function('require', 'module', 'window', 'document', bundle.slice(start, end) + '\n    return module.exports;')
const m = { exports: {} }
const plugin = factory(requireFn, m, globalThis.window, dom.window.document)

// ---- fake client ctx ----
const rpcCalls = []
let viewComponent = null
const ctx = {
  get: () => undefined,
  effect: (fn) => { fn(); return () => {} },
  locale: {
    register: () => () => {},
    bind: () => (key) => key,
    subscribe: () => () => {},
  },
  connection: {
    rpc: {
      call: async (channel, endpoint, payload) => {
        rpcCalls.push({ channel, endpoint, payload })
        if (endpoint === 'list') return { ok: true, value: { shares: [] } }
        return { ok: true, value: { share: { token: 'abc', sessionId: payload.sessionId, title: 'T', createdAt: 1, url: 'http://x/s/abc', urls: ['http://x/s/abc'] } } }
      },
    },
  },
  slots: {
    inject: (name, fn) => { fn() },
    register: (opts, component) => { viewComponent = component; return opts },
  },
}
plugin.apply(ctx)
assert.ok(viewComponent !== null, 'component registered')

// ---- render with real React ----
const container = dom.window.document.createElement('div')
dom.window.document.body.appendChild(container)
const root = createRoot(container)
root.render(React.createElement(viewComponent, { sessionId: 's1' }))
await new Promise((r) => setTimeout(r, 30))

const button = container.querySelector('.dshshare-btn')
assert.ok(button !== null, 'share button rendered')
assert.equal(button.textContent, 'button', 'button label from bound locale')

// Click opens the dialog and triggers a `list` RPC.
button.click()
await new Promise((r) => setTimeout(r, 20))
assert.ok(container.querySelector('.dshshare-overlay') !== null, 'dialog opened')
assert.ok(rpcCalls.some((c) => c.channel === '/dsh-share' && c.endpoint === 'list'), 'list RPC called on open')

// Generate button is present and wired to `create`.
const gen = container.querySelector('.dshshare-primary')
assert.ok(gen !== null, 'generate button present')
gen.click()
await new Promise((r) => setTimeout(r, 20))
assert.ok(rpcCalls.some((c) => c.channel === '/dsh-share' && c.endpoint === 'create'), 'create RPC called')

root.unmount()
console.log('✔ client half functional test passed (registration, render, dialog, create/list RPC)')
