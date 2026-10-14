#!/usr/bin/env node
/**
 * Boot-behaviour test: the share server must come up by itself when there is
 * something to serve.
 *
 * Regression for a real production symptom — after a dsh restart, a share link
 * that had already been handed to someone answered "link does not exist",
 * because the server only ever started lazily on the NEXT share creation. The
 * shares are persisted and never expire by default, so a restart must not take
 * them down.
 *
 * Observed through the plugin's own `list` endpoint: with no server the URLs
 * are built from the configured port (0, i.e. nothing is bound); with the eager
 * start they carry the real bound port.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmpHome = await mkdtemp(join(tmpdir(), 'dsh-share-boot-'))
process.env.DSH_HOME = tmpHome

const { apply } = await import('../lib/index.js')

/** A minimal share record, shaped exactly as the store persists it. */
function seededShare(token, sessionId) {
  return {
    token,
    sessionId,
    title: 'seeded session',
    createdAt: Date.now(),
    entries: [{ role: 'user', text: 'hello from before the restart' }],
  }
}

async function mountPlugin() {
  let channelRoute = null
  const rpcServer = createServer((req, res) => {
    if (channelRoute === null) {
      res.writeHead(503)
      res.end('no route')
      return
    }
    void channelRoute.handler(req, res)
  })
  await new Promise((resolve) => rpcServer.listen(0, '127.0.0.1', resolve))

  const disposers = []
  const ctx = {
    get: () => undefined,
    effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); return () => {} },
    inject(_deps, cb) { cb(child); return () => {} },
    connection: { requestRejection: () => undefined },
    webServer: { register(route) { channelRoute = route; return () => { channelRoute = null } } },
  }
  const child = { ...ctx, connection: ctx.connection, webServer: ctx.webServer }
  apply(ctx, { host: '127.0.0.1', port: 0, mounts: [] })

  const rpc = async (endpoint, payload) => {
    const rpcId = randomUUID()
    const res = await fetch(`http://127.0.0.1:${rpcServer.address().port}/dsh-share/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload }),
    })
    assert.equal(res.status, 200, `RPC ${endpoint}`)
    return (await res.json()).result
  }
  return {
    rpc,
    close: async () => {
      for (const d of disposers.reverse()) await d?.()
      await new Promise((resolve) => rpcServer.close(resolve))
    },
  }
}

const portOf = (share) => new URL(share.url).port

// ---- 1. Nothing to serve: the server must stay lazy ----
{
  const app = await mountPlugin()
  await new Promise((r) => setTimeout(r, 120))
  const res = await app.rpc('list', {})
  assert.equal(res.ok, true, 'list works with an empty store')
  assert.equal(res.value.shares.length, 0, 'store starts empty')
  await app.close()
}

// ---- 2. A share already in the store: the server must come up on its own ----
{
  const dir = join(tmpHome, '.dsh')
  await mkdir(dir, { recursive: true })
  const token = 'a'.repeat(32)
  await writeFile(
    join(dir, 'dsh-share.json'),
    JSON.stringify({ version: 1, shares: [seededShare(token, 's-boot')] }),
    'utf8',
  )

  const app = await mountPlugin()
  // The eager start is asynchronous; give it a moment to bind.
  await new Promise((r) => setTimeout(r, 300))

  const res = await app.rpc('list', {})
  assert.equal(res.ok, true)
  assert.equal(res.value.shares.length, 1, 'the persisted share is listed')
  const share = res.value.shares[0]

  assert.notEqual(portOf(share), '0', 'the share server bound itself at activation')
  assert.notEqual(portOf(share), '', 'the URL carries a real port')

  // And the persisted link actually serves, with no share created this boot.
  const page = await fetch(`http://127.0.0.1:${portOf(share)}/s/${token}`)
  assert.equal(page.status, 200, 'a pre-existing share link keeps working after a restart')
  assert.match(await page.text(), /hello from before the restart/)

  await app.close()
}

await rm(tmpHome, { recursive: true, force: true })
console.log('✔ boot test passed (lazy when empty, serves persisted shares after a restart)')
