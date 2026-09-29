import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'

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
    get: key => { assert.equal(key, 'remote'); return remote },
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
  assert.equal(section.render({ t }).props.api, remote)
})
