#!/usr/bin/env node
/**
 * Vocabulary conformance test.
 *
 * The plugin's compatibility contract is the session RECORD FORMAT, and the
 * only part of it that can change without a format bump is the event
 * vocabulary. `src/host/transcript.ts` mirrors the harness's
 * `KNOWN_SESSION_EVENT_TYPES` in two sets:
 *
 *   RENDERED_EVENT_TYPES       — the four types this build renders
 *   KNOWN_IGNORED_EVENT_TYPES  — every other type of the same vocabulary
 *
 * An event type in NEITHER set would make the share page warn "较新的会话格式"
 * on an ordinary session — a false alarm on every single share, which is worse
 * than never warning at all.
 *
 * A harness release may ADD event types without bumping the format version
 * (0.2.0-rc.2 had 59, 0.2.1-rc.2 has 62 — both format v4). The plugin must
 * therefore recognise the union of every vocabulary it has ever supported: a
 * share created on an older harness still has to be readable on a newer one.
 *
 * So the check is:
 *   1. our set must be a SUPERSET of every known vocabulary (no false alarm),
 *   2. our set must not contain types no harness ever had (a typo would hide a
 *      real incompatibility),
 *   3. the format version we declare must match the harness's.
 *
 * The reference vocabularies below are transcribed from the harness's
 * `KNOWN_SESSION_EVENT_TYPES` — 0.2.0-rc.2 (59) and 0.2.1-rc.2 (62). When a
 * harness release adds a type, add it to the newest reference here AND to
 * `KNOWN_IGNORED_EVENT_TYPES`; the test then fails until both agree.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const SOURCE = fileURLToPath(new URL('../src/host/transcript.ts', import.meta.url))
const PKG = fileURLToPath(new URL('../package.json', import.meta.url))

/** Parse a Set literal out of the source (no TS runtime needed). */
function parseSet (source, name) {
  const match = new RegExp(`${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(source)
  assert.ok(match !== null, `could not find ${name} in src/host/transcript.ts`)
  return new Set([...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]))
}

/** The harness vocabularies this build supports, newest last. */
const KNOWN_VOCABULARIES = [
  {
    harness: '0.2.0-rc.2',
    formatVersion: 4,
    types: [
      'agent-preset/selected', 'agent/inbox/spliced', 'approval/asked', 'approval/decided',
      'approval/policy', 'assistant/attempt', 'assistant/message', 'command/done',
      'command/run', 'compaction/end', 'compaction/prune', 'compaction/start',
      'compaction/summary', 'deliverables/presented', 'developer/message', 'feedback/message-delete',
      'feedback/message-put', 'feedback/record', 'goal/change', 'hook/invoked',
      'hook/result', 'image/offload', 'llm/retry', 'llm/retry-started',
      'model/selection', 'permission/preset', 'plan/mode', 'request/context',
      'request/header', 'sandbox/mode', 'schedule/change', 'session-log-deepseek/delivery-accepted',
      'session/end-seed', 'session/title', 'session/title-llm-request', 'step/end',
      'step/start', 'subagent/catalog', 'subagent/descriptor', 'subagent/model-selection-policy',
      'system/message', 'team/member', 'team/message/delivered', 'team/message/queued',
      'team/task', 'todo/write', 'tool-workflow/agent-end', 'tool-workflow/agent-start',
      'tool-workflow/run-end', 'tool-workflow/run-start', 'tool/call',
      'tool/ptc-dispatch', 'tool/ptc-dispatch-start', 'tool/result',
      'turn/end', 'turn/start', 'user/message', 'web/deepseek-search-llm-request',
      'workspace/changes',
    ],
  },
  {
    harness: '0.2.1-rc.2',
    formatVersion: 4,
    types: [
      'agent-preset/selected', 'agent/inbox/spliced', 'approval/asked', 'approval/decided',
      'approval/policy', 'assistant/attempt', 'assistant/message', 'command/done',
      'command/run', 'compaction/end', 'compaction/prune', 'compaction/start',
      'compaction/summary', 'deliverables/presented', 'developer/message', 'feedback/message-delete',
      'feedback/message-put', 'feedback/record', 'goal/change', 'hook/invoked',
      'hook/result', 'image/offload', 'job/registered', 'job/settled',
      'llm/retry', 'llm/retry-started', 'model/selection', 'permission/preset',
      'plan/mode', 'request/context', 'request/header', 'sandbox/mode',
      'schedule/change', 'session-log-deepseek/delivery-accepted', 'session/end-seed', 'session/title',
      'session/title-llm-request', 'step/end', 'step/start', 'subagent/catalog',
      'subagent/descriptor', 'subagent/model-selection-policy', 'system/message', 'team/member',
      'team/message/delivered', 'team/message/queued', 'team/task', 'todo/write',
      'tool-workflow/agent-end', 'tool-workflow/agent-start', 'tool-workflow/run-end', 'tool-workflow/run-start',
      'tool/call', 'tool/ptc-dispatch', 'tool/ptc-dispatch-start', 'tool/result',
      'turn/end', 'turn/start', 'user/message', 'web/deepseek-search-llm-request',
      'working-directory/change', 'workspace/changes',
    ],
  },
]

const source = await readFile(SOURCE, 'utf8')
const pkg = JSON.parse(await readFile(PKG, 'utf8'))
const rendered = parseSet(source, 'RENDERED_EVENT_TYPES')
const ignored = parseSet(source, 'KNOWN_IGNORED_EVENT_TYPES')

// The two sets must not overlap: a type cannot be both rendered and ignored.
for (const type of rendered) {
  assert.ok(!ignored.has(type), `'${type}' is in both RENDERED and IGNORED sets`)
}

const ours = new Set([...rendered, ...ignored])

// 1. Every known vocabulary must be fully covered — otherwise an event type
//    the harness writes raises the false "newer session format" banner.
for (const { harness, types } of KNOWN_VOCABULARIES) {
  const missing = types.filter((t) => !ours.has(t))
  assert.equal(
    missing.length,
    0,
    `harness ${harness} writes ${missing.length} event type(s) this build does not know — they would raise ` +
    `the false "newer session format" banner on every share: ${missing.join(', ')}`,
  )
}

// 2. Nothing we list may be a type no harness ever had: a typo there would
//    hide a genuine incompatibility instead of reporting it.
const knownEverywhere = new Set(KNOWN_VOCABULARIES.flatMap((v) => v.types))
const invented = [...ours].filter((t) => !knownEverywhere.has(t))
assert.equal(
  invented.length,
  0,
  `this build lists ${invented.length} event type(s) no known harness vocabulary contains (a typo would ` +
  `mask a real incompatibility): ${invented.join(', ')}`,
)

// 3. The rendered types must exist in every known vocabulary — a rendered type
//    that a harness does not define would never fire, silently.
for (const { harness, types } of KNOWN_VOCABULARIES) {
  const absent = [...rendered].filter((t) => !types.includes(t))
  assert.equal(
    absent.length,
    0,
    `this build renders ${absent.length} event type(s) that harness ${harness} does not define: ${absent.join(', ')}`,
  )
}

// 4. The declared format version must be one the harnesses actually use.
const declared = pkg.dsh?.sessionFormat
assert.ok(
  Number.isInteger(declared),
  'package.json must declare dsh.sessionFormat (the session record format this build renders)',
)
for (const { harness, formatVersion } of KNOWN_VOCABULARIES) {
  assert.equal(
    declared,
    formatVersion,
    `package.json declares dsh.sessionFormat=${declared} but harness ${harness} uses format ${formatVersion}`,
  )
}

console.log(
  `✔ vocabulary conformance test passed (format v${declared}, ` +
  `${ours.size} event types = ${rendered.size} rendered + ${ignored.size} ignored, ` +
  `${KNOWN_VOCABULARIES.length} harness generations covered)`,
)
