import { invoke } from '@tauri-apps/api/core'
import { open, save, ask, message } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { openUrl } from '@tauri-apps/plugin-opener'
import { renderMarkdown } from './markdown'

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

let state: AppState = INITIAL_STATE

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
  const name = (state.filePath?.split('/').pop() ?? 'Untitled')
  fileLabel.textContent = name + (state.dirty ? ' — modified' : '')
  document.title = name
  if (isView) {
    content.innerHTML = renderMarkdown(state.text)
  } else if (editor.value !== state.text) {
    editor.value = state.text
  }
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
  if (next === 'edit') editor.focus()
}

function fileNameFrom(path: string): string {
  return path.split('/').pop() ?? path
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
  } catch {
    // fs-plugin scope rejection (e.g. argv-opened file) → exact-path Rust fallback
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
    e.preventDefault()
    openUrl(anchor.href).catch((err) => void alertError(`Could not open link ${anchor.href}`, err))
  })

  window.addEventListener('keydown', (e) => {
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
      setState({ filePath: initial.path, text: initial.contents, dirty: false, mode: 'view' })
    }
  })
  .catch((err) => void alertError('Could not open file from command line', err))
