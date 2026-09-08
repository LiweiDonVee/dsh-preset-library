import { DocumentValidationError } from '../core/document.js'
import { MetadataFormatError, RevisionConflictError } from './store.js'

export const API_PREFIX = '/preset-library/api'
export const MAX_BODY_BYTES = 512 * 1024

class PayloadTooLargeError extends Error {}

export function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false
  const normalized = address.toLocaleLowerCase()
  if (normalized === '::1') return true
  if (normalized.startsWith('127.')) return true
  return normalized.startsWith('::ffff:127.')
}

async function readJson(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk)
    total += bytes.length
    if (total > MAX_BODY_BYTES) throw new PayloadTooLargeError('request body is too large')
    chunks.push(bytes)
  }
  if (chunks.length === 0) throw new DocumentValidationError('request body is required')
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error) {
    throw new DocumentValidationError(`request body must be valid JSON: ${error.message}`)
  }
}

function json(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

export function createApiHandler(store, connection) {
  if (typeof connection?.requestRejection !== 'function') throw new TypeError('DSH connection authentication is required')
  return async function presetLibraryApi(req, res) {
    const rejection = connection.requestRejection(req)
    if (rejection !== undefined) {
      json(res, rejection, { ok: false, error: rejection === 401 ? 'Open the DSH launch URL to authenticate this browser.' : 'DSH rejected this request host or origin.' })
      return
    }
    if (!isLoopbackAddress(req.socket?.remoteAddress)) {
      json(res, 403, { ok: false, error: 'Preset Library metadata is available only from this machine.' })
      return
    }

    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    const route = pathname.startsWith(API_PREFIX) ? pathname.slice(API_PREFIX.length) || '/' : pathname
    try {
      if (req.method === 'GET' && route === '/state') {
        const document = await store.read()
        json(res, 200, { ok: true, document })
        return
      }
      if (req.method === 'PUT' && route === '/state') {
        const payload = await readJson(req)
        if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
          throw new DocumentValidationError('request body must be an object')
        }
        const document = await store.save(payload.document, payload.expectedRevision)
        json(res, 200, { ok: true, document })
        return
      }
      json(res, 404, { ok: false, error: `not found: ${req.method ?? 'UNKNOWN'} ${route}` })
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        json(res, 413, { ok: false, error: error.message })
      } else if (error instanceof RevisionConflictError) {
        json(res, 409, {
          ok: false,
          error: error.message,
          currentRevision: error.currentRevision,
        })
      } else if (error instanceof DocumentValidationError) {
        json(res, 400, { ok: false, error: error.message })
      } else if (error instanceof MetadataFormatError) {
        json(res, 500, {
          ok: false,
          error: error.message,
          readOnly: true,
          path: error.filePath ?? store.filePath,
        })
      } else {
        json(res, 500, { ok: false, error: errorMessage(error) })
      }
    }
  }
}
