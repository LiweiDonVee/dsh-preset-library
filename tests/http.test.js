import test from 'node:test'
import assert from 'node:assert/strict'

import { DocumentValidationError, createEmptyDocument } from '../src/core/document.js'
import {
  API_PREFIX,
  MAX_BODY_BYTES,
  createApiHandler as createAuthenticatedApiHandler,
  isLoopbackAddress,
} from '../src/host/http.js'
import { MetadataFormatError, RevisionConflictError } from '../src/host/store.js'

const createApiHandler = store => createAuthenticatedApiHandler(store, { requestRejection: () => undefined })

function request({ method = 'GET', path = '/state', body, address = '127.0.0.1' } = {}) {
  const chunks = body === undefined
    ? []
    : [Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]
  return {
    method,
    url: `${API_PREFIX}${path}`,
    socket: { remoteAddress: address },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

function response() {
  return {
    status: undefined,
    headers: undefined,
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(body = '') {
      this.body = String(body)
    },
    json() {
      return JSON.parse(this.body)
    },
  }
}

test('isLoopbackAddress accepts IPv4, IPv6, and mapped loopback only', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true)
  assert.equal(isLoopbackAddress('127.24.1.9'), true)
  assert.equal(isLoopbackAddress('::1'), true)
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true)
  assert.equal(isLoopbackAddress('192.168.1.20'), false)
  assert.equal(isLoopbackAddress(undefined), false)
})

test('GET state returns metadata with no-store headers', async () => {
  const document = createEmptyDocument()
  const handler = createApiHandler({ filePath: 'C:\\Users\\Example\\.dsh\\preset-library.json', read: async () => document })
  const res = response()

  await handler(request(), res)

  assert.equal(res.status, 200)
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.deepEqual(res.json(), { ok: true, document })
})

test('DSH authentication rejects reads and writes before storage access', async () => {
  for (const status of [401, 403]) {
    for (const method of ['GET', 'PUT']) {
      const req = request({ method, body: { document: {}, expectedRevision: 0 } })
      const handler = createAuthenticatedApiHandler({
        read: () => assert.fail('unauthenticated read'),
        save: () => assert.fail('unauthenticated write'),
      }, { requestRejection: candidate => { assert.equal(candidate, req); return status } })
      const res = response()
      await handler(req, res)
      assert.equal(res.status, status)
      assert.equal(res.json().ok, false)
      assert.equal(res.headers['cache-control'], 'no-store')
    }
  }
})

test('HTTP handler refuses to start without the DSH authentication service', () => {
  assert.throws(() => createAuthenticatedApiHandler({}), /connection/i)
})

test('non-loopback clients are refused before storage access', async () => {
  let read = false
  const handler = createApiHandler({ read: async () => { read = true } })
  const res = response()

  await handler(request({ address: '10.0.0.4' }), res)

  assert.equal(res.status, 403)
  assert.equal(read, false)
})

test('PUT state saves the expected revision', async () => {
  const document = createEmptyDocument()
  let captured
  const handler = createApiHandler({
    read: async () => document,
    save: async (candidate, expectedRevision) => {
      captured = { candidate, expectedRevision }
      return { ...candidate, revision: 1 }
    },
  })
  const res = response()

  await handler(request({ method: 'PUT', body: { document, expectedRevision: 0 } }), res)

  assert.equal(res.status, 200)
  assert.equal(captured.expectedRevision, 0)
  assert.deepEqual(captured.candidate, document)
  assert.equal(res.json().document.revision, 1)
})

test('oversized bodies return 413 without parsing JSON', async () => {
  const handler = createApiHandler({ save: async () => assert.fail('save must not run') })
  const res = response()

  await handler(request({ method: 'PUT', body: Buffer.alloc(MAX_BODY_BYTES + 1, 65) }), res)

  assert.equal(res.status, 413)
  assert.match(res.json().error, /too large/i)
})

test('validation and revision errors map to 400 and 409', async () => {
  const validation = createApiHandler({
    save: async () => { throw new DocumentValidationError('bad tag') },
  })
  const validationResponse = response()
  await validation(request({ method: 'PUT', body: { document: {}, expectedRevision: 0 } }), validationResponse)
  assert.equal(validationResponse.status, 400)

  const conflict = createApiHandler({
    save: async () => { throw new RevisionConflictError(2, 3) },
  })
  const conflictResponse = response()
  await conflict(request({ method: 'PUT', body: { document: {}, expectedRevision: 2 } }), conflictResponse)
  assert.equal(conflictResponse.status, 409)
  assert.equal(conflictResponse.json().currentRevision, 3)
})

test('malformed disk metadata returns a read-only diagnostic and fixed path', async () => {
  const filePath = 'C:\\Users\\Example\\.dsh\\preset-library.json'
  const handler = createApiHandler({
    filePath,
    read: async () => { throw new MetadataFormatError(filePath, new Error('bad json')) },
  })
  const res = response()

  await handler(request(), res)

  assert.equal(res.status, 500)
  assert.equal(res.json().readOnly, true)
  assert.equal(res.json().path, filePath)
})
