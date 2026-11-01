import MarkdownIt from 'markdown-it'

// html:false keeps raw HTML in user files escaped (XSS-safe by default)
const md = new MarkdownIt({ html: false, linkify: true })

export function renderMarkdown(source: string): string {
  return md.render(source)
}
