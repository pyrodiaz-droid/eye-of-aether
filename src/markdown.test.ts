import { describe, it, expect } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('escapes raw HTML instead of rendering it (XSS-safe)', () => {
    const out = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>')
    expect(out).not.toContain('<script>')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;script&gt;')
  })

  it('renders headings, lists and code blocks', () => {
    const out = renderMarkdown('# Title\n\n- a\n- b\n\n```js\nconst x = 1\n```')
    expect(out).toContain('<h1>Title</h1>')
    expect(out).toContain('<ul>')
    expect(out).toContain('<code class="language-js">')
  })

  it('renders emphasis and links', () => {
    const out = renderMarkdown('**bold** and *italic* and [site](https://example.com)')
    expect(out).toContain('<strong>bold</strong>')
    expect(out).toContain('<em>italic</em>')
    expect(out).toContain('<a href="https://example.com">')
  })

  it('linkifies bare URLs', () => {
    const out = renderMarkdown('see https://example.com here')
    expect(out).toContain('<a href="https://example.com">')
  })

  it('renders tables and blockquotes', () => {
    const out = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n> quoted')
    expect(out).toContain('<table>')
    expect(out).toContain('<blockquote>')
  })
})
