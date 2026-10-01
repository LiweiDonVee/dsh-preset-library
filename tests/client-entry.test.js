import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'

async function loadIcons() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/client/icons.jsx', import.meta.url))],
    bundle: true, write: false, format: 'cjs', platform: 'browser',
    jsx: 'automatic', packages: 'external',
  })
  const module = { exports: {} }
  runInNewContext(result.outputFiles[0].text, {
    module, exports: module.exports,
    require: id => {
      if (id === 'react') return {}
      if (id === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
      if (id === '@deepseek-ai/dsh-client-ui-primitives') {
        // This is the archive-icon export set from the official 0.2.0-rc.2 package.
        const exports = {}
        for (const name of [
          'IconArchiveOutlineRegular', 'IconBranchOutlineRegular', 'IconCheckOutlineRegular',
          'IconChevronDownOutlineRegular', 'IconChevronRightOutlineRegular', 'IconCloseOutlineRegular',
          'IconCopyOutlineRegular', 'IconDataOutlineRegular', 'IconEditOutlineRegular',
          'IconFolderOpenOutlineRegular', 'IconListPenOutlineRegular', 'IconPlusOutlineRegular',
          'IconRefreshOutlineRegular', 'IconSearchOutlineRegular', 'IconTrashOutlineRegular',
          'IconWarningOutlineRegular',
        ]) exports[name] = props => ({ type: 'svg', props: { ...props, children: [] } })
        return exports
      }
      throw new Error(`Unexpected external module: ${id}`)
    },
  })
  return module.exports
}

// Materialize the actual client entry without mounting React or contacting a host.
async function loadClient() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/client/index.jsx', import.meta.url))],
    bundle: true, write: false, format: 'cjs', platform: 'browser',
    jsx: 'automatic', loader: { '.css': 'text' }, packages: 'external',
  })
  const module = { exports: {} }
  const jsx = (type, props) => ({ type, props })
  const document = {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, remove() {} }),
    head: { appendChild() {} },
  }
  runInNewContext(result.outputFiles[0].text, {
    module, exports: module.exports, document,
    require: id => {
      if (id === 'react') return {}
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (id === '@deepseek-ai/dsh-client-ui-primitives') return {}
      throw new Error(`Unexpected external module: ${id}`)
    },
  })
  return module.exports
}

function context() {
  const seats = new Map()
  const remote = { agentPresets: {}, settings: {}, pluginInventory: {}, pluginManager: {} }
  const t = key => key
  const ctx = {
    remote,
    get: () => { throw new Error('legacy ctx.get(remote) is not part of the 0.2 client contract') },
    effect: setup => setup(),
    locale: { register: () => () => {}, bind: () => t },
    slots: {
      inject: (_name, register) => register(),
      register: (options, render) => { seats.set(options.name, { options, render }); return () => {} },
    },
  }
  return { ctx, seats, t, remote }
}

test('settings section receives the rc.2 Remote namespaces', async () => {
  const client = await loadClient()
  assert.ok(client.inject.includes('remote.agentPresets'))
  assert.ok(client.inject.includes('remote.settings'))
  assert.ok(client.inject.includes('remote.pluginInventory'))
  assert.ok(client.inject.includes('remote.pluginManager'))
  const { ctx, seats, t, remote } = context()
  client.apply(ctx)
  const section = seats.get('settings.section')
  assert.equal(section.options.id, 'preset-library')
  assert.equal(section.options.order, 21)
  assert.equal(section.options.locale, 'preset-library')
  // DSH 0.2.0-rc.2 renders settings sections with the owner share `{ close }`.
  // The library owns its page state, so it must tolerate and ignore that shell
  // affordance while still receiving the locale-bound `t` function.
  const close = () => {}
  const rendered = section.render({ t, close })
  assert.equal(rendered.props.api, remote)
  assert.equal(rendered.props.t, t)
})

test('manifest selects the DSH 0.2.0-rc.2 web client assembly', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.deepEqual(packageJson.dsh.client, {
    platform: 'web',
    inject: [
      '@deepseek-ai/dsh-api-remotes',
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-settings',
    ],
  })
  assert.match(await readFile(new URL('../README.md', import.meta.url), 'utf8'), /0\.2\.0-rc\.2/)
})

test('library icon maps to the real rc.2 primitives export', async () => {
  const icons = await loadIcons()
  for (const name of [
    'IconLibrary', 'IconBranch', 'IconCheck', 'IconChevronDown', 'IconChevronRight', 'IconClose',
    'IconCopy', 'IconGrid', 'IconEdit', 'IconFolder', 'IconList', 'IconPlus', 'IconRefresh',
    'IconSearch', 'IconTrash', 'IconWarning',
  ]) assert.equal(typeof icons[name], 'function', `${name} must be an rc.2 icon function`)
  const [navModule] = await Promise.all([build({
    entryPoints: [fileURLToPath(new URL('../src/client/nav-icon.js', import.meta.url))],
    bundle: true, write: false, format: 'cjs', platform: 'browser',
  })])
  const nav = { exports: {} }
  runInNewContext(navModule.outputFiles[0].text, { module: nav, exports: nav.exports, queueMicrotask })

  let replacement
  const currentIcon = { getAttribute: name => name === 'class' ? 'host-icon' : null, replaceWith: node => { replacement = node } }
  const attributes = {}
  const button = {
    children: [{ tagName: 'svg' }, { tagName: 'SPAN', textContent: 'Library' }],
    querySelector: selector => selector === 'svg[data-preset-library-icon]' ? null : currentIcon,
    setAttribute: (name, value) => { attributes[name] = value },
  }
  const document = {
    defaultView: { MutationObserver: class { observe() {} disconnect() {} } },
    body: {},
    querySelectorAll: () => [button],
    createElementNS: (_namespace, tagName) => ({
      tagName,
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value },
      appendChild() {},
    }),
    createDocumentFragment: () => ({ appendChild() {} }),
  }
  nav.exports.installLibraryNavIcon(document, () => 'Library', icons.IconLibrary)
  assert.equal(replacement.tagName, 'svg')
  assert.equal(replacement.attributes.class, 'host-icon')
  assert.equal(replacement.attributes['aria-hidden'], 'true')
  assert.equal(replacement.attributes['data-preset-library-icon'], '')
  assert.equal(attributes['data-preset-library-nav'], '')
})
