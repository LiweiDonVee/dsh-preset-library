import test from 'node:test'
import assert from 'node:assert/strict'

import { createEmptyDocument } from '../src/core/document.js'
import * as libraryModule from '../src/core/library.js'
import {
  decorateRoster,
  groupLibrary,
  projectLibrary,
  tagCounts,
} from '../src/core/library.js'

const roster = [
  { id: 'standard', trust: 'system', isDefault: true, name: 'Standard', description: 'General coding agent' },
  { id: 'story-architect', trust: 'user', isDefault: false, name: 'Story Architect', description: 'Long-form narrative planning' },
  { id: 'research-synth', trust: 'user', isDefault: false, name: 'Research Synth', description: 'Source synthesis and citations' },
  { id: 'code-auditor', trust: 'user', isDefault: false, name: 'Code Auditor', description: 'Review code risks', broken: 'missing composition' },
  { id: 'minimal', trust: 'system', isDefault: false, name: 'Minimal', description: 'Small tool surface' },
]

function metadata() {
  const document = createEmptyDocument()
  document.tags = [
    { id: 'tag-writing-001', name: 'Writing', color: 'green' },
    { id: 'tag-research-001', name: 'Research', color: 'blue' },
    { id: 'tag-code-001', name: 'Code', color: 'cyan' },
  ]
  document.assignments = {
    'story-architect': ['tag-writing-001', 'tag-research-001'],
    'research-synth': ['tag-research-001'],
    'code-auditor': ['tag-code-001'],
  }
  return document
}

const baseFilters = {
  query: '',
  selectedTagIds: [],
  match: 'any',
  status: 'all',
  sort: 'name',
}

test('decorateRoster joins stable tags without mutating roster rows', () => {
  const rows = decorateRoster(roster, metadata())

  assert.deepEqual(rows.find((row) => row.id === 'story-architect').tagIds, [
    'tag-writing-001',
    'tag-research-001',
  ])
  assert.deepEqual(rows.find((row) => row.id === 'story-architect').tags.map((tag) => tag.name), [
    'Writing',
    'Research',
  ])
  assert.equal('tagIds' in roster[1], false)
})

test('search matches name, id, description, and tag names case-insensitively', () => {
  const document = metadata()
  const names = (query) => projectLibrary(roster, document, { ...baseFilters, query }).map((row) => row.id)

  assert.deepEqual(names('STORY'), ['story-architect'])
  assert.deepEqual(names('code-auditor'), ['code-auditor'])
  assert.deepEqual(names('citations'), ['research-synth'])
  assert.deepEqual(names('writing'), ['story-architect'])
})

test('status filters distinguish system, user, broken, and untagged rows', () => {
  const document = metadata()
  const ids = (status) => projectLibrary(roster, document, { ...baseFilters, status }).map((row) => row.id)

  assert.deepEqual(ids('system'), ['minimal', 'standard'])
  assert.deepEqual(ids('user'), ['code-auditor', 'research-synth', 'story-architect'])
  assert.deepEqual(ids('broken'), ['code-auditor'])
  assert.deepEqual(ids('untagged'), ['minimal', 'standard'])
})

test('any mode accepts rows with at least one selected tag', () => {
  const rows = projectLibrary(roster, metadata(), {
    ...baseFilters,
    selectedTagIds: ['tag-writing-001', 'tag-code-001'],
    match: 'any',
  })

  assert.deepEqual(rows.map((row) => row.id), ['code-auditor', 'story-architect'])
})

test('all mode requires every selected tag', () => {
  const rows = projectLibrary(roster, metadata(), {
    ...baseFilters,
    selectedTagIds: ['tag-writing-001', 'tag-research-001'],
    match: 'all',
  })

  assert.deepEqual(rows.map((row) => row.id), ['story-architect'])
})

test('id and status sorts are deterministic', () => {
  const document = metadata()
  const byId = projectLibrary(roster, document, { ...baseFilters, sort: 'id' })
  const byStatus = projectLibrary(roster, document, { ...baseFilters, sort: 'status' })

  assert.deepEqual(byId.map((row) => row.id), ['code-auditor', 'minimal', 'research-synth', 'standard', 'story-architect'])
  assert.equal(byStatus[0].id, 'standard')
  assert.equal(byStatus.at(-1).id, 'code-auditor')
})

test('groupLibrary repeats multi-tag rows and includes an untagged group', () => {
  const document = metadata()
  const groups = groupLibrary(decorateRoster(roster, document), document)

  assert.deepEqual(groups.find((group) => group.id === 'tag-writing-001').rows.map((row) => row.id), ['story-architect'])
  assert.deepEqual(groups.find((group) => group.id === 'tag-research-001').rows.map((row) => row.id), ['story-architect', 'research-synth'])
  assert.deepEqual(groups.find((group) => group.id === '__untagged__').rows.map((row) => row.id), ['standard', 'minimal'])
})

test('tagCounts reports counts for a projected row set', () => {
  const document = metadata()
  const rows = decorateRoster(roster, document).filter((row) => row.trust === 'user')

  assert.deepEqual(tagCounts(rows, document), {
    'tag-writing-001': 1,
    'tag-research-001': 2,
    'tag-code-001': 1,
  })
})

