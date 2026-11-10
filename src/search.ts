// Find-in-document helpers. Matches are per text node — a query spanning
// element boundaries (e.g. across <strong> tags) is not found.

export function findMatches(text: string, query: string): number[] {
  if (!query) return []
  const hay = text.toLowerCase()
  const needle = query.toLowerCase()
  const positions: number[] = []
  let i = hay.indexOf(needle)
  while (i !== -1) {
    positions.push(i)
    i = hay.indexOf(needle, i + needle.length)
  }
  return positions
}

export function applyHighlights(root: HTMLElement, query: string): HTMLElement[] {
  const marks: HTMLElement[] = []
  // Unwrap before any early return — closeFind passes an empty query and
  // still needs stale marks removed; re-applies without a syncUi re-render
  // (find-input keystrokes) also need this or marks nest
  root.querySelectorAll('mark.hl').forEach((mark) => {
    mark.replaceWith(document.createTextNode(mark.textContent ?? ''))
  })
  root.normalize()
  if (!query) return marks
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let node = walker.nextNode()
  while (node) {
    nodes.push(node as Text)
    node = walker.nextNode()
  }
  for (const textNode of nodes) {
    const positions = findMatches(textNode.data, query)
    if (positions.length === 0) continue
    const frag = document.createDocumentFragment()
    let cursor = 0
    for (const pos of positions) {
      if (pos > cursor) frag.appendChild(document.createTextNode(textNode.data.slice(cursor, pos)))
      const mark = document.createElement('mark')
      mark.className = 'hl'
      mark.textContent = textNode.data.slice(pos, pos + query.length)
      frag.appendChild(mark)
      marks.push(mark)
      cursor = pos + query.length
    }
    if (cursor < textNode.data.length) {
      frag.appendChild(document.createTextNode(textNode.data.slice(cursor)))
    }
    textNode.parentNode?.replaceChild(frag, textNode)
  }
  return marks
}
