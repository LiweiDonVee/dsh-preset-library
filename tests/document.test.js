import test from 'node:test'
import assert from 'node:assert/strict'

import * as documentModule from '../src/core/document.js'
import {
  TAG_COLORS,
  createEmptyDocument,
  removePresetAssignment,
  removeTag,
  validateDocument,
} from '../src/core/document.js'

function tag(id, name, color = TAG_COLORS[0]) {
  return { id, name, color }
}

test('createEmptyDocument returns the versioned default state', () => {
  assert.deepEqual(createEmptyDocument(), {
    version: 2,
    revision: 0,
    tags: [],
    assignments: {},
    parents: {},
    ui: {
      view: 'grid',
      match: 'any',
      sort: 'name',
      collapsedTagIds: [],
      collapsedPresetIds: [],
    },
  })
})

test('validateDocument migrates version 1 documents without losing metadata', () => {
  const output = validateDocument({
    version: 1,
    revision: 7,
    tags: [tag('tag-writing-001', 'Writing')],
    assignments: { standard: ['tag-writing-001'] },
    ui: {
      view: 'list',
      match: 'all',
      sort: 'id',
      collapsedTagIds: ['tag-writing-001'],
    },
  })

  assert.deepEqual(output, {
    version: 2,
    revision: 7,
    tags: [tag('tag-writing-001', 'Writing')],
    assignments: { standard: ['tag-writing-001'] },
    parents: {},
    ui: {
      view: 'list',
      match: 'all',
      sort: 'id',
      collapsedTagIds: ['tag-writing-001'],
      collapsedPresetIds: [],
    },
  })
})

test('validateDocument trims tag names and returns an owned clone', () => {
  const input = createEmptyDocument()
  input.tags = [tag('tag-writing-001', '  Writing  ', 'green')]
  input.assignments = { 'story-architect': ['tag-writing-001'] }

  const output = validateDocument(input)

  assert.equal(output.tags[0].name, 'Writing')
  assert.notEqual(output, input)
  assert.notEqual(output.tags, input.tags)
})

test('validateDocument rejects duplicate tag names case-insensitively', () => {
  const input = createEmptyDocument()
  input.tags = [
    tag('tag-writing-001', 'Writing'),
    tag('tag-writing-002', 'writing'),
  ]

  assert.throws(() => validateDocument(input), /tag names must be unique/i)
})

test('validateDocument rejects assignments to unknown tags', () => {
  const input = createEmptyDocument()
  input.assignments = { standard: ['tag-missing-001'] }

  assert.throws(() => validateDocument(input), /unknown tag/i)
})

test('validateDocument rejects invalid persisted UI values', () => {
  const input = createEmptyDocument()
  input.ui.view = 'table'

  assert.throws(() => validateDocument(input), /ui\.view/i)
})

test('validateDocument accepts unavailable parent ids without a roster', () => {
  const input = createEmptyDocument()
  input.parents = { 'variant-b': 'missing-parent' }

  assert.deepEqual(validateDocument(input).parents, { 'variant-b': 'missing-parent' })
})

test('validateDocument rejects invalid one-level relationships', () => {
  const selfParent = createEmptyDocument()
  selfParent.parents = { 'variant-b': 'variant-b' }
  assert.throws(() => validateDocument(selfParent), /parent itself/i)

  const chain = createEmptyDocument()
  chain.parents = { 'variant-b': 'preset-a', 'variant-c': 'variant-b' }
  assert.throws(() => validateDocument(chain), /may not own children/i)
})

test('validateDocument caps parent entries', () => {
  const input = createEmptyDocument()
  input.parents = Object.fromEntries(Array.from({ length: 2049 }, (_, index) => [`child-${index}`, 'preset-a']))

  assert.throws(() => validateDocument(input), /at most 2048/i)
})

test('validateDocument rejects invalid collapsed preset ids', () => {
  const unknown = createEmptyDocument()
  unknown.parents = { 'variant-b': 'preset-a' }
  unknown.ui.collapsedPresetIds = ['not-a-parent']
  assert.throws(() => validateDocument(unknown), /not a parent/i)

  const duplicate = createEmptyDocument()
  duplicate.parents = { 'variant-b': 'preset-a' }
  duplicate.ui.collapsedPresetIds = ['preset-a', 'preset-a']
  assert.throws(() => validateDocument(duplicate), /duplicate/i)
})

test('setPresetParent attaches, reassigns, and detaches presets', () => {
  assert.equal(typeof documentModule.setPresetParent, 'function')
  const attached = documentModule.setPresetParent(createEmptyDocument(), 'variant-b', 'preset-a')
  const reassigned = documentModule.setPresetParent(attached, 'variant-b', 'preset-z')
  const detached = documentModule.setPresetParent(reassigned, 'variant-b', null)

  assert.deepEqual(attached.parents, { 'variant-b': 'preset-a' })
  assert.deepEqual(reassigned.parents, { 'variant-b': 'preset-z' })
  assert.deepEqual(detached.parents, {})
})

test('removePresetRelations distinguishes child and parent cleanup', () => {
  assert.equal(typeof documentModule.removePresetRelations, 'function')
  const input = createEmptyDocument()
  input.parents = { 'variant-b': 'preset-a', 'variant-c': 'preset-a', 'variant-z': 'preset-z' }
  input.ui.collapsedPresetIds = ['preset-a', 'preset-z']

  const childRemoved = documentModule.removePresetRelations(input, 'variant-b')
  assert.deepEqual(childRemoved.parents, { 'variant-c': 'preset-a', 'variant-z': 'preset-z' })
  assert.deepEqual(childRemoved.ui.collapsedPresetIds, ['preset-a', 'preset-z'])

  const parentRemoved = documentModule.removePresetRelations(input, 'preset-a')
  assert.deepEqual(parentRemoved.parents, { 'variant-z': 'preset-z' })
  assert.deepEqual(parentRemoved.ui.collapsedPresetIds, ['preset-z'])
})

test('removeTag removes assignments and collapsed state without mutating input', () => {
  const input = createEmptyDocument()
  input.tags = [tag('tag-writing-001', 'Writing'), tag('tag-code-001', 'Code', 'blue')]
  input.assignments = {
    standard: ['tag-writing-001', 'tag-code-001'],
    minimal: ['tag-writing-001'],
  }
  input.ui.collapsedTagIds = ['tag-writing-001']
  input.parents = { minimal: 'standard' }
  input.ui.collapsedPresetIds = ['standard']

  const output = removeTag(input, 'tag-writing-001')

  assert.deepEqual(output.tags.map((entry) => entry.id), ['tag-code-001'])
  assert.deepEqual(output.assignments, { standard: ['tag-code-001'] })
  assert.deepEqual(output.ui.collapsedTagIds, [])
  assert.deepEqual(output.parents, { minimal: 'standard' })
  assert.deepEqual(output.ui.collapsedPresetIds, ['standard'])
  assert.equal(input.tags.length, 2)
})

test('removePresetAssignment keeps every other preset mapping', () => {
  const input = createEmptyDocument()
  input.tags = [tag('tag-writing-001', 'Writing')]
  input.assignments = {
    standard: ['tag-writing-001'],
    minimal: ['tag-writing-001'],
  }

  const output = removePresetAssignment(input, 'standard')

  assert.deepEqual(output.assignments, { minimal: ['tag-writing-001'] })
  assert.ok('standard' in input.assignments)
})
