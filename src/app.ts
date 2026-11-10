import { invoke } from '@tauri-apps/api/core'
import { open, save, ask, message } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { openUrl } from '@tauri-apps/plugin-opener'
import { renderMarkdown } from './markdown'
import { applyHighlights } from './search'

interface AppState {
  readonly filePath: string | null
  readonly text: string
  readonly dirty: boolean
  readonly mode: 'view' | 'edit'
}

const INITIAL_STATE: AppState = { filePath: null, text: '', dirty: false, mode: 'edit' }

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`missing element #${id}`)
  return el
}

const content = $('content')
const editor = $('editor') as HTMLTextAreaElement
const fileLabel = $('file-label')
const dirtyDot = $('dirty-dot')
const btnMode = $('btn-mode') as HTMLButtonElement
const btnSave = $('btn-save') as HTMLButtonElement
const findbar = $('findbar')
const findInput = $('find-input') as HTMLInputElement
const findCount = $('find-count')

let state: AppState = INITIAL_STATE

// Find-in-document state is module-local: the bar is self-contained and its
// keystrokes have no reason to flow through setState/syncUi
let searchQuery = ''
let matchEls: HTMLElement[] = []
let matchIndex = -1

// File passed on the command line — the only path the Rust write_back fallback serves
let argvPath: string | null = null

function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch }
  syncUi()
}

function visiblePane(): HTMLElement {
  return state.mode === 'view' ? content : editor
}

function syncUi(): void {
  const isView = state.mode === 'view'
  content.hidden = !isView
  editor.hidden = isView
  btnMode.textContent = isView ? 'Edit' : 'View'
  btnSave.disabled = !state.dirty
  dirtyDot.hidden = !state.dirty
  const name = (state.filePath ? fileNameFrom(state.filePath) : 'Untitled')
  fileLabel.textContent = name + (state.dirty ? ' — modified' : '')
  document.title = name
  if (isView) {
    content.innerHTML = renderMarkdown(state.text)
  } else if (editor.value !== state.text) {
    editor.value = state.text
  }
  refreshHighlights()
}

// Highlights are wiped by every syncUi re-render (innerHTML reset), so they
// are re-applied here after each render
function refreshHighlights(): void {
  matchEls = state.mode === 'view' ? applyHighlights(content, searchQuery) : []
  if (matchIndex >= matchEls.length) matchIndex = matchEls.length - 1
  matchEls.forEach((el, i) => el.classList.toggle('hl-current', i === matchIndex))
  findCount.textContent = matchEls.length > 0 ? `${matchIndex + 1}/${matchEls.length}` : ''
}

function gotoMatch(delta: number): void {
  if (matchEls.length === 0) return
  matchIndex = (matchIndex + delta + matchEls.length) % matchEls.length
  refreshHighlights()
  matchEls[matchIndex].scrollIntoView({ block: 'center' })
}

function openFind(): void {
  if (state.mode !== 'view') return
  findbar.hidden = false
  findInput.focus()
  findInput.select()
}

function closeFind(): void {
  findbar.hidden = true
  searchQuery = ''
  findInput.value = ''
  matchIndex = -1
  refreshHighlights()
  content.focus() // bar is gone — focus must not sit on a hidden button
}

function scrollRatio(pane: HTMLElement): number {
  const max = pane.scrollHeight - pane.clientHeight
  return max > 0 ? pane.scrollTop / max : 0
}

function toggleMode(): void {
  const before = visiblePane()
  const ratio = scrollRatio(before)
  const next = state.mode === 'view' ? 'edit' : 'view'
  setState({ mode: next })
  const after = visiblePane()
  const max = after.scrollHeight - after.clientHeight
  after.scrollTop = ratio * max
  if (next === 'edit') {
    if (!findbar.hidden) closeFind()
    editor.focus()
  }
}

function fileNameFrom(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

async function openPath(path: string): Promise<void> {
  try {
    const text = await readTextFile(path)
    setState({ filePath: path, text, dirty: false, mode: 'view' })
  } catch (err) {
    await alertError(`Could not open ${fileNameFrom(path)}`, err)
  }
}

async function openDialog(): Promise<void> {
  if (!(await confirmDiscard())) return
  const path = await open({
    multiple: false,
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] }],
  })
  if (path) await openPath(path)
}

