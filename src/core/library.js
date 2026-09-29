function fold(value) {
  return String(value ?? '').trim().toLocaleLowerCase()
}

function displayName(row) {
  return row.name?.trim() || row.id
}

export function decorateRoster(presets, document) {
  const tagsById = new Map(document.tags.map((tag) => [tag.id, tag]))
  const presetsById = new Map(presets.map((preset) => [preset.id, preset]))
  return presets.map((preset) => {
    const tagIds = [...(document.assignments[preset.id] ?? [])]
    const parentId = document.parents[preset.id]
    const parent = parentId ? presetsById.get(parentId) : undefined
    return {
      ...preset,
      tagIds,
      tags: tagIds.map((id) => tagsById.get(id)).filter(Boolean),
      parentId,
      parentName: parent ? displayName(parent) : undefined,
    }
  })
}

function matchesStatus(row, status) {
  if (status === 'all') return true
  if (status === 'default') return row.isDefault === true
  if (status === 'broken') return row.broken !== undefined
  if (status === 'untagged') return row.tagIds.length === 0
  return true
}

function matchesTags(row, selectedTagIds, match) {
  if (selectedTagIds.length === 0) return true
  const owned = new Set(row.tagIds)
  return match === 'all'
    ? selectedTagIds.every((tagId) => owned.has(tagId))
    : selectedTagIds.some((tagId) => owned.has(tagId))
}

function compareName(left, right) {
  return displayName(left).localeCompare(displayName(right), undefined, { sensitivity: 'base' })
    || left.id.localeCompare(right.id)
}

function statusRank(row) {
  if (row.isDefault) return -1
  if (row.broken !== undefined) return 3
  return 0
}

function sorter(mode) {
  if (mode === 'id') return (left, right) => left.id.localeCompare(right.id)
  if (mode === 'status') {
    return (left, right) => statusRank(left) - statusRank(right) || compareName(left, right)
  }
  return compareName
}

export function projectLibrary(presets, document, filters) {
  const query = fold(filters.query)
  const selectedTagIds = Array.isArray(filters.selectedTagIds) ? filters.selectedTagIds : []
  const rows = decorateRoster(presets, document).filter((row) => {
    if (!matchesStatus(row, filters.status ?? 'all')) return false
    if (!matchesTags(row, selectedTagIds, filters.match ?? 'any')) return false
    if (query === '') return true
    const haystack = [
      row.id,
      displayName(row),
      row.description ?? '',
      ...row.tags.map((tag) => tag.name),
    ].map(fold).join('\n')
    return haystack.includes(query)
  })
  return rows.sort(sorter(filters.sort ?? 'name'))
}

export function buildPresetFamilies(rows, document, { respectCollapse = true } = {}) {
  const visibleIds = new Set(rows.map((row) => row.id))
  const childrenByParent = new Map()
  for (const row of rows) {
    if (!row.parentId || !visibleIds.has(row.parentId)) continue
    const children = childrenByParent.get(row.parentId) ?? []
    children.push(row)
    childrenByParent.set(row.parentId, children)
  }
  return rows
    .filter((row) => !row.parentId || !visibleIds.has(row.parentId))
    .map((root) => {
      const allChildren = childrenByParent.get(root.id) ?? []
      const collapsed = respectCollapse
        && allChildren.length > 0
        && document.ui.collapsedPresetIds.includes(root.id)
      return {
        root,
        children: collapsed ? [] : allChildren,
        childCount: allChildren.length,
        collapsed,
      }
    })
}

export function groupLibrary(rows, document) {
  const groups = document.tags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    color: tag.color,
    rows: rows.filter((row) => row.tagIds.includes(tag.id)),
  }))
  const untagged = rows.filter((row) => row.tagIds.length === 0)
  if (untagged.length > 0) {
    groups.push({ id: '__untagged__', name: 'Untagged', color: 'gray', rows: untagged })
  }
  return groups
}

export function tagCounts(rows, document) {
  const counts = Object.fromEntries(document.tags.map((tag) => [tag.id, 0]))
  for (const row of rows) {
    for (const tagId of row.tagIds) {
      if (tagId in counts) counts[tagId] += 1
    }
  }
  return counts
}
