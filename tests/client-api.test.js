import test from 'node:test'
import assert from 'node:assert/strict'

import { createEmptyDocument } from '../src/core/document.js'
import {
  ClientApiError,
  copyPreset,
  deletePreset,
  loadMetadata,
  openPresetDirectory,
  readRoster,
  saveMetadata,
  setDefaultPreset,
} from '../src/client/api.js'

function fetchResponse(status, body, contentType = 'application/json') {
  return new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    { status, headers: { 'content-type': contentType } },
  )
}

test('loadMetadata returns the Host document', async () => {
  const document = createEmptyDocument()
  const calls = []
  const fetchImpl = async (...args) => {
    calls.push(args)
    return fetchResponse(200, { ok: true, document })
  }

  assert.deepEqual(await loadMetadata(fetchImpl), document)
  assert.equal(calls[0][0], '/preset-library/api/state')
})

test('saveMetadata sends the complete document and expected revision', async () => {
  const document = createEmptyDocument()
  const saved = { ...document, revision: 1 }
  let request
  const fetchImpl = async (url, init) => {
    request = { url, init }
    return fetchResponse(200, { ok: true, document: saved })
  }

  assert.deepEqual(await saveMetadata(document, 0, fetchImpl), saved)
  assert.equal(request.init.method, 'PUT')
  assert.deepEqual(JSON.parse(request.init.body), { document, expectedRevision: 0 })
})

test('saveMetadata exposes revision conflicts', async () => {
  const fetchImpl = async () => fetchResponse(409, {
    ok: false,
    error: 'revision conflict',
    currentRevision: 4,
  })

  await assert.rejects(
    saveMetadata(createEmptyDocument(), 3, fetchImpl),
    (error) => error instanceof ClientApiError && error.status === 409 && error.details.currentRevision === 4,
  )
})

test('loadMetadata reports non-JSON transport errors clearly', async () => {
  const fetchImpl = async () => fetchResponse(502, '<html>bad gateway</html>', 'text/html')

  await assert.rejects(loadMetadata(fetchImpl), /HTTP 502/)
})

test('readRoster unwraps the Remote result without a transport envelope', async () => {
  const value = { presets: [{ id: 'standard' }], authorable: true }
  const api = { agentPresets: { list: async (...args) => {
    assert.deepEqual(args, [])
    return { ok: true, value }
  } } }

  assert.deepEqual(await readRoster(api), value)
})

test('official preset failures become ClientApiError', async () => {
  const api = {
    settings: {
      update: async () => ({ ok: false, error: { code: 'settings/read-only', message: 'not allowed', details: { ns: 'agent-presets' } } }),
    },
  }

  await assert.rejects(setDefaultPreset(api, 'standard'), error =>
    error instanceof ClientApiError && error.message === 'not allowed'
    && error.details.code === 'settings/read-only' && error.details.details.ns === 'agent-presets')
})

test('copyPreset omits an empty display name', async () => {
  let payload
  const api = {
    agentPresets: {
      copy: async (...args) => {
        payload = args
        return { ok: true, value: undefined }
      },
    },
  }

  await copyPreset(api, { from: 'standard', id: 'my-standard', name: '   ' })
  assert.deepEqual(payload, ['standard', 'my-standard', undefined])
})

test('preset mutations use the rc.1 Remote namespaces and positional arguments', async () => {
  const calls = []
  const record = method => async (...args) => { calls.push([method, ...args]); return { ok: true, value: undefined } }
  const api = {
    settings: { update: record('update'), openAgentPresetDirectory: record('open') },
    agentPresets: { copy: record('copy'), deletePreset: record('delete') },
  }
  await setDefaultPreset(api, 'standard')
  await copyPreset(api, { from: 'standard', id: 'my-standard', name: ' My Standard ' })
  await openPresetDirectory(api, 'my-standard')
  await deletePreset(api, 'my-standard')
  assert.deepEqual(calls, [
    ['update', 'agent-presets', { default: 'standard' }, undefined],
    ['copy', 'standard', 'my-standard', 'My Standard'],
    ['open', 'my-standard'],
    ['delete', 'my-standard'],
  ])
})

test('RemoteError rejection retains its original diagnostic', async () => {
  const failure = Object.assign(new Error('gateway unavailable'), { name: 'RemoteError', code: 'gateway/unavailable' })
  const api = { agentPresets: { list: async () => { throw failure } } }
  await assert.rejects(readRoster(api), error => error === failure)
})