async function writeAnywhere(target: string, text: string): Promise<void> {
  try {
    await writeTextFile(target, text)
  } catch (err) {
    // fs-plugin scope rejection → Rust fallback, but only for the exact argv-opened
    // file it was built for; anything else means the plugin failure IS the real error
    if (target !== argvPath) throw err
    await invoke('write_back', { path: target, contents: text })
  }
}

async function saveFile(): Promise<void> {
  const text = state.mode === 'edit' ? editor.value : state.text
  let target = state.filePath
  if (!target) {
    target = await save({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (!target) return
  }
  try {
    await writeAnywhere(target, text)
    setState({ filePath: target, text, dirty: false })
  } catch (err) {
    await alertError(`Could not save ${fileNameFrom(target)}`, err)
  }
}

async function confirmDiscard(): Promise<boolean> {
  if (!state.dirty) return true
  try {
    return await ask('Discard unsaved changes?', { kind: 'warning' })
  } catch {
    return true // dialog unavailable — never trap the user's data or window
  }
}

async function newFile(): Promise<void> {
  if (!(await confirmDiscard())) return
  setState({ filePath: null, text: '', dirty: false, mode: 'edit' })
  editor.focus()
}

async function alertError(title: string, err: unknown): Promise<void> {
  const detail = err instanceof Error ? err.message : String(err)
  await message(`${title}\n\n${detail}`, { kind: 'error', title: 'Theia' })
}

function wireEvents(): void {
  $('btn-new').addEventListener('click', () => void newFile())
  $('btn-open').addEventListener('click', () => void openDialog())
  btnMode.addEventListener('click', toggleMode)
  btnSave.addEventListener('click', () => void saveFile())

  editor.addEventListener('input', () => {
    setState({ text: editor.value, dirty: true })
  })

  // Links in rendered markdown open in the system browser, never in the webview
  content.addEventListener('click', (e) => {
    const anchor = (e.target as HTMLElement).closest('a')
    if (!anchor) return
    const rawHref = anchor.getAttribute('href') ?? ''
    if (rawHref.startsWith('#')) return // in-document fragment — let the browser scroll
    e.preventDefault()
    if (/^https?:/i.test(anchor.href)) {
      openUrl(anchor.href).catch((err) => void alertError(`Could not open link ${anchor.href}`, err))
    }
    // other schemes (mailto: etc.) are swallowed silently — opener errors on them
  })

  findInput.addEventListener('input', () => {
    searchQuery = findInput.value
    matchIndex = 0
    refreshHighlights()
    if (matchEls.length > 0) matchEls[matchIndex].scrollIntoView({ block: 'center' })
  })

  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      gotoMatch(e.shiftKey ? -1 : 1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeFind()
    }
  })

  $('find-prev').addEventListener('click', () => gotoMatch(-1))
  $('find-next').addEventListener('click', () => gotoMatch(1))
  $('find-close').addEventListener('click', () => closeFind())

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !findbar.hidden) {
      closeFind()
      return
    }
    if (!(e.ctrlKey || e.metaKey)) return
    const key = e.key.toLowerCase()
    if (key === 's') {
      e.preventDefault()
      void saveFile()
    } else if (key === 'e') {
      e.preventDefault()
      toggleMode()
    } else if (key === 'o') {
      e.preventDefault()
      void openDialog()
    } else if (key === 'f') {
      e.preventDefault()
      openFind()
    } else if (key === 'n') {
      e.preventDefault()
      void newFile()
    }
  })

  void getCurrentWebview().onDragDropEvent(async (event) => {
    if (event.payload.type === 'drop' && event.payload.paths.length > 0) {
      if (await confirmDiscard()) await openPath(event.payload.paths[0])
    }
  })

  void getCurrentWindow().onCloseRequested(async (event) => {
    if (!(await confirmDiscard())) {
      event.preventDefault()
      return
    }
    if (state.dirty) await getCurrentWindow().destroy()
  })
}

wireEvents()
syncUi()

// File passed on the command line (file-manager association) — contents arrive
// pre-read from Rust because argv paths are outside the fs plugin's scope
void invoke<{ path: string; contents: string } | null>('open_initial_file')
  .then((initial) => {
    if (initial) {
      argvPath = initial.path
      setState({ filePath: initial.path, text: initial.contents, dirty: false, mode: 'view' })
    }
  })
  .catch((err) => void alertError('Could not open file from command line', err))
