const STATE_URL = '/preset-library/api/state'

export class ClientApiError extends Error {
  constructor(message, status = 0, details = {}) {
    super(message)
    this.name = 'ClientApiError'
    this.status = status
    this.details = details
  }
}

async function readPayload(response) {
  const contentType = response.headers?.get?.('content-type') ?? ''
  if (!contentType.toLocaleLowerCase().includes('application/json')) {
    throw new ClientApiError(`Preset Library API returned HTTP ${response.status} instead of JSON.`, response.status)
  }
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    throw new ClientApiError(`Preset Library API returned invalid JSON: ${error.message}`, response.status)
  }
  if (!response.ok || payload?.ok !== true) {
    throw new ClientApiError(payload?.error ?? `Preset Library API request failed with HTTP ${response.status}.`, response.status, payload ?? {})
  }
  return payload
}

export async function loadMetadata(fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(STATE_URL, {
    method: 'GET',
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  const payload = await readPayload(response)
  return payload.document
}

export async function saveMetadata(document, expectedRevision, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(STATE_URL, {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify({ document, expectedRevision }),
  })
  const payload = await readPayload(response)
  return payload.document
}

function unwrapOfficial(response) {
  if (response?.ok === true) return response.value
  throw new ClientApiError(response?.error?.message ?? 'DeepSeek Harness rejected the preset operation.', 0, response?.error ?? {})
}

export async function readRoster(api) {
  return unwrapOfficial(await api.agentPresets.list())
}

export async function setDefaultPreset(api, id) {
  return unwrapOfficial(await api.settings.update('agent-presets', { default: id }, undefined))
}

export async function copyPreset(api, { from, id, name }) {
  const trimmedName = String(name ?? '').trim()
  return unwrapOfficial(await api.agentPresets.copy(from, id, trimmedName || undefined))
}

export async function openPresetDirectory(api, id) {
  return unwrapOfficial(await api.settings.openAgentPresetDirectory(id))
}

export async function deletePreset(api, id) {
  return unwrapOfficial(await api.agentPresets.deletePreset(id))
}
