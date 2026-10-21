/**
 * MountsCard — the plugin's settings card on the Plugins page.
 *
 * Registered into `plugins.row.config` keyed `<package name>#<row id>` (see
 * `../index.ts`), which is what gives the `dsh-share-plus` row a **Configure**
 * control. The page supplies the frame, so this component renders only the
 * form body, plus a one-line `summary` used as the row's description fallback.
 *
 * The field list is dynamic (the user adds and removes directories), so this
 * drives the config scope directly instead of going through the generic field
 * model: subscribe for read-back, stage edits locally, then commit ONE fenced
 * mutation of the whole `mounts` array. A refused revision keeps the draft.
 *
 * Live status (serving / invalid + why, and the URL to copy) comes from the
 * Host's `mounts` RPC, which is also what starts the share server — so a mount
 * added here becomes reachable without restarting anything.
 */

import type * as ReactNS from 'react'
import type { MountView, MountsResult } from '../../shared/types'
import type { ClientCtx, ConfigFormScope, ConfigFormSnapshot } from '../services'
import type { Translate } from '../i18n'
import { React, h } from '../react'

/** The loader entry id — the settings namespace is always the row id. */
const ENTRY_ID = 'dsh-share-plus'

/** One staged row of the editor. */
interface MountRow {
  name: string
  path: string
  token: string
  index: boolean
  hidden: boolean
}

type Draft = { rows: MountRow[]; technical: boolean; domain: string; revision: number | undefined }

function emptyRow(): MountRow {
  return { name: '', path: '', token: '', index: true, hidden: false }
}

/** Read the saved rows out of a config snapshot, tolerating any missing field. */
function rowsFromSnapshot(snapshot: ConfigFormSnapshot | null): MountRow[] {
  const value = snapshot?.value
  if (value === null || typeof value !== 'object') return []
  const raw = (value as { mounts?: unknown }).mounts
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>
    return {
      name: typeof row.name === 'string' ? row.name : '',
      path: typeof row.path === 'string' ? row.path : '',
      token: typeof row.token === 'string' ? row.token : '',
      index: row.index !== false,
      hidden: row.hidden === true,
    }
  })
}

/** Read the saved `technicalInfo` flag out of a config snapshot. */
function technicalFromSnapshot(snapshot: ConfigFormSnapshot | null): boolean {
  const value = snapshot?.value
  if (value === null || typeof value !== 'object') return false
  return (value as { technicalInfo?: unknown }).technicalInfo === true
}

/** Read the saved public domain out of a config snapshot. */
function domainFromSnapshot(snapshot: ConfigFormSnapshot | null): string {
  const value = snapshot?.value
  if (value === null || typeof value !== 'object') return ''
  const raw = (value as { publicDomain?: unknown }).publicDomain
  return typeof raw === 'string' ? raw : ''
}

/** Normalise a staged row to exactly the schema's field types. */
function serialiseRow(row: MountRow): MountRow {
  return {
    name: row.name.trim(),
    path: row.path.trim(),
    token: row.token,
    index: row.index,
    hidden: row.hidden,
  }
}