const familyRoster = [
  { id: 'preset-a', trust: 'user', isDefault: false, name: 'Alpha Parent', description: 'Base preset' },
  { id: 'variant-b', trust: 'user', isDefault: false, name: 'Beta Variant', description: 'First variant' },
  { id: 'variant-c', trust: 'user', isDefault: false, name: 'Gamma Variant', description: 'Second variant' },
  { id: 'preset-z', trust: 'user', isDefault: false, name: 'Zeta Root', description: 'Independent preset' },
]

function familyMetadata() {
  const document = createEmptyDocument()
  document.parents = { 'variant-b': 'preset-a', 'variant-c': 'preset-a' }
  return document
}

test('decorateRoster exposes available and unavailable parent metadata', () => {
  const document = familyMetadata()
  document.parents['preset-z'] = 'missing-parent'
  const rows = decorateRoster(familyRoster, document)

  assert.equal(rows.find((row) => row.id === 'variant-b').parentId, 'preset-a')
  assert.equal(rows.find((row) => row.id === 'variant-b').parentName, 'Alpha Parent')
  assert.equal(rows.find((row) => row.id === 'preset-z').parentId, 'missing-parent')
  assert.equal(rows.find((row) => row.id === 'preset-z').parentName, undefined)
})

test('buildPresetFamilies nests sorted children directly under their visible parent', () => {
  assert.equal(typeof libraryModule.buildPresetFamilies, 'function')
  const document = familyMetadata()
  const rows = projectLibrary(familyRoster, document, baseFilters)
  const families = libraryModule.buildPresetFamilies(rows, document)

  assert.deepEqual(families.map((family) => family.root.id), ['preset-a', 'preset-z'])
  assert.deepEqual(families[0].children.map((row) => row.id), ['variant-b', 'variant-c'])
  assert.equal(families[0].childCount, 2)
  assert.equal(families[0].collapsed, false)
})

test('buildPresetFamilies hides collapsed children only when collapse is respected', () => {
  assert.equal(typeof libraryModule.buildPresetFamilies, 'function')
  const document = familyMetadata()
  document.ui.collapsedPresetIds = ['preset-a']
  const rows = projectLibrary(familyRoster, document, baseFilters)

  const collapsed = libraryModule.buildPresetFamilies(rows, document, { respectCollapse: true })[0]
  const revealed = libraryModule.buildPresetFamilies(rows, document, { respectCollapse: false })[0]

  assert.equal(collapsed.childCount, 2)
  assert.deepEqual(collapsed.children, [])
  assert.equal(collapsed.collapsed, true)
  assert.deepEqual(revealed.children.map((row) => row.id), ['variant-b', 'variant-c'])
  assert.equal(revealed.collapsed, false)
})

test('filtered children remain sorted top-level rows with parent context', () => {
  assert.equal(typeof libraryModule.buildPresetFamilies, 'function')
  const document = familyMetadata()
  const rows = projectLibrary(familyRoster, document, { ...baseFilters, query: 'variant' })
  const families = libraryModule.buildPresetFamilies(rows, document)

  assert.deepEqual(families.map((family) => family.root.id), ['variant-b', 'variant-c'])
  assert.deepEqual(families.map((family) => family.root.parentName), ['Alpha Parent', 'Alpha Parent'])
})

test('missing parents retain their stored id for orphan annotation', () => {
  assert.equal(typeof libraryModule.buildPresetFamilies, 'function')
  const document = createEmptyDocument()
  document.parents = { 'variant-b': 'missing-parent' }
  const rows = projectLibrary(familyRoster, document, { ...baseFilters, query: 'beta' })
  const orphan = libraryModule.buildPresetFamilies(rows, document)[0].root

  assert.equal(orphan.parentId, 'missing-parent')
  assert.equal(orphan.parentName, undefined)
})

test('searching a parent name does not implicitly match its children', () => {
  const ids = projectLibrary(familyRoster, familyMetadata(), {
    ...baseFilters,
    query: 'Alpha Parent',
  }).map((row) => row.id)

  assert.deepEqual(ids, ['preset-a'])
})

test('group counts retain collapsed children while family rendering hides them', () => {
  assert.equal(typeof libraryModule.buildPresetFamilies, 'function')
  const document = familyMetadata()
  document.tags = [{ id: 'tag-family-001', name: 'Family', color: 'green' }]
  document.assignments = {
    'preset-a': ['tag-family-001'],
    'variant-b': ['tag-family-001'],
    'variant-c': ['tag-family-001'],
  }
  document.ui.collapsedPresetIds = ['preset-a']
  const rows = projectLibrary(familyRoster, document, baseFilters)
  const group = groupLibrary(rows, document).find((entry) => entry.id === 'tag-family-001')
  const family = libraryModule.buildPresetFamilies(group.rows, document)[0]

  assert.equal(group.rows.length, 3)
  assert.equal(family.childCount, 2)
  assert.deepEqual(family.children, [])
})
