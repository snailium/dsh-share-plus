/**
 * dsh-share-plus — Client half (installed package bundle entry).
 *
 * Registers two things:
 *   - a "分享/Share" button in the session header's utility row
 *     (`conversation.session.header.utilities`, beside the official Session-log
 *     export action), with its dialog; and
 *   - the plugin's settings card on the Plugins page, which manages the
 *     read-only directory mounts.
 *
 * Both halves talk to the Host over the generic Connection RPC channel
 * `/dsh-share-plus`.
 */

import { DICT_EN, DICT_ZH } from './i18n'
import type { ClientCtx } from './services'
import { STYLES } from './styles'
import { makeShareButton } from './components/shareButton'
import { makeMountsCard } from './components/settingsCard'

import { React, h } from './react'

/** Loader entry id — also the settings namespace and the row id. */
const ENTRY_ID = 'dsh-share-plus'
/** Package name, used only to key the row's config slot. */
const PACKAGE = 'dsh-share-plus'

function apply(ctx: ClientCtx): void {
  ctx.effect(() => {
    return ctx.locale.register('dsh-share-plus', { zh: DICT_ZH, en: DICT_EN })
  }, 'dsh-share-plus: dictionaries')
  const t = ctx.locale.bind('dsh-share-plus')

  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.setAttribute('data-plugin', 'dsh-share-plus')
    tag.textContent = STYLES
    document.head.appendChild(tag)
    return () => {
      if (tag.parentNode !== null) tag.parentNode.removeChild(tag)
    }
  }, 'dsh-share-plus: styles')

  const ShareButton = makeShareButton(ctx, t)
  ctx.slots.inject('conversation.session.header.utilities', () => {
    return ctx.slots.register(
      { name: 'conversation.session.header.utilities', id: 'session-share', order: 10, label: () => t('button') },
      props => h(ShareButton, props as { sessionId?: string }),
    )
  })

  // The settings card. `plugins.row.config` keyed `<package>#<row id>` is the
  // slot a third-party bundle uses for its own row, and the exact key is what
  // makes the row grow a "Configure" control — a wrong key fails silently, so
  // the test suite pins both literals against package.json and the patch.
  const MountsCard = makeMountsCard(ctx, t)
  ctx.effect(() => {
    ctx.configForms.whileServed([ENTRY_ID], () =>
      ctx.slots.inject('plugins.row.config', () =>
        ctx.slots.register(
          { name: 'plugins.row.config', key: `${PACKAGE}#${ENTRY_ID}`, locale: 'dsh-share-plus' },
          props => h(MountsCard, props as { view?: string }),
        ),
      ),
    )
    return () => {}
  }, 'dsh-share-plus: settings card')
}

export default {
  name: 'dsh-share-plus',
  inject: ['connection', 'slots', 'locale', 'configForms'],
  apply,
}
