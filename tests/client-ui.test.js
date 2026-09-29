import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'

async function loadComponents() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/client/PresetLibrary.jsx', import.meta.url))],
    bundle: true, write: false, format: 'cjs', platform: 'browser',
    jsx: 'automatic', packages: 'external',
  })
  const module = { exports: {} }
  const jsx = (type, props) => ({ type, props })
  runInNewContext(result.outputFiles[0].text, {
    module, exports: module.exports,
    require: id => {
      if (id === 'react') return {}
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (id === '@deepseek-ai/dsh-client-ui-primitives') return {}
      throw new Error(`Unexpected external module: ${id}`)
    },
  })
  return module.exports
}

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!node || typeof node !== 'object') return []
  if (typeof node.type === 'function') return elements(node.type(node.props))
  return [node, ...elements(node.props?.children)]
}

test('bundle controls respect management availability and broken enablement', async () => {
  const { BundleSection } = await loadComponents()
  const bundles = [
    { name: 'writable', enabled: true, rows: [], overrides: [] },
    { name: 'broken-disabled', enabled: false, error: { code: 'not-bundle' }, rows: [], overrides: [] },
    { name: 'broken-selected', enabled: true, error: { code: 'operation-error' }, rows: [], overrides: [] },
    { name: 'locked', enabled: false, readOnlyReason: 'management-required', rows: [], overrides: [] },
  ]
  const render = managementAvailable => elements(BundleSection({
    t: key => key, bundles, inventory: { managementAvailable }, busy: false, onToggle() {},
  })).filter(node => node.type === 'input' && node.props.type === 'checkbox')
  assert.deepEqual(render(true).map(node => node.props.disabled), [false, true, false, true])
  assert.deepEqual(render(false).map(node => node.props.disabled), [true, true, true, true])
})
