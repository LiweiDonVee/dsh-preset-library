const SVG_NS = 'http://www.w3.org/2000/svg'
const ATTRIBUTE_NAMES = {
  className: 'class',
  clipRule: 'clip-rule',
  fillRule: 'fill-rule',
  strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin',
  strokeWidth: 'stroke-width',
}

function materialize(element, document, namespace = SVG_NS) {
  if (element === null || element === undefined || typeof element === 'boolean') return null
  if (typeof element === 'string' || typeof element === 'number') {
    return document.createTextNode(String(element))
  }
  if (Array.isArray(element)) {
    const fragment = document.createDocumentFragment()
    for (const child of element) {
      const node = materialize(child, document, namespace)
      if (node) fragment.appendChild(node)
    }
    return fragment
  }
  if (typeof element.type === 'function') {
    return materialize(element.type(element.props), document, namespace)
  }
  if (typeof element.type !== 'string') return null

  const nextNamespace = element.type === 'svg' ? SVG_NS : namespace
  const node = document.createElementNS(nextNamespace, element.type)
  for (const [key, value] of Object.entries(element.props ?? {})) {
    if (key === 'children' || key === 'key' || key === 'ref' || value === undefined || value === null || value === false) continue
    const name = ATTRIBUTE_NAMES[key] ?? key
    node.setAttribute(name, value === true ? '' : String(value))
  }
  const children = materialize(element.props?.children, document, nextNamespace)
  if (children) node.appendChild(children)
  return node
}

function navButton(document, label) {
  for (const button of document.querySelectorAll('[role="dialog"] nav button')) {
    const text = [...button.children].find((child) => child.tagName === 'SPAN')?.textContent?.trim()
    if (text === label) return button
  }
  return null
}

export function installLibraryNavIcon(document, getLabel, Icon) {
  const MutationObserver = document.defaultView?.MutationObserver
  if (!MutationObserver) return () => {}

  let queued = false
  const sync = () => {
    queued = false
    const button = navButton(document, getLabel())
    if (!button || button.querySelector('svg[data-preset-library-icon]')) return
    const current = button.querySelector('svg')
    const replacement = materialize(Icon({ size: 16 }), document)
    if (!current || !replacement) return
    replacement.setAttribute('class', current.getAttribute('class') ?? '')
    replacement.setAttribute('aria-hidden', 'true')
    replacement.setAttribute('data-preset-library-icon', '')
    current.replaceWith(replacement)
    button.setAttribute('data-preset-library-nav', '')
  }
  const schedule = () => {
    if (queued) return
    queued = true
    queueMicrotask(sync)
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, characterData: true, subtree: true })
  sync()
  return () => observer.disconnect()
}
