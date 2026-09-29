import React, { useCallback, useEffect, useMemo, useState } from 'react'

import {
  createEmptyDocument,
  removeTag,
  setPresetParent,
} from '../core/document.js'
import { buildPresetFamilies, decorateRoster, groupLibrary, projectLibrary, tagCounts } from '../core/library.js'
import {
  ClientApiError,
  listBundles,
  listPluginInventory,
  loadMetadata,
  readRoster,
  saveMetadata,
  setBundleEnabled,
  setDefaultPreset,
} from './api.js'
import {
  IconCheck,
  IconBranch,
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconEdit,
  IconFolder,
  IconGrid,
  IconList,
  IconLibrary,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconWarning,
} from './icons.jsx'

const STATUS_FILTERS = [
  ['all', 'status.all'],
  ['default', 'status.default'],
  ['broken', 'status.broken'],
  ['untagged', 'status.untagged'],
]

const COLOR_LABELS = {
  green: 'color.green',
  blue: 'color.blue',
  cyan: 'color.cyan',
  yellow: 'color.yellow',
  red: 'color.red',
  gray: 'color.gray',
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function displayName(row) {
  return row.name?.trim() || row.id
}

function cloneDocument(document) {
  return JSON.parse(JSON.stringify(document))
}

function makeTagId(name) {
  const stem = name
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24) || 'tag'
  const suffix = Math.random().toString(36).slice(2, 10).padEnd(8, '0')
  return `tag-${stem}-${suffix}`
}

