import React from 'react'

import { PresetLibrary } from './PresetLibrary.jsx'
import { IconLibrary } from './icons.jsx'
import { en, LOCALE_NS, zh } from './locales.js'
import { installLibraryNavIcon } from './nav-icon.js'
import styles from './styles.css'

export const inject = ['slots', 'locale', 'remote', 'remote.agentPresets', 'remote.settings', 'remote.pluginInventory', 'remote.pluginManager']

export function apply(ctx) {
  const previous = document.querySelector('style[data-plugin="dsh-preset-library"]')
  previous?.remove()
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-preset-library'
  style.textContent = styles
  document.head.appendChild(style)

  ctx.effect(() => () => style.remove(), 'preset-library: styles')
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'preset-library: dictionaries')
  const t = ctx.locale.bind(LOCALE_NS)
  ctx.effect(() => installLibraryNavIcon(document, () => t('nav'), IconLibrary), 'preset-library: nav icon')
  const api = ctx.remote
  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'preset-library',
    order: 21,
    label: () => t('nav'),
    locale: LOCALE_NS,
  }, ({ t: translate }) => <PresetLibrary api={api} t={translate} />)), 'preset-library: settings page')
}
