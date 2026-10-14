#!/usr/bin/env node
/**
 * Functional smoke test for the packaged client half: mounts the built client
 * bundle with the ACTUAL react/react-dom inside jsdom, drives the RPC with a
 * synthetic snapshot, and asserts that
 *
 *   - the header Share button registers, renders, and opens a dialog that
 *     calls `list` and sends the redaction flag with `create`; and
 *   - the settings card registers into the right slot under the right key,
 *     renders the saved mounts, and saves through ONE fenced mutation whose
 *     values carry the types the schema declares.
 *
 * The key and the op types are pinned here on purpose: both fail silently in
 * the real UI (no error, nothing logged), so a wrong value would otherwise only
 * be discovered by opening the Plugins page.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import React from 'react'
import { createRoot } from 'react-dom/client'

const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })

// ---- module table: real React ----
let handoff = null
globalThis.window.__ModuleLoader__ = { load(h) { handoff = h } }
const requireFn = (spec) => {
  if (spec === 'react') return React
  throw new Error(`unexpected module: ${spec}`)
}
// Execute the bundle so it invokes window.__ModuleLoader__.load({...})
new Function('window', 'document', bundle)(globalThis.window, dom.window.document)
assert.ok(handoff !== null && typeof handoff.factory === 'function', 'handoff registered factory')
const plugin = handoff.factory(requireFn)

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms))

// ---- fake client ctx ----
const rpcCalls = []
const registrations = []
let mutateCalls = []

const savedMounts = [{ name: 'apk', path: '/srv/app/release', token: '', index: true, hidden: false }]
const scopeState = { revision: 7, value: { mounts: savedMounts, publicDomain: '' }, writable: true }
const scope = {
  getSnapshot: () => ({
    status: 'ready',
    writable: scopeState.writable,
    value: scopeState.value,
    revision: scopeState.revision,
  }),
  subscribe: () => () => {},
  mutate: async (ops, revision) => {
    mutateCalls.push({ ops, revision })
    const next = { ...scopeState.value }
    for (const op of ops) next[op.path[0]] = op.value
    scopeState.value = next
    scopeState.revision += 1
    return true
  },
}

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
        if (endpoint === 'defaults') return { ok: true, value: { technical: false, redact: true } }
        if (endpoint === 'mounts') {
          return {
            ok: true,
            value: {
              mounts: [{
                name: 'apk',
                path: '/srv/app/release',
                root: '/srv/app/release',
                token: false,
                index: true,
                hidden: false,
                status: 'serving',
                urls: ['https://share.example.com/apk/', 'http://192.168.1.5:3081/apk/'],
              }],
              lanIps: ['192.168.1.5'],
              publicDomain: 'share.example.com',
            },
          }
        }
        return {
          ok: true,
          value: {
            share: {
              token: 'abc', sessionId: payload.sessionId, title: 'T', createdAt: 1,
              url: 'https://share.example.com/s/abc', urls: ['https://share.example.com/s/abc', 'http://192.168.1.5:3081/s/abc'],
            },
          },
        }
      },
    },
  },
  slots: {
    inject: (name, fn) => { fn() },
    register: (opts, component) => { registrations.push({ opts, component }); return opts },
    entries: () => [],
  },
  configForms: {
    get: () => scope,
    whileServed: (namespaces, register) => register(),
  },
}
plugin.apply(ctx)

assert.ok(plugin.inject.includes('configForms'), 'client half injects the configForms service')

const buttonReg = registrations.find((r) => r.opts.name === 'conversation.session.header.utilities')
const cardReg = registrations.find((r) => r.opts.name === 'plugins.row.config')
assert.ok(buttonReg !== undefined, 'share button registered')
assert.ok(cardReg !== undefined, 'settings card registered')

// The keyed slot's key fails silently when wrong, so pin both literals: the
// package name from package.json and the row id from cordis.patch.yml.
assert.equal(cardReg.opts.key, `${pkg.name}#dsh-share-plus`, 'card key must be <package name>#<row id>')
assert.match(pkg.dsh.bundle.patch, /cordis\.patch\.yml/)

// ---- share button: render, dialog, create payload ----
const container = dom.window.document.createElement('div')
dom.window.document.body.appendChild(container)
const root = createRoot(container)
root.render(React.createElement(buttonReg.component, { sessionId: 's1' }))
await tick()

const button = container.querySelector('.dshshare-btn')
assert.ok(button !== null, 'share button rendered')
assert.equal(button.textContent, 'button', 'button label from bound locale')

button.click()
await tick(20)
assert.ok(container.querySelector('.dshshare-overlay') !== null, 'dialog opened')
assert.ok(rpcCalls.some((c) => c.channel === '/dsh-share-plus' && c.endpoint === 'list'), 'list RPC called on open')

const redactBox = container.querySelector('#dshshare-redact')
assert.ok(redactBox !== null, 'redact checkbox present')
assert.equal(redactBox.checked, true, 'redaction on by default')

const techBox = container.querySelector('#dshshare-technical')
assert.ok(techBox !== null, 'technical-output checkbox present')
assert.equal(techBox.checked, false, 'technical output off by default')

const gen = container.querySelector('.dshshare-primary')
assert.ok(gen !== null, 'generate button present')
gen.click()
await tick(20)
const createCall = rpcCalls.find((c) => c.channel === '/dsh-share-plus' && c.endpoint === 'create')
assert.ok(createCall !== undefined, 'create RPC called')
assert.deepEqual(createCall.payload.redact, { enabled: true }, 'redact flag sent with create')
// Technical output is off by default and the dialog must say so explicitly.
assert.equal(createCall.payload.technical, false, 'technical flag sent with create, defaulting to false')
assert.ok(
  rpcCalls.some((c) => c.channel === '/dsh-share-plus' && c.endpoint === 'defaults'),
  'dialog seeds its toggles from the Host defaults',
)
const urlRows = container.querySelectorAll('.dshshare-url')
assert.equal(urlRows.length, 2, 'public and LAN URLs both listed')
// The test locale echoes keys verbatim (bind: key => key), so match the key.
assert.match(container.textContent, /dialog\.internet/, 'public URL tagged with the internet tag')
assert.match(container.textContent, /dialog\.lan/, 'LAN URL still tagged with the LAN tag')
root.unmount()

// ---- settings card ----
const cardContainer = dom.window.document.createElement('div')
dom.window.document.body.appendChild(cardContainer)
const cardRoot = createRoot(cardContainer)
cardRoot.render(React.createElement(cardReg.component, { view: 'page' }))
await tick()

assert.ok(cardContainer.querySelector('.dshshare-card') !== null, 'card body rendered')
assert.equal(cardContainer.querySelectorAll('.dshshare-mount').length, 1, 'one saved mount rendered')

const nameInput = cardContainer.querySelector('.dshshare-mount-name')
const pathInput = cardContainer.querySelector('.dshshare-mount-path')
assert.equal(nameInput.value, 'apk', 'saved mount name seeded')
assert.equal(pathInput.value, '/srv/app/release', 'saved mount path seeded')

// Live status comes from the Host, including the copyable URL.
await tick(20)
assert.ok(
  rpcCalls.some((c) => c.channel === '/dsh-share-plus' && c.endpoint === 'mounts'),
  'card asks the Host for mount status',
)
const mountUrls = cardContainer.querySelectorAll('.dshshare-mount-url code')
assert.equal(mountUrls.length, 2, 'public and LAN fallback URLs both listed')
assert.match(mountUrls[0].textContent, /share\.example\.com\/apk\//, 'public-domain URL shown first')
assert.match(mountUrls[1].textContent, /192\.168\.1\.5:3081\/apk\//, 'LAN fallback URL still listed')
const domainInput = cardContainer.querySelector('#dshshare-card-domain')
assert.ok(domainInput !== null, 'domain field present on the card')
assert.equal(domainInput.value, '', 'no saved domain yet')

// React inputs ignore a plain `.value =` assignment; dispatch the native setter.
const setNative = (el, val) => {
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')
  desc.set.call(el, val)
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
}

// Re-query after every render: React replaces the node, so a held reference
// reports the state of a detached element.
const saveButton = () => cardContainer.querySelector('.dshshare-card-actions .dshshare-primary')
assert.ok(saveButton() !== null, 'save button present')
assert.equal(saveButton().disabled, true, 'save is disabled while the draft is clean')

setNative(cardContainer.querySelector('.dshshare-mount-path'), '/srv/app/release-2')
setNative(domainInput, ' share.example.com ')
await tick(10)
assert.equal(saveButton().disabled, false, 'save enables once the draft is dirty')

saveButton().click()
await tick(20)

assert.equal(mutateCalls.length, 1, 'exactly one fenced mutation per save')
const { ops, revision } = mutateCalls[0]
assert.equal(revision, 7, 'the mutation quotes the revision the draft began from')
assert.equal(ops.length, 3, 'mounts, the technical flag and the domain are written together')
const mountOp = ops.find((o) => o.path[0] === 'mounts')
const techOp = ops.find((o) => o.path[0] === 'technicalInfo')
const domainOp = ops.find((o) => o.path[0] === 'publicDomain')
assert.equal(domainOp.op, 'set')
assert.equal(domainOp.value, 'share.example.com', 'domain trimmed before commit')
assert.equal(mountOp.op, 'set')
assert.ok(Array.isArray(mountOp.value), 'mounts is staged as a real array, not text')
assert.equal(typeof techOp.value, 'boolean', 'technicalInfo must be a real boolean, not "true"')

// The write seam re-validates types, so assert the staged value's shape.
const staged = mountOp.value[0]
assert.equal(typeof staged.name, 'string')
assert.equal(typeof staged.path, 'string')
assert.equal(staged.path, '/srv/app/release-2')
assert.equal(typeof staged.token, 'string', 'token must be a string even when empty')
assert.equal(typeof staged.index, 'boolean', 'index must be a real boolean, not "true"')
assert.equal(typeof staged.hidden, 'boolean', 'hidden must be a real boolean, not "true"')

// Adding and removing rows stays local until save.
cardContainer.querySelector('.dshshare-card-actions .dshshare-link').click()
await tick(10)
assert.equal(cardContainer.querySelectorAll('.dshshare-mount').length, 2, 'add appends a row')
assert.equal(mutateCalls.length, 1, 'adding a row does not write until save')

// The summary view is the row's description fallback; it must be a real element.
const summary = cardReg.component({ view: 'summary' })
assert.ok(summary !== null && summary !== undefined, 'summary view returns copy, not null')

cardRoot.unmount()
console.log('✔ client half functional test passed (button + dialog + redact/technical flags, settings card key, mount rows, fenced typed save)')
