export const DOCUMENT_VERSION = 2
export const TAG_COLORS = Object.freeze(['green', 'blue', 'cyan', 'yellow', 'red', 'gray'])

const TAG_ID = /^tag-[a-z0-9][a-z0-9-]{5,63}$/
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/
const VIEWS = new Set(['grid', 'list', 'grouped'])
const MATCH_MODES = new Set(['any', 'all'])
const SORT_MODES = new Set(['name', 'id', 'status'])

export class DocumentValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DocumentValidationError'
  }
}

export function createEmptyDocument() {
  return {
    version: DOCUMENT_VERSION,
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
  }
}

function fail(message) {
  throw new DocumentValidationError(message)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireString(value, field) {
  if (typeof value !== 'string') fail(`${field} must be a string`)
  return value
}

export function validateDocument(input) {
  if (!isRecord(input)) fail('metadata document must be an object')
  if (input.version !== 1 && input.version !== DOCUMENT_VERSION) {
    fail(`version must be 1 or ${DOCUMENT_VERSION}`)
  }
  const sourceVersion = input.version
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) {
    fail('revision must be a non-negative safe integer')
  }
  if (!Array.isArray(input.tags) || input.tags.length > 128) {
    fail('tags must be an array with at most 128 entries')
  }

  const tagIds = new Set()
  const tagNames = new Set()
  const tags = input.tags.map((entry, index) => {
    if (!isRecord(entry)) fail(`tags[${index}] must be an object`)
    const id = requireString(entry.id, `tags[${index}].id`)
    const name = requireString(entry.name, `tags[${index}].name`).trim()
    const color = requireString(entry.color, `tags[${index}].color`)
    if (!TAG_ID.test(id)) fail(`tags[${index}].id is invalid`)
    if (tagIds.has(id)) fail('tag ids must be unique')
    if (name.length === 0 || name.length > 40) fail('tag names must contain 1 to 40 characters')
    const foldedName = name.toLocaleLowerCase()
    if (tagNames.has(foldedName)) fail('tag names must be unique case-insensitively')
    if (!TAG_COLORS.includes(color)) fail(`tags[${index}].color is invalid`)
    tagIds.add(id)
    tagNames.add(foldedName)
    return { id, name, color }
  })

  if (!isRecord(input.assignments)) fail('assignments must be an object')
  const assignmentEntries = Object.entries(input.assignments)
  if (assignmentEntries.length > 2048) fail('assignments may contain at most 2048 presets')
  const assignments = {}
  for (const [presetId, assigned] of assignmentEntries) {
    if (!PRESET_ID.test(presetId)) fail(`assignment preset id is invalid: ${presetId}`)
    if (!Array.isArray(assigned) || assigned.length > 128) {
      fail(`assignment for ${presetId} must be an array with at most 128 tag ids`)
    }
    const unique = []
    const seen = new Set()
    for (const value of assigned) {
      const tagId = requireString(value, `assignment for ${presetId}`)
      if (!tagIds.has(tagId)) fail(`assignment for ${presetId} references unknown tag ${tagId}`)
      if (seen.has(tagId)) fail(`assignment for ${presetId} contains duplicate tag ${tagId}`)
      seen.add(tagId)
      unique.push(tagId)
    }
    if (unique.length > 0) assignments[presetId] = unique
  }

  const rawParents = sourceVersion === 1 ? {} : input.parents
  if (!isRecord(rawParents)) fail('parents must be an object')
  const parentEntries = Object.entries(rawParents)
  if (parentEntries.length > 2048) fail('parents may contain at most 2048 presets')
  const parents = {}
  for (const [childId, rawParentId] of parentEntries) {
    if (!PRESET_ID.test(childId)) fail(`child preset id is invalid: ${childId}`)
    const parentId = requireString(rawParentId, `parent for ${childId}`)
    if (!PRESET_ID.test(parentId)) fail(`parent preset id is invalid: ${parentId}`)
    if (childId === parentId) fail('a preset cannot parent itself')
    parents[childId] = parentId
  }
  const childIds = new Set(Object.keys(parents))
  const parentIds = new Set(Object.values(parents))
  for (const childId of childIds) {
    if (parentIds.has(childId)) fail('affiliated presets may not own children')
  }

  if (!isRecord(input.ui)) fail('ui must be an object')
  const view = requireString(input.ui.view, 'ui.view')
  const match = requireString(input.ui.match, 'ui.match')
  const sort = requireString(input.ui.sort, 'ui.sort')
  if (!VIEWS.has(view)) fail('ui.view must be grid, list, or grouped')
  if (!MATCH_MODES.has(match)) fail('ui.match must be any or all')
  if (!SORT_MODES.has(sort)) fail('ui.sort must be name, id, or status')
  if (!Array.isArray(input.ui.collapsedTagIds)) fail('ui.collapsedTagIds must be an array')
  const collapsedTagIds = []
  const seenCollapsed = new Set()
  for (const value of input.ui.collapsedTagIds) {
    const tagId = requireString(value, 'ui.collapsedTagIds entry')
    if (!tagIds.has(tagId)) fail(`ui.collapsedTagIds references unknown tag ${tagId}`)
    if (seenCollapsed.has(tagId)) fail(`ui.collapsedTagIds contains duplicate tag ${tagId}`)
    seenCollapsed.add(tagId)
    collapsedTagIds.push(tagId)
  }
  const rawCollapsedPresetIds = sourceVersion === 1 ? [] : input.ui.collapsedPresetIds
  if (!Array.isArray(rawCollapsedPresetIds)) fail('ui.collapsedPresetIds must be an array')
  const collapsedPresetIds = []
  const seenCollapsedPresets = new Set()
  for (const value of rawCollapsedPresetIds) {
    const presetId = requireString(value, 'ui.collapsedPresetIds entry')
    if (!parentIds.has(presetId)) fail(`ui.collapsedPresetIds entry is not a parent: ${presetId}`)
    if (seenCollapsedPresets.has(presetId)) fail(`ui.collapsedPresetIds contains duplicate preset ${presetId}`)
    seenCollapsedPresets.add(presetId)
    collapsedPresetIds.push(presetId)
  }

  return {
    version: DOCUMENT_VERSION,
    revision: input.revision,
    tags,
    assignments,
    parents,
    ui: { view, match, sort, collapsedTagIds, collapsedPresetIds },
  }
}