function sameRows(a: readonly MountRow[], b: readonly MountRow[]): boolean {
  if (a.length !== b.length) return false
  return a.every((row, i) => {
    const other = b[i]!
    return (
      row.name === other.name &&
      row.path === other.path &&
      row.token === other.token &&
      row.index === other.index &&
      row.hidden === other.hidden
    )
  })
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(text)
      return true
    }
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export function makeMountsCard(
  ctx: ClientCtx,
  t: Translate,
): (props: { view?: string }) => ReactNS.ReactElement | null {
  return function MountsCard(props: { view?: string }): ReactNS.ReactElement | null {
    const scope: ConfigFormScope | null = React.useMemo(() => {
      try {
        return ctx.configForms.get(ENTRY_ID)
      } catch {
        return null
      }
    }, [])

    const [snapshot, setSnapshot] = React.useState<ConfigFormSnapshot | null>(() => {
      try {
        return scope?.getSnapshot() ?? null
      } catch {
        return null
      }
    })
    const [draft, setDraft] = React.useState<Draft | null>(null)
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const [status, setStatus] = React.useState<MountsResult | null>(null)
    const [statusError, setStatusError] = React.useState<string | null>(null)
    const [copied, setCopied] = React.useState<string | null>(null)

    React.useEffect(() => {
      if (scope === null) return
      const read = (): void => {
        try {
          setSnapshot(scope.getSnapshot())
        } catch {
          /* keep the last good snapshot */
        }
      }
      read()
      return scope.subscribe(read)
    }, [scope])

    const refreshStatus = React.useCallback(() => {
      ctx.connection.rpc
        .call('/dsh-share-plus', 'mounts', {})
        .then((res) => {
          if (res !== null && typeof res === 'object' && res.ok) {
            setStatus(res.value as MountsResult)
            setStatusError(null)
          } else if (res !== null && typeof res === 'object' && !res.ok) {
            setStatusError(res.error?.message ?? 'failed')
          }
        })
        .catch((err: unknown) => {
          setStatusError(err instanceof Error ? err.message : String(err))
        })
    }, [])

    React.useEffect(() => {
      refreshStatus()
    }, [refreshStatus])

    // A compact one-liner for the row's missing-description fallback.
    if (props.view === 'summary') {
      return h('span', null, t('cardSummary'))
    }

    const saved = rowsFromSnapshot(snapshot)
    const savedTechnical = technicalFromSnapshot(snapshot)
    const savedDomain = domainFromSnapshot(snapshot)
    const rows = draft?.rows ?? saved
    const technical = draft?.technical ?? savedTechnical
    const domain = draft?.domain ?? savedDomain
    const dirty = draft !== null && (!sameRows(draft.rows, saved) || draft.technical !== savedTechnical || draft.domain !== savedDomain)
    const writable = snapshot?.writable !== false

    const edit = (mutateRows: (next: MountRow[]) => void): void => {
      setDraft((current) => {
        const base = current ?? { rows: saved, technical: savedTechnical, domain: savedDomain, revision: snapshot?.revision }
        const next = base.rows.map((row) => ({ ...row }))
        mutateRows(next)
        return { rows: next, technical: base.technical, domain: base.domain, revision: base.revision }
      })
    }

    const setField = (at: number, field: keyof MountRow, value: string | boolean): void => {
      edit((next) => {
        const row = next[at]
        if (row === undefined) return
        if (field === 'name' || field === 'path' || field === 'token') row[field] = String(value)
        else if (field === 'index') row.index = value === true
        else if (field === 'hidden') row.hidden = value === true
      })
    }

    const save = async (): Promise<void> => {
      if (scope === null || draft === null || busy) return
      setBusy(true)
      setError(null)
      const commit = draft.rows.map(serialiseRow)
      const commitTechnical = draft.technical
      const commitDomain = draft.domain.trim()
      try {
        const ops = [
          { op: 'set', path: ['mounts'], value: commit },
          // A real boolean, not text: the write seam re-validates types and
          // refuses a string for a boolean field without saying why in the UI.
          { op: 'set', path: ['technicalInfo'], value: commitTechnical },
          { op: 'set', path: ['publicDomain'], value: commitDomain },
        ]
        const landed = await scope.mutate(ops, draft.revision)
        // Confirm against the read-back rather than trusting the return value:
        // a refused revision and a successful write are both silent in the UI.
        const after = scope.getSnapshot()
        setSnapshot(after)
        if (landed === false || !sameRows(commit, rowsFromSnapshot(after)) || technicalFromSnapshot(after) !== commitTechnical || domainFromSnapshot(after) !== commitDomain) {
          setError(t('saveFailed'))
        } else {
          setDraft(null)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
        refreshStatus()
      }
    }

    const statusFor = (name: string): MountView | undefined =>
      status?.mounts.find((m) => m.name === name)

    const setTechnical = (next: boolean): void => {
      setDraft((current) => {
        const base = current ?? { rows: saved, technical: savedTechnical, domain: savedDomain, revision: snapshot?.revision }
        return { rows: base.rows.map((row) => ({ ...row })), technical: next, domain: base.domain, revision: base.revision }
      })
    }

    const setDomain = (next: string): void => {
      setDraft((current) => {
        const base = current ?? { rows: saved, technical: savedTechnical, domain: savedDomain, revision: snapshot?.revision }
        return { rows: base.rows.map((row) => ({ ...row })), technical: base.technical, domain: next, revision: base.revision }
      })
    }

    // Section 1: General sharing configuration
    const generalSection = h('section', { key: 'sec-general', className: 'dshshare-settings-section' },
      h('h4', { className: 'dshshare-settings-section-title' }, t('settings.sectionGeneral')),
      h('div', { className: 'dshshare-setting-row' },
        h('label', { className: 'dshshare-card-toggle', title: t('cardTechnicalHint') },
          h('input', {
            id: 'dshshare-card-technical',
            type: 'checkbox',
            checked: technical,
            onChange: (e: ReactNS.ChangeEvent<HTMLInputElement>) => setTechnical(e.currentTarget.checked),
          }),
          h('span', null, t('cardTechnical')),
        ),
        h('p', { className: 'dshshare-card-hint' }, t('cardTechnicalHint')),
      ),
      h('div', { className: 'dshshare-setting-row' },
        h('label', { className: 'dshshare-card-domain', title: t('cardDomainHint') },
          h('span', null, t('cardDomain')),
          h('input', {
            id: 'dshshare-card-domain',
            type: 'text',
            className: 'dshshare-input dshshare-domain-input',
            value: domain,
            placeholder: t('cardDomainPlaceholder'),
            'aria-label': t('cardDomain'),
            onInput: (e: ReactNS.FormEvent<HTMLInputElement>) => setDomain((e.target as HTMLInputElement).value),
          }),
        ),
        h('p', { className: 'dshshare-card-hint' }, t('cardDomainHint')),
      ),
    )

    // Section 2: Directory mounts
    const mountItems: ReactNS.ReactNode[] = []
    if (rows.length === 0) {
      mountItems.push(
        h('p', { key: 'empty', className: 'dshshare-mounts-empty' }, t('settings.mountsEmpty')),
      )
    } else {
      rows.forEach((row, at) => {
        const live = statusFor(row.name.trim())
        const isServing = live?.status === 'serving'

        const statusBadge = live !== undefined
          ? h('span', {
              className: `dshshare-mount-badge ${isServing ? 'serving' : 'invalid'}`,
            }, isServing ? t('settings.statusServing') : t('cardNotServing'))
          : null

        const cardHeader = h('div', { className: 'dshshare-mount-header' },
          h('div', { className: 'dshshare-mount-title-row' },
            h('strong', null, t('settings.mountHeader', { n: at + 1 })),
            statusBadge,
          ),
          h('button', {
            type: 'button',
            className: 'dshshare-btn-danger',
            'aria-label': t('cardRemove'),
            onClick: () => edit((next) => { next.splice(at, 1) }),
          }, t('cardRemove')),
        )

        const fieldsGrid = h('div', { className: 'dshshare-mount-grid' },
          h('div', { className: 'dshshare-mount-field-group' },
            h('label', null, t('cardName')),
            h('input', {
              className: 'dshshare-input dshshare-mount-name',
              value: row.name,
              placeholder: t('cardNamePlaceholder'),
              'aria-label': t('cardName'),
              onInput: (e: ReactNS.FormEvent<HTMLInputElement>) => setField(at, 'name', (e.target as HTMLInputElement).value),
            }),
          ),
          h('div', { className: 'dshshare-mount-field-group' },
            h('label', null, t('cardPath')),
            h('input', {
              className: 'dshshare-input dshshare-mount-path',
              value: row.path,
              placeholder: t('cardPathPlaceholder'),
              'aria-label': t('cardPath'),
              onInput: (e: ReactNS.FormEvent<HTMLInputElement>) => setField(at, 'path', (e.target as HTMLInputElement).value),
            }),
          ),
          h('div', { className: 'dshshare-mount-field-group' },
            h('label', null, t('cardToken')),
            h('input', {
              className: 'dshshare-input dshshare-mount-token',
              value: row.token,
              placeholder: t('cardTokenPlaceholder'),
              'aria-label': t('cardToken'),
              onInput: (e: ReactNS.FormEvent<HTMLInputElement>) => setField(at, 'token', (e.target as HTMLInputElement).value),
            }),
          ),
        )

        const flagsRow = h('div', { className: 'dshshare-mount-options' },
          h('label', { className: 'dshshare-mount-flag', title: t('cardIndexHint') },
            h('input', {
              type: 'checkbox',
              checked: row.index,
              onChange: (e: ReactNS.ChangeEvent<HTMLInputElement>) => setField(at, 'index', e.target.checked),
            }),
            h('span', null, t('cardIndex')),
          ),
          h('label', { className: 'dshshare-mount-flag', title: t('cardHiddenHint') },
            h('input', {
              type: 'checkbox',
              checked: row.hidden,
              onChange: (e: ReactNS.ChangeEvent<HTMLInputElement>) => setField(at, 'hidden', e.target.checked),
            }),
            h('span', null, t('cardHidden')),
          ),
        )

        const notes: ReactNS.ReactNode[] = []
        if (live !== undefined) {
          if (live.status === 'serving') {
            const urls = live.urls.filter((u): u is string => typeof u === 'string' && u.length > 0)
            if (urls.length > 0) {
              notes.push(
                h('div', { key: `urls-${at}`, className: 'dshshare-mount-urls-card' },
                  ...urls.map((url, uIdx) =>
                    h('div', { key: `url-${uIdx}`, className: 'dshshare-mount-url' },
                      h('code', null, url),
                      h('button', {
                        type: 'button',
                        className: 'dshshare-link',
                        onClick: () => {
                          void copyText(url).then((ok) => setCopied(ok ? url : null))
                        },
                      }, copied === url ? t('cardCopied') : t('cardCopy')),
                    ),
                  ),
                ),
              )
            }
          } else {
            notes.push(
              h('div', { key: 'bad', className: 'dshshare-card-error' },
                `${t('cardNotServing')}${live.reason === undefined ? '' : `：${live.reason}`}`),
            )
          }
        }

        mountItems.push(
          h('div', { key: `row-${at}`, className: 'dshshare-mount-card dshshare-mount' },
            cardHeader,
            fieldsGrid,
            flagsRow,
            ...notes,
          ),
        )
      })
    }

    const mountsSection = h('section', { key: 'sec-mounts', className: 'dshshare-settings-section' },
      h('div', { className: 'dshshare-settings-section-title' },
        h('span', null, t('settings.sectionMounts')),
        h('button', {
          type: 'button',
          className: 'dshshare-link dshshare-btn-add',
          onClick: () => edit((next) => { next.push(emptyRow()) }),
        }, `+ ${t('cardAdd')}`),
      ),
      h('p', { className: 'dshshare-card-hint' }, t('cardHint')),
      ...mountItems,
    )

    const actionsBar = h('div', { key: 'actions', className: 'dshshare-card-actions' },
      h('div', { className: 'dshshare-actions-left' },
        h('button', {
          type: 'button',
          className: 'dshshare-link dshshare-btn-add',
          onClick: () => edit((next) => { next.push(emptyRow()) }),
        }, `+ ${t('cardAdd')}`),
        h('button', {
          type: 'button',
          className: 'dshshare-primary',
          disabled: !dirty || busy || !writable,
          onClick: () => { void save() },
        }, busy ? t('cardSaving') : t('cardSave')),
        dirty
          ? h('button', {
              type: 'button',
              className: 'dshshare-link',
              onClick: () => { setDraft(null); setError(null) },
            }, t('cardDiscard'))
          : null,
      ),
      h('div', { className: 'dshshare-actions-right' },
        h('p', { className: 'dshshare-card-note' }, t('cardReadOnlyNote')),
      ),
    )

    const body: ReactNS.ReactNode[] = [generalSection, mountsSection]

    if (scope === null) {
      body.unshift(h('p', { key: 'noservice', className: 'dshshare-card-error' }, t('cardUnavailable')))
    }
    if (error !== null) {
      body.push(h('p', { key: 'err', className: 'dshshare-card-error' }, error))
    }
    if (statusError !== null) {
      body.push(h('p', { key: 'serr', className: 'dshshare-card-error' }, statusError))
    }
    body.push(actionsBar)

    return h('div', { className: 'dshshare-settings-view dshshare-card', 'data-plugin-config': 'dsh-share-plus' }, ...body)
  }
}