function IconButton({ label, danger = false, disabled = false, onClick, children }) {
  return (
    <button
      type="button"
      className={`pl-icon-button${danger ? ' pl-icon-danger' : ''}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function SegmentedButton({ active, label, onClick, disabled = false, children }) {
  return (
    <button
      type="button"
      className={`pl-segment${active ? ' is-active' : ''}`}
      aria-pressed={active}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function TagPill({ tag }) {
  return <span className="pl-tag-pill" data-color={tag.color}>{tag.name}</span>
}

function Modal({ t, title, onClose, children, footer }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="pl-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="pl-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="pl-modal-head">
          <h3>{title}</h3>
          <IconButton label={t('close')} onClick={onClose}><IconClose size={16} /></IconButton>
        </header>
        <div className="pl-modal-body">{children}</div>
        {footer ? <footer className="pl-modal-foot">{footer}</footer> : null}
      </section>
    </div>
  )
}

function TagDialog({ t, document, editing, onClose, onDelete, onSave, busy }) {
  const [name, setName] = useState(editing?.name ?? '')
  const [color, setColor] = useState(editing?.color ?? 'green')
  const trimmed = name.trim()
  const duplicate = document.tags.some((tag) => tag.id !== editing?.id && tag.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())
  const valid = trimmed.length > 0 && trimmed.length <= 40 && !duplicate
  const title = t(editing ? 'tag.edit' : 'tag.create')

  return (
    <Modal
      t={t}
      title={title}
      onClose={onClose}
      footer={(
        <>
          {editing ? (
            <button type="button" className="pl-button danger pl-modal-delete" disabled={busy} onClick={onDelete}>
              {t('tag.delete')}
            </button>
          ) : null}
          <button type="button" className="pl-button secondary" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="pl-button primary" disabled={!valid || busy} onClick={() => onSave({ name: trimmed, color })}>
            {t(busy ? 'saving' : 'save')}
          </button>
        </>
      )}
    >
      <label className="pl-field">
        <span>{t('tag.name')}</span>
        <input autoFocus value={name} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder={t('tag.namePlaceholder')} />
      </label>
      {duplicate ? <p className="pl-field-error">{t('tag.duplicate')}</p> : null}
      <fieldset className="pl-color-field">
        <legend>{t('tag.color')}</legend>
        <div className="pl-color-grid">
          {Object.entries(COLOR_LABELS).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`pl-color-option${color === value ? ' is-active' : ''}`}
              aria-pressed={color === value}
              onClick={() => setColor(value)}
            >
              <span className="pl-color-swatch" data-color={value} />
              {t(label)}
            </button>
          ))}
        </div>
      </fieldset>
    </Modal>
  )
}

function AssignmentDialog({ t, mode, presetIds, document, onClose, onApply, busy }) {
  const initial = mode === 'edit' ? document.assignments[presetIds[0]] ?? [] : []
  const [selected, setSelected] = useState(() => new Set(initial))
  const title = mode === 'edit'
    ? t('assignment.edit')
    : t(mode === 'add' ? 'assignment.add' : 'assignment.remove', { count: presetIds.length })
  const canSave = mode === 'edit' || selected.size > 0

  return (
    <Modal
      t={t}
      title={title}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="pl-button secondary" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="pl-button primary" disabled={!canSave || busy} onClick={() => onApply([...selected])}>
            {t(busy ? 'applying' : 'apply')}
          </button>
        </>
      )}
    >
      {document.tags.length === 0 ? (
        <p className="pl-muted">{t('assignment.empty')}</p>
      ) : (
        <div className="pl-assignment-list">
          {document.tags.map((tag) => (
            <label key={tag.id} className="pl-check-row">
              <input
                type="checkbox"
                checked={selected.has(tag.id)}
                onChange={() => setSelected((current) => {
                  const next = new Set(current)
                  if (next.has(tag.id)) next.delete(tag.id)
                  else next.add(tag.id)
                  return next
                })}
              />
              <span className="pl-color-swatch" data-color={tag.color} />
              <span>{tag.name}</span>
            </label>
          ))}
        </div>
      )}
    </Modal>
  )
}

function AffiliationDialog({ t, row, roster, document, onClose, onSave, busy }) {
  const currentParentId = document.parents[row.id] ?? ''
  const [parentId, setParentId] = useState(currentParentId)
  const [query, setQuery] = useState('')
  const childIds = useMemo(() => new Set(Object.keys(document.parents)), [document.parents])
  const currentParentAvailable = roster.presets.some((preset) => preset.id === currentParentId)
  const foldedQuery = query.trim().toLocaleLowerCase()
  const candidates = roster.presets.filter((candidate) => {
    if (candidate.id === row.id || childIds.has(candidate.id)) return false
    if (!foldedQuery) return true
    return [candidate.id, displayName(candidate), candidate.description ?? '']
      .some((value) => value.toLocaleLowerCase().includes(foldedQuery))
  })

  return (
    <Modal
      t={t}
      title={t('affiliation.title', { name: displayName(row) })}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="pl-button secondary" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="pl-button primary" disabled={busy} onClick={() => onSave(parentId || null)}>
            {t(busy ? 'saving' : 'save')}
          </button>
        </>
      )}
    >
      <label className="pl-affiliation-search">
        <IconSearch size={16} />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('affiliation.searchPlaceholder')}
        />
      </label>
      <div className="pl-parent-options" role="radiogroup" aria-label={t('affiliation.title', { name: displayName(row) })}>
        <label className="pl-parent-option">
          <input type="radio" name="preset-parent" value="" checked={parentId === ''} onChange={() => setParentId('')} />
          <span className="pl-parent-option-copy">
            <strong>{t('affiliation.topLevel')}</strong>
          </span>
        </label>
        {currentParentId && !currentParentAvailable ? (
          <label className="pl-parent-option is-unavailable">
            <input
              type="radio"
              name="preset-parent"
              value={currentParentId}
              checked={parentId === currentParentId}
              onChange={() => setParentId(currentParentId)}
            />
            <span className="pl-parent-option-copy">
              <strong>{t('affiliation.unavailable', { id: currentParentId })}</strong>
            </span>
          </label>
        ) : null}
        {candidates.map((candidate) => (
          <label key={candidate.id} className="pl-parent-option">
            <input
              type="radio"
              name="preset-parent"
              value={candidate.id}
              checked={parentId === candidate.id}
              onChange={() => setParentId(candidate.id)}
            />
            <span className="pl-parent-option-copy">
              <strong>{displayName(candidate)}</strong>
              <code>{candidate.id}</code>
            </span>
          </label>
        ))}
        {candidates.length === 0 ? <p className="pl-parent-empty">{t('affiliation.empty')}</p> : null}
      </div>
    </Modal>
  )
}

function ConfirmDialog({ t, title, body, confirmLabel, danger = false, onClose, onConfirm, busy }) {
  return (
    <Modal
      t={t}
      title={title}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="pl-button secondary" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className={`pl-button ${danger ? 'danger' : 'primary'}`} disabled={busy} onClick={onConfirm}>
            {busy ? t('processing') : confirmLabel}
          </button>
        </>
      )}
    >
      <p className="pl-confirm-copy">{body}</p>
    </Modal>
  )
}

function PresetActions({
  t,
  row,
  busy,
  readOnly,
  ownedParentIds,
  onEditTags,
  onAffiliation,
  onDefault,
}) {
  const ownsChildren = ownedParentIds.has(row.id)
  const affiliationLabel = t(ownsChildren ? 'affiliation.blocked' : 'affiliation.action')
  return (
    <div className="pl-actions">
      <IconButton label={t('action.editTags')} disabled={busy} onClick={() => onEditTags(row)}><IconEdit size={16} /></IconButton>
      <IconButton label={affiliationLabel} disabled={busy || readOnly || ownsChildren} onClick={() => onAffiliation(row)}><IconBranch size={16} /></IconButton>
      <IconButton label={t(row.isDefault ? 'action.currentDefault' : 'action.setDefault')} disabled={busy || row.isDefault || row.broken !== undefined} onClick={() => onDefault(row)}>
        <IconCheck size={16} />
      </IconButton>
    </div>
  )
}

export function BundleSection({ t, bundles, inventory, busy, onToggle }) {
  const managementAvailable = inventory?.managementAvailable === true
  return (
    <section className="pl-bundles" aria-label={t('bundle.title')}>
      <h3>{t('bundle.title')}</h3>
      <p>{t('bundle.description')}</p>
      {bundles.length === 0 ? <p className="pl-muted">{t('bundle.empty')}</p> : (
        <ul className="pl-bundle-list">
          {bundles.map((bundle) => {
            const readOnly = !managementAvailable || Boolean(bundle.readOnlyReason) || Boolean(bundle.error && !bundle.enabled)
            return (
              <li key={bundle.name} className="pl-bundle-row">
                <div>
                  <strong>{bundle.name}</strong>{bundle.version ? <span> {bundle.version}</span> : null}
                  <p>{bundle.description || t('bundle.noDescription')}</p>
                  <small>{t('bundle.rows', { count: bundle.rows.length })}{bundle.error ? ` · ${bundle.error.code}` : ''}</small>
                </div>
                <label title={readOnly ? t('bundle.readOnly') : t('bundle.toggle')}>
                  <span className="pl-sr-only">{t('bundle.toggleNamed', { name: bundle.name })}</span>
                  <input type="checkbox" checked={bundle.enabled} disabled={busy || readOnly} onChange={() => onToggle(bundle)} />
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function FamilyDisclosure({ t, row, family, collapsible, onToggle }) {
  if (!family || family.childCount === 0) return null
  const label = t(family.collapsed ? 'affiliation.expand' : 'affiliation.collapse', {
    name: displayName(row),
    count: family.childCount,
  })
  if (!collapsible) {
    return (
      <span className="pl-family-disclosure is-static" aria-label={label} title={label}>
        <IconBranch size={14} />
      </span>
    )
  }
  return (
    <button
      type="button"
      className="pl-family-disclosure"
      aria-expanded={!family.collapsed}
      aria-label={label}
      title={label}
      onClick={() => onToggle(row.id)}
    >
      {family.collapsed ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}
    </button>
  )
}

function PresetHead({ t, row, selected, onSelect, family, familyCollapsible, onToggleFamily }) {
  return (
    <div className="pl-preset-head">
      <label className="pl-select-box" title={t('preset.select')}>
        <input type="checkbox" checked={selected} onChange={() => onSelect(row.id)} aria-label={t('preset.selectNamed', { name: displayName(row) })} />
      </label>
      <FamilyDisclosure t={t} row={row} family={family} collapsible={familyCollapsible} onToggle={onToggleFamily} />
      <div className="pl-preset-title-wrap">
        <div className="pl-preset-name-line">
          <div className="pl-preset-name" title={displayName(row)}>{displayName(row)}</div>
          {family?.childCount > 0 ? <span className="pl-child-count">{t('affiliation.childCount', { count: family.childCount })}</span> : null}
        </div>
        <code>{row.id}</code>
      </div>
      {row.isDefault ? <span className="pl-status-badge default">{t('preset.default')}</span> : null}
      {row.broken !== undefined ? <span className="pl-status-badge broken">{t('preset.broken')}</span> : null}
    </div>
  )
}

function AffiliationNote({ t, row }) {
  if (!row.parentId) return null
  return <span className="pl-affiliation-note"><IconBranch size={14} />{t('affiliation.attachedTo', { name: row.parentName ?? row.parentId })}</span>
}

function PresetTags({ t, row }) {
  return (
    <div className="pl-preset-tags">
      {row.tags.length > 0 ? row.tags.map((tag) => <TagPill key={tag.id} tag={tag} />) : <span className="pl-untagged">{t('preset.untagged')}</span>}
    </div>
  )
}

function PresetCard({ row, family, contained = false, child = false, showAffiliation = false, ...props }) {
  const Card = contained ? 'article' : 'li'
  return (
    <Card className={`pl-card${child ? ' is-child' : ''}${props.selected.has(row.id) ? ' is-selected' : ''}${row.broken !== undefined ? ' is-broken' : ''}`}>
      <PresetHead
        t={props.t}
        row={row}
        selected={props.selected.has(row.id)}
        onSelect={props.onSelect}
        family={family}
        familyCollapsible={props.familyCollapsible}
        onToggleFamily={props.onToggleFamily}
      />
      <p className="pl-description" title={row.description ?? ''}>{row.description || props.t('preset.noDescription')}</p>
      {row.broken !== undefined ? <p className="pl-broken-reason">{row.broken}</p> : null}
      {showAffiliation ? <AffiliationNote t={props.t} row={row} /> : null}
      <PresetTags t={props.t} row={row} />
      <PresetActions {...props} row={row} />
    </Card>
  )
}

function GridView(props) {
  const families = buildPresetFamilies(props.rows, props.document, { respectCollapse: props.familyCollapsible })
  return (
    <ul className="pl-grid">
      {families.map((family) => family.childCount > 0 ? (
        <li key={family.root.id} className="pl-grid-family">
          <PresetCard {...props} row={family.root} family={family} contained />
          {family.children.length > 0 ? (
            <ul className="pl-grid-children">
              {family.children.map((row) => <PresetCard key={row.id} {...props} row={row} child />)}
            </ul>
          ) : null}
        </li>
      ) : (
        <PresetCard key={family.root.id} {...props} row={family.root} showAffiliation={Boolean(family.root.parentId)} />
      ))}
    </ul>
  )
}

function PresetListRow({ row, family, child = false, showAffiliation = false, ...props }) {
  return (
    <li className={`pl-list-row${child ? ' is-child' : ''}${props.selected.has(row.id) ? ' is-selected' : ''}${row.broken !== undefined ? ' is-broken' : ''}`}>
      <PresetHead
        t={props.t}
        row={row}
        selected={props.selected.has(row.id)}
        onSelect={props.onSelect}
        family={family}
        familyCollapsible={props.familyCollapsible}
        onToggleFamily={props.onToggleFamily}
      />
      <div className="pl-list-description" title={row.broken ?? row.description ?? ''}>
        <span>{row.broken ?? row.description ?? props.t('preset.noDescription')}</span>
        {showAffiliation ? <AffiliationNote t={props.t} row={row} /> : null}
      </div>
      <PresetTags t={props.t} row={row} />
      <PresetActions {...props} row={row} />
    </li>
  )
}

function ListView(props) {
  const families = buildPresetFamilies(props.rows, props.document, { respectCollapse: props.familyCollapsible })
  return (
    <ul className="pl-list">
      {families.map((family) => (
        <React.Fragment key={family.root.id}>
          <PresetListRow {...props} row={family.root} family={family} showAffiliation={Boolean(family.root.parentId)} />
          {family.children.map((row) => <PresetListRow key={row.id} {...props} row={row} child />)}
        </React.Fragment>
      ))}
    </ul>
  )
}

function GroupedView({ t, document, onToggleGroup, ...props }) {
  const groups = groupLibrary(props.rows, document).filter((group) => group.rows.length > 0)
  return (
    <div className="pl-groups">
      {groups.map((group) => {
        const collapsed = group.id !== '__untagged__' && document.ui.collapsedTagIds.includes(group.id)
        const groupName = group.id === '__untagged__' ? t('preset.untagged') : group.name
        return (
          <section key={group.id} className="pl-group">
            <button type="button" className="pl-group-head" onClick={() => onToggleGroup(group.id)} aria-expanded={!collapsed}>
              {collapsed ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}
              <span className="pl-color-swatch" data-color={group.color} />
              <span>{groupName}</span>
              <span className="pl-group-count">{group.rows.length}</span>
            </button>
            {collapsed ? null : <ListView {...props} t={t} document={document} rows={group.rows} />}
          </section>
        )
      })}
    </div>
  )
}

export function PresetLibrary({ api, t }) {
  const [documentState, setDocumentState] = useState(createEmptyDocument)
  const [roster, setRoster] = useState({ presets: [] })
  const [bundles, setBundles] = useState([])
  const [inventory, setInventory] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [readOnly, setReadOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedTagIds, setSelectedTagIds] = useState([])
  const [selectedPresetIds, setSelectedPresetIds] = useState(() => new Set())
  const [modal, setModal] = useState(null)

  const reload = useCallback(async ({ preserve = false } = {}) => {
    setLoading(!preserve)
    setError(null)
    const [rosterResult, metadataResult, bundleResult, inventoryResult] = await Promise.allSettled([
      readRoster(api),
      loadMetadata(),
      listBundles(api),
      listPluginInventory(api),
    ])
    if (rosterResult.status === 'fulfilled') setRoster(rosterResult.value)
    else setError(t('error.roster', { message: messageOf(rosterResult.reason) }))
    if (metadataResult.status === 'fulfilled') {
      setDocumentState(metadataResult.value)
      setReadOnly(false)
    } else {
      const reason = metadataResult.reason
      const path = reason instanceof ClientApiError ? reason.details?.path : undefined
      setReadOnly(reason instanceof ClientApiError && reason.details?.readOnly === true)
      setError(t('error.metadata', {
        message: messageOf(reason),
        path: path ? ` (${path})` : '',
      }))
    }
    if (bundleResult.status === 'fulfilled') setBundles(bundleResult.value)
    else setError(t('error.bundles', { message: messageOf(bundleResult.reason) }))
    if (inventoryResult.status === 'fulfilled') setInventory(inventoryResult.value)
    else setError(t('error.inventory', { message: messageOf(inventoryResult.reason) }))
    setLoading(false)
  }, [api, t])

  useEffect(() => { reload() }, [reload])

  useEffect(() => {
    const existing = new Set(roster.presets.map((preset) => preset.id))
    setSelectedPresetIds((current) => new Set([...current].filter((id) => existing.has(id))))
  }, [roster.presets])

  useEffect(() => {
    const existing = new Set(documentState.tags.map((tag) => tag.id))
    setSelectedTagIds((current) => current.filter((id) => existing.has(id)))
  }, [documentState.tags])

  const commit = useCallback(async (nextDocument, successMessage) => {
    if (readOnly) return false
    setBusy(true)
    setError(null)
    try {
      const saved = await saveMetadata(nextDocument, documentState.revision)
      setDocumentState(saved)
      if (successMessage) setNotice(successMessage)
      return true
    } catch (reason) {
      if (reason instanceof ClientApiError && reason.status === 409) {
        setError(t('error.conflict'))
        await reload({ preserve: true })
      } else {
        setError(messageOf(reason))
      }
      return false
    } finally {
      setBusy(false)
    }
  }, [documentState.revision, readOnly, reload, t])

  const decorated = useMemo(() => decorateRoster(roster.presets, documentState), [roster.presets, documentState])
  const rows = useMemo(() => projectLibrary(roster.presets, documentState, {
    query,
    selectedTagIds,
    match: documentState.ui.match,
    status: statusFilter,
    sort: documentState.ui.sort,
  }), [roster.presets, documentState, query, selectedTagIds, statusFilter])
  const counts = useMemo(() => tagCounts(decorated, documentState), [decorated, documentState])
  const ownedParentIds = useMemo(() => new Set(Object.values(documentState.parents)), [documentState.parents])
  const familyCollapsible = query.trim() === '' && selectedTagIds.length === 0 && statusFilter === 'all'

  const updateUi = async (patch) => {
    const next = cloneDocument(documentState)
    next.ui = { ...next.ui, ...patch }
    await commit(next)
  }

  const toggleTagFilter = (tagId) => {
    setSelectedTagIds((current) => current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId])
  }

  const togglePreset = (presetId) => {
    setSelectedPresetIds((current) => {
      const next = new Set(current)
      if (next.has(presetId)) next.delete(presetId)
      else next.add(presetId)
      return next
    })
  }

  const saveTag = async ({ name, color }) => {
    const next = cloneDocument(documentState)
    if (modal?.tag) {
      next.tags = next.tags.map((tag) => tag.id === modal.tag.id ? { ...tag, name, color } : tag)
    } else {
      next.tags.push({ id: makeTagId(name), name, color })
    }
    if (await commit(next, t(modal?.tag ? 'notice.tagUpdated' : 'notice.tagCreated'))) setModal(null)
  }

  const deleteTag = async (tag) => {
    if (await commit(removeTag(documentState, tag.id), t('notice.tagDeleted', { name: tag.name }))) {
      setModal(null)
      setSelectedTagIds((current) => current.filter((id) => id !== tag.id))
    }
  }

  const applyAssignments = async (tagIds) => {
    const next = cloneDocument(documentState)
    const presetIds = modal.presetIds
    for (const presetId of presetIds) {
      const current = new Set(next.assignments[presetId] ?? [])
      if (modal.mode === 'edit') {
        if (tagIds.length > 0) next.assignments[presetId] = [...tagIds]
        else delete next.assignments[presetId]
      } else if (modal.mode === 'add') {
        for (const tagId of tagIds) current.add(tagId)
        next.assignments[presetId] = [...current]
      } else {
        for (const tagId of tagIds) current.delete(tagId)
        if (current.size > 0) next.assignments[presetId] = [...current]
        else delete next.assignments[presetId]
      }
    }
    if (await commit(next, t('notice.assignments'))) setModal(null)
  }

  const saveAffiliation = async (parentId) => {
    const next = setPresetParent(documentState, modal.row.id, parentId)
    if (await commit(next, t('affiliation.saved', { name: displayName(modal.row) }))) setModal(null)
  }

  const handleDefault = async (row) => {
    setBusy(true)
    setError(null)
    try {
      await setDefaultPreset(api, row.id)
      setRoster(await readRoster(api))
      setNotice(t('notice.default', { name: displayName(row) }))
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  const handleBundleToggle = async (bundle) => {
    setBusy(true)
    setError(null)
    try {
      const result = await setBundleEnabled(api, bundle.name, !bundle.enabled)
      setBundles(await listBundles(api))
      setInventory(await listPluginInventory(api))
      setRoster(await readRoster(api))
      setNotice(t(result.application === 'restart-required' ? 'notice.bundleRestart' : 'notice.bundleChanged', { name: bundle.name }))
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  const toggleGroup = async (tagId) => {
    if (tagId === '__untagged__') return
    const collapsed = new Set(documentState.ui.collapsedTagIds)
    if (collapsed.has(tagId)) collapsed.delete(tagId)
    else collapsed.add(tagId)
    await updateUi({ collapsedTagIds: [...collapsed] })
  }

  const toggleFamily = async (presetId) => {
    if (!familyCollapsible) return
    const collapsed = new Set(documentState.ui.collapsedPresetIds)
    if (collapsed.has(presetId)) collapsed.delete(presetId)
    else collapsed.add(presetId)
    await updateUi({ collapsedPresetIds: [...collapsed] })
  }

  const viewProps = {
    t,
    rows,
    document: documentState,
    roster,
    busy,
    readOnly,
    ownedParentIds,
    familyCollapsible,
    onToggleFamily: toggleFamily,
    selected: selectedPresetIds,
    onSelect: togglePreset,
    onEditTags: (row) => setModal({ type: 'assign', mode: 'edit', presetIds: [row.id] }),
    onAffiliation: (row) => setModal({ type: 'affiliation', row }),
    onDefault: handleDefault,
  }

  return (
    <div className="pl-page">
      <header className="pl-page-head">
        <div>
          <h2><IconLibrary size={18} />{t('title')}</h2>
          <p>{t('subtitle')}</p>
        </div>
        <IconButton label={t('refresh')} disabled={loading || busy} onClick={() => reload({ preserve: true })}><IconRefresh size={16} /></IconButton>
      </header>

      {error ? <div className="pl-banner error" role="alert"><IconWarning size={16} /><span>{error}</span></div> : null}
      {notice ? <div className="pl-banner notice" role="status"><IconCheck size={16} /><span>{notice}</span><IconButton label={t('notice.close')} onClick={() => setNotice(null)}><IconClose size={16} /></IconButton></div> : null}
      {readOnly ? <div className="pl-readonly">{t('readOnly')}</div> : null}

      <div className="pl-toolbar">
        <label className="pl-search">
          <IconSearch size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search.placeholder')} />
        </label>
        <span className="pl-result-count">{rows.length} / {roster.presets.length}</span>
        <label className="pl-sort">
          <span className="pl-sr-only">{t('sort.label')}</span>
          <select value={documentState.ui.sort} disabled={busy || readOnly} onChange={(event) => updateUi({ sort: event.target.value })}>
            <option value="name">{t('sort.name')}</option>
            <option value="id">{t('sort.id')}</option>
            <option value="status">{t('sort.status')}</option>
          </select>
        </label>
        <div className="pl-view-switch" aria-label={t('view.label')}>
          <SegmentedButton label={t('view.grid')} active={documentState.ui.view === 'grid'} disabled={busy || readOnly} onClick={() => updateUi({ view: 'grid' })}><IconGrid size={16} /></SegmentedButton>
          <SegmentedButton label={t('view.list')} active={documentState.ui.view === 'list'} disabled={busy || readOnly} onClick={() => updateUi({ view: 'list' })}><IconList size={16} /></SegmentedButton>
          <SegmentedButton label={t('view.grouped')} active={documentState.ui.view === 'grouped'} disabled={busy || readOnly} onClick={() => updateUi({ view: 'grouped' })}><IconFolder size={16} /></SegmentedButton>
        </div>
      </div>

      <div className="pl-shell">
        <aside className="pl-sidebar" aria-label={t('filter.label')}>
          <div className="pl-side-heading">
            <span>{t('filter.tags')}</span>
            <IconButton label={t('tag.create')} disabled={busy || readOnly} onClick={() => setModal({ type: 'tag', tag: null })}><IconPlus size={16} /></IconButton>
          </div>
          <div className="pl-match-switch" aria-label={t('filter.match')}>
            <button type="button" className={documentState.ui.match === 'any' ? 'is-active' : ''} disabled={busy || readOnly} onClick={() => updateUi({ match: 'any' })}>{t('filter.any')}</button>
            <button type="button" className={documentState.ui.match === 'all' ? 'is-active' : ''} disabled={busy || readOnly} onClick={() => updateUi({ match: 'all' })}>{t('filter.all')}</button>
          </div>
          <div className="pl-tag-filter-list">
            {documentState.tags.length === 0 ? <p className="pl-sidebar-empty">{t('tag.empty')}</p> : documentState.tags.map((tag) => (
              <div key={tag.id} className={`pl-tag-filter${selectedTagIds.includes(tag.id) ? ' is-active' : ''}`}>
                <button type="button" className="pl-tag-filter-main" aria-pressed={selectedTagIds.includes(tag.id)} onClick={() => toggleTagFilter(tag.id)}>
                  <span className="pl-color-swatch" data-color={tag.color} />
                  <span title={tag.name}>{tag.name}</span>
                  <span>{counts[tag.id] ?? 0}</span>
                </button>
                <IconButton label={t('tag.editNamed', { name: tag.name })} disabled={busy || readOnly} onClick={() => setModal({ type: 'tag', tag })}><IconEdit size={16} /></IconButton>
              </div>
            ))}
          </div>
          <div className="pl-side-heading status"><span>{t('filter.status')}</span></div>
          <div className="pl-status-list">
            {STATUS_FILTERS.map(([value, labelKey]) => {
              const count = value === 'all' ? decorated.length : decorated.filter((row) => {
                if (value === 'default') return row.isDefault === true
                if (value === 'broken') return row.broken !== undefined
                return row.tagIds.length === 0
              }).length
              return (
                <button key={value} type="button" className={statusFilter === value ? 'is-active' : ''} onClick={() => setStatusFilter(value)}>
                  <span>{t(labelKey)}</span><span>{count}</span>
                </button>
              )
            })}
          </div>
        </aside>

        <main className="pl-results" aria-busy={loading}>
          {loading ? <div className="pl-state">{t('state.loading')}</div> : null}
          {!loading && roster.presets.length === 0 ? <div className="pl-state">{t('state.empty')}</div> : null}
          {!loading && roster.presets.length > 0 && rows.length === 0 ? <div className="pl-state">{t('state.noResults')}</div> : null}
          {!loading && rows.length > 0 && documentState.ui.view === 'grid' ? <GridView {...viewProps} /> : null}
          {!loading && rows.length > 0 && documentState.ui.view === 'list' ? <ListView {...viewProps} /> : null}
          {!loading && rows.length > 0 && documentState.ui.view === 'grouped' ? <GroupedView {...viewProps} document={documentState} onToggleGroup={toggleGroup} /> : null}
        </main>
      </div>

      <BundleSection t={t} bundles={bundles} inventory={inventory} busy={busy} onToggle={handleBundleToggle} />

      {selectedPresetIds.size > 0 ? (
        <div className="pl-bulk-bar">
          <strong>{t('bulk.selected', { count: selectedPresetIds.size })}</strong>
          <button type="button" className="pl-button secondary" onClick={() => setSelectedPresetIds(new Set(rows.map((row) => row.id)))}>{t('bulk.selectResults')}</button>
          <button type="button" className="pl-button secondary" disabled={readOnly || documentState.tags.length === 0} onClick={() => setModal({ type: 'assign', mode: 'add', presetIds: [...selectedPresetIds] })}>{t('bulk.add')}</button>
          <button type="button" className="pl-button secondary" disabled={readOnly || documentState.tags.length === 0} onClick={() => setModal({ type: 'assign', mode: 'remove', presetIds: [...selectedPresetIds] })}>{t('bulk.remove')}</button>
          <IconButton label={t('bulk.clear')} onClick={() => setSelectedPresetIds(new Set())}><IconClose size={16} /></IconButton>
        </div>
      ) : null}

      {modal?.type === 'tag' ? (
        <TagDialog
          t={t}
          document={documentState}
          editing={modal.tag}
          busy={busy}
          onClose={() => setModal(null)}
          onDelete={modal.tag ? () => setModal({ type: 'delete-tag', tag: modal.tag }) : undefined}
          onSave={saveTag}
        />
      ) : null}
      {modal?.type === 'delete-tag' ? (
        <ConfirmDialog
          t={t}
          title={t('confirm.tagTitle')}
          body={t('confirm.tagBody', { name: modal.tag.name })}
          confirmLabel={t('confirm.tagAction')}
          danger
          busy={busy}
          onClose={() => setModal(null)}
          onConfirm={() => deleteTag(modal.tag)}
        />
      ) : null}
      {modal?.type === 'assign' ? (
        <AssignmentDialog {...modal} t={t} document={documentState} busy={busy} onClose={() => setModal(null)} onApply={applyAssignments} />
      ) : null}
      {modal?.type === 'affiliation' ? (
        <AffiliationDialog
          t={t}
          row={modal.row}
          roster={roster}
          document={documentState}
          busy={busy}
          onClose={() => setModal(null)}
          onSave={saveAffiliation}
        />
      ) : null}
    </div>
  )
}
