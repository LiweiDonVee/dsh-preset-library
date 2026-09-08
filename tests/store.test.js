import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createEmptyDocument, setPresetParent } from '../src/core/document.js'
import {
  MetadataFormatError,
  MetadataStore,
  RevisionConflictError,
} from '../src/host/store.js'

async function withStore(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-preset-library-'))
  const filePath = path.join(directory, 'preset-library.json')
  try {
    await run({ directory, filePath, store: new MetadataStore(filePath) })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('read returns defaults without creating a missing file', async () => {
  await withStore(async ({ directory, store }) => {
    assert.deepEqual(await store.read(), createEmptyDocument())
    assert.deepEqual(await readdir(directory), [])
  })
})

test('save atomically persists a validated document and increments revision', async () => {
  await withStore(async ({ directory, filePath, store }) => {
    const document = createEmptyDocument()
    document.tags = [{ id: 'tag-writing-001', name: 'Writing', color: 'green' }]

    const saved = await store.save(document, 0)
    const reread = await store.read()

    assert.equal(saved.revision, 1)
    assert.deepEqual(reread, saved)
    assert.deepEqual((await readdir(directory)).sort(), ['preset-library.json'])
    assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), saved)
  })
})

test('first save after reading version 1 writes version 2 without losing metadata', async () => {
  await withStore(async ({ filePath, store }) => {
    const legacy = {
      version: 1,
      revision: 7,
      tags: [{ id: 'tag-writing-001', name: 'Writing', color: 'green' }],
      assignments: { standard: ['tag-writing-001'] },
      ui: { view: 'list', match: 'any', sort: 'name', collapsedTagIds: ['tag-writing-001'] },
    }
    await writeFile(filePath, `${JSON.stringify(legacy)}\n`, 'utf8')
    const migrated = await store.read()
    const candidate = setPresetParent(migrated, 'variant-b', 'standard')

    const saved = await store.save(candidate, 7)
    const disk = JSON.parse(await readFile(filePath, 'utf8'))

    assert.equal(saved.version, 2)
    assert.equal(saved.revision, 8)
    assert.deepEqual(saved.tags, legacy.tags)
    assert.deepEqual(saved.assignments, legacy.assignments)
    assert.deepEqual(saved.parents, { 'variant-b': 'standard' })
    assert.deepEqual(saved.ui.collapsedTagIds, ['tag-writing-001'])
    assert.deepEqual(saved.ui.collapsedPresetIds, [])
    assert.deepEqual(disk, saved)
  })
})

test('save rejects a stale revision without changing the file', async () => {
  await withStore(async ({ filePath, store }) => {
    const first = await store.save(createEmptyDocument(), 0)
    const before = await readFile(filePath, 'utf8')

    await assert.rejects(
      store.save(first, 0),
      (error) => error instanceof RevisionConflictError && error.currentRevision === 1,
    )
    assert.equal(await readFile(filePath, 'utf8'), before)
  })
})

test('serialized concurrent saves allow one writer for one expected revision', async () => {
  await withStore(async ({ store }) => {
    const candidateA = createEmptyDocument()
    candidateA.tags = [{ id: 'tag-alpha-001', name: 'Alpha', color: 'green' }]
    const candidateB = createEmptyDocument()
    candidateB.tags = [{ id: 'tag-beta-001', name: 'Beta', color: 'blue' }]

    const results = await Promise.allSettled([
      store.save(candidateA, 0),
      store.save(candidateB, 0),
    ])

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
    assert.ok(results.find((result) => result.status === 'rejected').reason instanceof RevisionConflictError)
  })
})

test('malformed metadata is refused and never overwritten', async () => {
  await withStore(async ({ filePath, store }) => {
    const malformed = '{ definitely not json'
    await writeFile(filePath, malformed, 'utf8')

    await assert.rejects(store.read(), MetadataFormatError)
    await assert.rejects(store.save(createEmptyDocument(), 0), MetadataFormatError)
    assert.equal(await readFile(filePath, 'utf8'), malformed)
  })
})
