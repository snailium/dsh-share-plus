#!/usr/bin/env node
/**
 * Functional test for directory mounts.
 *
 * Everything here goes through the real plugin entry and the real RPC channel,
 * so it exercises the config plumbing, the eager server start, and the HTTP
 * routing together. The fixture deliberately contains the shapes an attacker
 * (or a careless build script) would produce:
 *
 *   - a traversal attempt in the URL,
 *   - a symlink pointing OUT of the mount (must be refused),
 *   - a symlink pointing INSIDE it (must work),
 *   - a dotfile (hidden by default),
 *   - an HTML file (never served inline on this origin).
 *
 * The share server binds 127.0.0.1 on an ephemeral port and the store file is
 * redirected to a temp dir via DSH_HOME, so nothing touches the real home.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmpHome = await mkdtemp(join(tmpdir(), 'dsh-share-mounts-'))
process.env.DSH_HOME = tmpHome

const { apply } = await import('../lib/index.js')

// ---- fixture ----------------------------------------------------------------

const outsideDir = await mkdtemp(join(tmpdir(), 'dsh-share-outside-'))
await writeFile(join(outsideDir, 'secret.txt'), 'OUTSIDE-SECRET\n')

const root = join(tmpHome, 'build-output')
const sub = join(root, 'sub')
await mkdir(sub, { recursive: true })
await writeFile(join(root, 'app-release.apk'), 'PK\u0003\u0004fake-apk-bytes')
await writeFile(join(root, 'notes.txt'), 'plain notes\n')
await writeFile(join(root, 'page.html'), '<script>alert(1)</script>\n')
await writeFile(join(root, '.env'), 'DB_PASSWORD=hunter2\n')
await writeFile(join(sub, 'nested.bin'), Buffer.alloc(4096, 7))
await writeFile(join(outsideDir, 'inner.txt'), 'inner\n')
// A symlink that must NOT become a pivot out of the mount.
await symlink(join(outsideDir, 'secret.txt'), join(root, 'escape.txt'))
// A symlink that stays inside: legitimate and expected to work.
await symlink(join(sub, 'nested.bin'), join(root, 'inner-link.bin'))

// A second root whose mount opts dotfiles back in.
const hiddenRoot = join(tmpHome, 'with-hidden')
await mkdir(hiddenRoot, { recursive: true })
await writeFile(join(hiddenRoot, '.env'), 'DB_PASSWORD=hunter2\n')

// A directory larger than the listing cap, so the streaming scan and its
// truncation note are exercised (the cap is 5000 entries).
const bigRoot = join(tmpHome, 'big')
await mkdir(bigRoot, { recursive: true })
await Promise.all(
  Array.from({ length: 5010 }, (_, i) => writeFile(join(bigRoot, `e${String(i).padStart(4, '0')}.txt`), '')),
)

// ---- mount a real plugin over a fake web server ------------------------------

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
const rpcPort = rpcServer.address().port

const disposers = []
const ctx = {
  get: () => undefined,
  effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); return () => {} },
  inject(deps, cb) { cb(childCtx); return () => {} },
  connection: { requestRejection: () => undefined },
  webServer: {
    register(route) { channelRoute = route; return () => { channelRoute = null } },
  },
}
const childCtx = { ...ctx, connection: ctx.connection, webServer: ctx.webServer }

apply(ctx, {
  host: '127.0.0.1',
  port: 0,
  mounts: [
    { name: 'apk', path: root },
    { name: 'wh', path: hiddenRoot, hidden: true },
    { name: 'big', path: bigRoot },
    { name: 'priv', path: root, token: 's3cret' },
    { name: 'missing', path: join(tmpHome, 'nope') },
    { name: 's', path: root },              // reserved name
    { name: 'apk', path: root },            // duplicate
  ],
})

async function rpc(endpoint, payload) {
  const rpcId = randomUUID()
  const res = await fetch(`http://127.0.0.1:${rpcPort}/dsh-share-plus/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload }),
  })
  assert.equal(res.status, 200, `RPC ${endpoint} status`)
  const body = await res.json()
  return body.result
}

// The `mounts` endpoint also starts the server, which is how a mount added
// through the settings card becomes reachable without a restart.
const mountsResult = await rpc('mounts', {})
assert.equal(mountsResult.ok, true, `mounts endpoint should succeed: ${JSON.stringify(mountsResult)}`)
const views = mountsResult.value.mounts
const apkView = views.find((v) => v.name === 'apk')
const privView = views.find((v) => v.name === 'priv')
const missingView = views.find((v) => v.name === 'missing')
assert.equal(apkView.status, 'serving', 'configured mount is served')
assert.equal(privView.token, true, 'token-protected mount reports that a token is required')
assert.equal(missingView.status, 'invalid', 'a mount with a missing path is not served')
assert.match(missingView.reason, /does not exist/, 'and says why')

const PORT = new URL(apkView.urls[0]).port
assert.ok(PORT !== '0' && PORT !== '', 'mount URL carries the real bound port')
// Fetch over loopback: the advertised URL may name a LAN address, but the
// bind is 127.0.0.1 and the route under test is the same either way.
const origin = `http://127.0.0.1:${PORT}`
// The reserved/duplicate specs must not have produced a servable mount.
assert.equal(views.find((v) => v.name === 's').status, 'invalid', 'the reserved /s/ prefix is refused')
assert.match(views.find((v) => v.name === 's').reason, /reserved/, 'and says why')

const get = async (path, init) => await fetch(`${origin}${path}`, init)

// ---- directory listing -------------------------------------------------------

const listingRes = await get('/apk/')
assert.equal(listingRes.status, 200, 'mount root lists')
assert.match(listingRes.headers.get('content-type'), /text\/html/)
assert.match(listingRes.headers.get('content-security-policy') ?? '', /default-src 'none'/, 'listing carries a restrictive CSP')
const listing = await listingRes.text()
assert.match(listing, /app-release\.apk/, 'listing shows files')
assert.match(listing, /sub\//, 'listing marks directories')
assert.doesNotMatch(listing, /\.env/, 'dotfiles are hidden by default')
assert.doesNotMatch(listing, /escape\.txt/, 'a symlink escaping the mount is not advertised')
assert.match(listing, /inner-link\.bin/, 'a symlink staying inside the mount is listed')
assert.match(listing, /4\.0 KB/, 'sizes are rendered')

// -- hidden: true opts a mount back in ----------------------------------------
const whListing = await (await get('/wh/')).text()
assert.match(whListing, /\.env/, 'hidden: true lists dotfiles')
assert.equal((await get('/wh/.env')).status, 200, 'hidden: true serves dotfiles')
assert.match(await (await get('/wh/.env')).text(), /DB_PASSWORD/, 'and serves their contents')

// ---- files -------------------------------------------------------------------

const apkRes = await get('/apk/app-release.apk')
assert.equal(apkRes.status, 200)
assert.equal(
  apkRes.headers.get('content-type'),
  'application/vnd.android.package-archive',
  'APK gets the Android package type so a phone offers to install it',
)
assert.match(apkRes.headers.get('content-disposition') ?? '', /^attachment;/, 'APK downloads')
assert.equal(apkRes.headers.get('accept-ranges'), 'bytes')
const apkBody = Buffer.from(await apkRes.arrayBuffer())
assert.equal(apkBody.toString('utf8'), 'PK\u0003\u0004fake-apk-bytes', 'bytes are served verbatim')

// HTML must never render on this origin (it also serves token-guarded pages).
const htmlRes = await get('/apk/page.html')
assert.equal(htmlRes.status, 200)
assert.match(htmlRes.headers.get('content-disposition') ?? '', /^attachment;/, 'HTML is forced to download')
assert.match(htmlRes.headers.get('x-content-type-options') ?? '', /nosniff/)

// Text is safe to inline.
const txtRes = await get('/apk/notes.txt')
assert.match(txtRes.headers.get('content-disposition') ?? '', /^inline;/)
assert.equal(txtRes.headers.get('content-type'), 'text/plain; charset=utf-8')

// ---- HEAD / validators / ranges ---------------------------------------------

const headRes = await get('/apk/notes.txt', { method: 'HEAD' })
assert.equal(headRes.status, 200)
assert.equal(headRes.headers.get('content-length'), String(Buffer.byteLength('plain notes\n')))
assert.equal((await headRes.text()), '', 'HEAD sends no body')

const etag = txtRes.headers.get('etag')
assert.ok(etag !== null, 'files carry an ETag')
const cached = await get('/apk/notes.txt', { headers: { 'if-none-match': etag } })
assert.equal(cached.status, 304, 'a matching ETag short-circuits to 304')

const ranged = await get('/apk/sub/nested.bin', { headers: { range: 'bytes=10-19' } })
assert.equal(ranged.status, 206, 'a byte range answers 206')
assert.equal(ranged.headers.get('content-range'), 'bytes 10-19/4096')
assert.equal((await ranged.arrayBuffer()).byteLength, 10)

const suffix = await get('/apk/sub/nested.bin', { headers: { range: 'bytes=-8' } })
assert.equal(suffix.status, 206)
assert.equal(suffix.headers.get('content-range'), 'bytes 4088-4095/4096')

const badRange = await get('/apk/sub/nested.bin', { headers: { range: 'bytes=999999-' } })
assert.equal(badRange.status, 416, 'an unsatisfiable range answers 416')

// ---- containment -------------------------------------------------------------

// Plain traversal, percent-encoded traversal, and an encoded separator all 404.
for (const path of [
  '/apk/../../etc/passwd',
  '/apk/%2e%2e/%2e%2e/etc/passwd',
  '/apk/sub/%2e%2e/%2e%2e/etc/passwd',
  '/apk/sub%2f..%2f..%2fetc%2fpasswd',
  '/apk/..%5c..%5cwindows%5cwin.ini',
  '/apk/%00.txt',
]) {
  const res = await get(path)
  assert.equal(res.status, 404, `traversal must be refused: ${path}`)
}

// The symlink out of the mount is refused, and its content never leaks.
const escaped = await get('/apk/escape.txt')
assert.equal(escaped.status, 404, 'a symlink out of the mount is refused')
assert.doesNotMatch(await escaped.text(), /OUTSIDE-SECRET/)

// A dotfile is refused by name too, not merely omitted from the listing.
assert.equal((await get('/apk/.env')).status, 404, 'dotfiles are refused when hidden')

// A symlink that stays inside resolves normally.
const inner = await get('/apk/inner-link.bin')
assert.equal(inner.status, 200, 'an in-mount symlink resolves')
assert.equal(inner.headers.get('content-range'), null)

// ---- methods and tokens ------------------------------------------------------

assert.equal((await get('/apk/notes.txt', { method: 'POST' })).status, 405, 'only GET/HEAD are accepted')
assert.equal((await get('/apk/notes.txt', { method: 'DELETE' })).status, 405)

// A token-protected mount is invisible without its token...
assert.equal((await get('/priv/notes.txt')).status, 404, 'token mount refuses a bare path')
assert.equal((await get('/priv/wrong/notes.txt')).status, 404, 'token mount refuses a wrong token')
assert.equal((await get('/priv/')).status, 404, 'even the listing needs the token')
// ...and works with it.
const tokened = await get('/priv/s3cret/notes.txt')
assert.equal(tokened.status, 200, 'token mount serves with the right token')
assert.match(tokened.headers.get('content-disposition') ?? '', /^inline;/)
const tokenedListing = await get('/priv/s3cret/')
assert.equal(tokenedListing.status, 200)
assert.match(await tokenedListing.text(), /notes\.txt/)

// ---- request-target limits ---------------------------------------------------

// A path deeper than any real tree is refused with 414 (not 404): it is
// well-formed, just beyond the limit, and saying so is more useful.
const deep = '/apk/' + Array.from({ length: 200 }, () => 'd').join('/')
assert.equal((await get(deep)).status, 414, 'an over-deep path answers 414')

// A single segment longer than any filesystem name cannot exist on disk.
const longSegment = '/apk/' + 'x'.repeat(400)
assert.equal((await get(longSegment)).status, 414, 'an over-long segment answers 414')

// Just under the limits must still be handled (and 404 normally).
const okDepth = '/apk/' + Array.from({ length: 100 }, () => 'd').join('/')
assert.equal((await get(okDepth)).status, 404, 'a deep-but-allowed path is just a miss')

// An absurd URL is refused by the HTTP parser (431) before routing, and the
// server must stay healthy afterwards.
const huge = '/apk/' + 'y'.repeat(40000)
const hugeRes = await get(huge).catch(() => null)
assert.ok(hugeRes === null || hugeRes.status === 431, 'an oversized request target is refused')
assert.equal((await get('/apk/notes.txt')).status, 200, 'the server still serves after an oversized request')

// ---- the listing cap bounds the scan ----------------------------------------

const bigListing = await get('/big/')
assert.equal(bigListing.status, 200, 'a large directory still lists')
const bigHtml = await bigListing.text()
const rendered = (bigHtml.match(/class="file"/g) ?? []).length
assert.equal(rendered, 5000, 'the listing renders exactly the cap, not all 5010 entries')
assert.match(bigHtml, /目录条目过多|exceeds/, 'truncation is reported to the reader')

// ---- landing page and unknown mounts ----------------------------------------

const landing = await get('/')
assert.equal(landing.status, 200)
const landingHtml = await landing.text()
assert.match(landingHtml, /apk\//, 'the landing page lists open mounts')
assert.doesNotMatch(landingHtml, /s3cret/, 'the landing page never reveals a token')
assert.doesNotMatch(landingHtml, /priv/, 'token mounts are not advertised on the public landing page')

assert.equal((await get('/nope/')).status, 404, 'unknown mount names 404')
assert.equal((await get('/s/zzzz')).status, 404, 'the /s/ prefix is not a directory mount')

// ---- cleanup -----------------------------------------------------------------

for (const d of disposers.reverse()) await d?.()
await new Promise((resolve) => rpcServer.close(resolve))
await rm(tmpHome, { recursive: true, force: true })
await rm(outsideDir, { recursive: true, force: true })

console.log('✔ directory mount test passed (listing, files, APK type, ranges, ETag, traversal, symlink escape, hidden files, tokens, landing page)')
