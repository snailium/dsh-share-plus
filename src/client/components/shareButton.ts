/**
 * ShareButton — the session-header share control and its dialog.
 *
 * Registered into `conversation.session.header.utilities` (beside the official
 * "Session log" export action). It drives the Host `/dsh-share-plus` RPC to create,
 * list, and revoke read-only LAN snapshots.
 */

import type * as ReactNS from 'react'
import type { ShareInfo } from '../../shared/types'
import type { ClientCtx } from '../services'
import type { Translate } from '../i18n'
import { React, h } from '../react'

/** Clipboard write with an http-LAN fallback (clipboard API needs a secure context). */
function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText !== undefined) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => legacyCopy(text))
  }
  return Promise.resolve(legacyCopy(text))
}

function legacyCopy(text: string): boolean {
  try {
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

const EXPIRIES: { key: string; sec?: number }[] = [
  { key: 'never' },
  { key: '1h', sec: 3600 },
  { key: '24h', sec: 86400 },
  { key: '7d', sec: 604800 },
]

function isLan(ip: string): boolean {
  return !ip.startsWith('127.') && ip !== 'localhost'
}

interface ShareButtonProps { sessionId?: string }

export function makeShareButton(ctx: ClientCtx, t: Translate): (props: ShareButtonProps) => ReactNS.ReactElement {
  return function ShareButton(props: ShareButtonProps): ReactNS.ReactElement {
    const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
    const [open, setOpen] = React.useState(false)
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const [expiry, setExpiry] = React.useState<string>('never')
    const [redact, setRedact] = React.useState<boolean>(true)
    // Technical output is OFF by default: an agentic transcript is mostly tool
    // chatter, and a share is meant to be read.
    const [technical, setTechnical] = React.useState<boolean>(false)
    const [shares, setShares] = React.useState<ShareInfo[]>([])
    const [created, setCreated] = React.useState<ShareInfo | null>(null)
    const [copied, setCopied] = React.useState<string | null>(null)

    const rpc = async <T,>(endpoint: string, payload: unknown): Promise<T> => {
      const res = await ctx.connection.rpc.call('/dsh-share-plus', endpoint, payload)
      if (res === null || typeof res !== 'object') throw new Error('no response')
      if (res.ok) return res.value as T
      throw new Error(res.error?.message ?? res.error?.code ?? 'failed')
    }

    const refresh = React.useCallback(() => {
      if (sessionId === '') return
      rpc<{ shares: ShareInfo[] }>('list', {}).then((r) => {
        setShares(r.shares.filter((s) => s.sessionId === sessionId))
      }).catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
    }, [sessionId])

    // Seed the toggles from the configured defaults once the dialog opens, so
    // the checkboxes show what will actually happen rather than a fixed guess.
    React.useEffect(() => {
      if (!open) return
      rpc<{ technical: boolean; redact: boolean }>('defaults', {}).then((d) => {
        setTechnical(d.technical)
        setRedact(d.redact)
      }).catch(() => { /* keep the built-in defaults */ })
    }, [open])

    React.useEffect(() => {
      if (open && sessionId !== '') refresh()
    }, [open, sessionId, refresh])

    const openDialog = () => { setCreated(null); setError(null); setOpen(true) }

    const generate = () => {
      if (sessionId === '' || busy) return
      setBusy(true)
      setError(null)
      const sec = EXPIRIES.find((e) => e.key === expiry)?.sec
      rpc<{ share: ShareInfo }>('create', { sessionId, expiresInSec: sec, redact: { enabled: redact }, technical })
        .then((r) => {
          setCreated(r.share)
          refresh()
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setBusy(false))
    }

    const revoke = (token: string) => {
      rpc<{ removed: boolean }>('revoke', { token })
        .then(() => {
          if (created?.token === token) setCreated(null)
          refresh()
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
    }

    const doCopy = (text: string, key: string) => {
      void copyText(text).then((ok) => {
        if (ok) { setCopied(key); window.setTimeout(() => setCopied(null), 1500) }
      })
    }

    const urlRow = (share: ShareInfo) => {
      const urls = share.urls && share.urls.length > 0 ? share.urls : [share.url]
      return h('div', null, urls.map((u, i) => {
        const host = u.replace(/^https?:\/\//, '').split('/')[0].split(':')[0]
        // A domain that is not an IP address is the configured public one.
        const tag = host.includes('.') && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)
          ? t('dialog.internet')
          : isLan(host) ? t('dialog.lan') : t('dialog.loopback')
        const key = `${share.token}-${i}`
        return h('div', { className: 'dshshare-url', key },
          h('span', { className: 'tag' }, tag),
          h('input', { type: 'text', readOnly: true, value: u, onFocus: (e: ReactNS.FocusEvent<HTMLInputElement>) => e.currentTarget.select() }),
          h('button', { className: 'dshshare-ghost', onClick: () => doCopy(u, key) }, copied === key ? t('dialog.copied') : t('dialog.copy')),
          h('button', { className: 'dshshare-ghost', onClick: () => { window.open(u, '_blank', 'noopener') } }, t('dialog.open')),
        )
      }))
    }

    const shareItem = (share: ShareInfo) => {
      const sub = share.expiresAt !== undefined
        ? `${new Date(share.expiresAt).toLocaleString()} 到期`
        : '长期有效'
      return h('div', { className: 'dshshare-item', key: share.token },
        h('div', { className: 'info' },
          h('div', { className: 'title', title: share.title }, share.title),
          h('div', { className: 'sub' }, sub)),
        // The primary URL is the public one when a domain is configured —
        // copy that by default, not the LAN fallback.
        h('button', { className: 'dshshare-ghost', onClick: () => doCopy(share.url, share.token) }, copied === share.token ? t('dialog.copied') : t('dialog.copy')),
        h('button', { className: 'dshshare-ghost', onClick: () => revoke(share.token) }, t('dialog.revoke')),
      )
    }

    const dialog = open ? h('div', { className: 'dshshare-overlay' },
      h('div', { className: 'dshshare-mask', onClick: () => setOpen(false) }),
      h('div', { className: 'dshshare-card' },
        h('button', { className: 'dshshare-close', onClick: () => setOpen(false) }, '×'),
        h('h3', null, t('dialog.title')),
        h('div', { className: 'dshshare-row' },
          h('span', null, t('dialog.expiry') + '：'),
          h('div', { className: 'dshshare-expiry' },
            EXPIRIES.map((e) => h('button', {
              key: e.key,
              className: 'dshshare-seg' + (expiry === e.key ? ' dshshare-seg-on' : ''),
              onClick: () => setExpiry(e.key),
            }, t('dialog.expiry.' + e.key))))),
        h('div', { className: 'dshshare-row dshshare-redact' },
          h('input', {
            id: 'dshshare-redact',
            type: 'checkbox',
            checked: redact,
            onChange: (e: ReactNS.ChangeEvent<HTMLInputElement>) => setRedact(e.currentTarget.checked),
          }),
          h('label', { htmlFor: 'dshshare-redact' }, t('dialog.redact'))),
        h('div', { className: 'dshshare-row dshshare-opt' },
          h('input', {
            id: 'dshshare-technical',
            type: 'checkbox',
            checked: technical,
            onChange: (e: ReactNS.ChangeEvent<HTMLInputElement>) => setTechnical(e.currentTarget.checked),
          }),
          h('label', { htmlFor: 'dshshare-technical' }, t('dialog.technical'))),
        h('div', { className: 'dshshare-row' },
          h('button', { className: 'dshshare-primary', disabled: busy || sessionId === '', onClick: generate }, busy ? t('dialog.genBusy') : t('dialog.gen'))),
        created !== null ? h('div', null,
          h('h4', null, t('dialog.urlHint')),
          created.redactedCount !== undefined
            ? h('div', { className: 'dshshare-redact-note' },
              created.redactedCount > 0
                ? t('dialog.redactedCount', { n: created.redactedCount })
                : t('dialog.redactedNone'))
            : null,
          urlRow(created)) : null,
        h('h4', null, t('dialog.existing')),
        shares.length === 0
          ? h('div', { className: 'dshshare-item' }, h('div', { className: 'info' }, h('div', { className: 'sub' }, t('dialog.none'))))
          : h('div', null, shares.map(shareItem)),
        error !== null ? h('div', { className: 'dshshare-err' }, error) : null,
      )) : null

    return h(React.Fragment, null,
      h('button', { type: 'button', className: 'dshshare-btn', onClick: openDialog }, t('button')),
      dialog)
  }
}
