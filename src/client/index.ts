/**
 * dsh-share — Client half (installed package bundle entry).
 *
 * Registers a "分享/Share" button in the session header's utility row
 * (`conversation.session.header.utilities`, beside the official Session-log
 * export action) and renders the share dialog. Data flows over the generic
 * Connection RPC channel `/dsh-share` served by the Host half.
 */

import { DICT_EN, DICT_ZH } from './i18n'
import type { ClientCtx } from './services'
import { STYLES } from './styles'
import { makeShareButton } from './components/shareButton'

import { React, h } from './react'

function apply(ctx: ClientCtx): void {
  ctx.effect(() => {
    return ctx.locale.register('dsh-share', { zh: DICT_ZH, en: DICT_EN })
  }, 'dsh-share: dictionaries')
  const t = ctx.locale.bind('dsh-share')

  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.setAttribute('data-plugin', 'dsh-share')
    tag.textContent = STYLES
    document.head.appendChild(tag)
    return () => {
      if (tag.parentNode !== null) tag.parentNode.removeChild(tag)
    }
  }, 'dsh-share: styles')

  const ShareButton = makeShareButton(ctx, t)
  ctx.slots.inject('conversation.session.header.utilities', () => {
    return ctx.slots.register(
      { name: 'conversation.session.header.utilities', id: 'session-share', order: 10, label: () => t('button') },
      props => h(ShareButton, props),
    )
  })
}

module.exports = {
  name: 'dsh-share',
  inject: ['connection', 'slots', 'locale'],
  apply,
}
