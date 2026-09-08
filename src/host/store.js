import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  DOCUMENT_VERSION,
  DocumentValidationError,
  createEmptyDocument,
  validateDocument,
} from '../core/document.js'

export class RevisionConflictError extends Error {
  constructor(expectedRevision, currentRevision) {
    super(`metadata revision conflict: expected ${expectedRevision}, current ${currentRevision}`)
    this.name = 'RevisionConflictError'
    this.expectedRevision = expectedRevision
    this.currentRevision = currentRevision
  }
}

export class MetadataFormatError extends Error {
  constructor(filePath, cause) {
    super(`cannot read preset library metadata at ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'MetadataFormatError'
    this.filePath = filePath
    this.cause = cause
  }
}

export class MetadataStore {
  #queue = Promise.resolve()

  constructor(filePath) {
    this.filePath = path.resolve(filePath)
  }

  async read() {
    let source
    try {
      source = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return createEmptyDocument()
      throw new MetadataFormatError(this.filePath, error)
    }

    try {
      return validateDocument(JSON.parse(source))
    } catch (error) {
      if (error instanceof MetadataFormatError) throw error
      throw new MetadataFormatError(this.filePath, error)
    }
  }

  save(candidate, expectedRevision) {
    const operation = this.#queue.then(() => this.#save(candidate, expectedRevision))
    this.#queue = operation.catch(() => undefined)
    return operation
  }

  async #save(candidate, expectedRevision) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new DocumentValidationError('expectedRevision must be a non-negative safe integer')
    }
    const current = await this.read()
    if (current.revision !== expectedRevision) {
      throw new RevisionConflictError(expectedRevision, current.revision)
    }
    const next = validateDocument({
      ...candidate,
      version: DOCUMENT_VERSION,
      revision: current.revision + 1,
    })

    const directory = path.dirname(this.filePath)
    const temporaryPath = path.join(
      directory,
      `.${path.basename(this.filePath)}.${process.pid}.${Date.now().toString(36)}.tmp`,
    )
    await mkdir(directory, { recursive: true, mode: 0o700 })
    try {
      await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      })
      await rename(temporaryPath, this.filePath)
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
    return next
  }
}