function withPrunedPresetCollapse(document, parents) {
  const parentIds = new Set(Object.values(parents))
  return {
    ...document,
    parents,
    ui: {
      ...document.ui,
      collapsedPresetIds: document.ui.collapsedPresetIds.filter((id) => parentIds.has(id)),
    },
  }
}

export function setPresetParent(document, childId, parentId) {
  const current = validateDocument(document)
  if (!PRESET_ID.test(childId)) fail(`child preset id is invalid: ${childId}`)
  const parents = { ...current.parents }
  if (parentId === null) {
    delete parents[childId]
  } else {
    const checkedParentId = requireString(parentId, 'parent preset id')
    if (!PRESET_ID.test(checkedParentId)) fail(`parent preset id is invalid: ${checkedParentId}`)
    parents[childId] = checkedParentId
  }
  return validateDocument(withPrunedPresetCollapse(current, parents))
}

export function removePresetRelations(document, presetId) {
  const current = validateDocument(document)
  if (!PRESET_ID.test(presetId)) fail(`preset id is invalid: ${presetId}`)
  const parents = Object.fromEntries(Object.entries(current.parents)
    .filter(([childId, parentId]) => childId !== presetId && parentId !== presetId))
  return validateDocument(withPrunedPresetCollapse(current, parents))
}

export function removeTag(document, tagId) {
  const current = validateDocument(document)
  const tags = current.tags.filter((tag) => tag.id !== tagId)
  const assignments = {}
  for (const [presetId, assigned] of Object.entries(current.assignments)) {
    const kept = assigned.filter((id) => id !== tagId)
    if (kept.length > 0) assignments[presetId] = kept
  }
  return validateDocument({
    ...current,
    tags,
    assignments,
    ui: {
      ...current.ui,
      collapsedTagIds: current.ui.collapsedTagIds.filter((id) => id !== tagId),
    },
  })
}

export function removePresetAssignment(document, presetId) {
  const current = validateDocument(document)
  const assignments = { ...current.assignments }
  delete assignments[presetId]
  return validateDocument({ ...current, assignments })
}
