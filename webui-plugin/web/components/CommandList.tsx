'use client'

import type {CommandMeta} from '../lib/types'

export function CommandList({
  bin,
  commands,
  onSelect,
  query,
  selectedId,
  setQuery,
  version,
}: {
  bin: string
  commands: CommandMeta[]
  onSelect: (id: string) => void
  query: string
  selectedId?: string
  setQuery: (q: string) => void
  version: string
}) {
  const filtered = commands.filter((cmd) => {
    if (!query) return true
    const haystack = `${cmd.id} ${cmd.summary ?? ''} ${cmd.description ?? ''}`.toLowerCase()
    return query
      .toLowerCase()
      .split(/\s+/)
      .every((term) => haystack.includes(term))
  })

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand">
          {bin || 'sdkck'} <small>web UI · v{version}</small>
        </div>
        <input
          aria-label="Filter commands"
          className="search"
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter commands…"
          type="text"
          value={query}
        />
      </div>
      <nav className="command-list">
        {filtered.length === 0 && <div className="empty">No commands match.</div>}
        {filtered.map((cmd) => (
          <button
            className={`command-item${cmd.id === selectedId ? ' active' : ''}`}
            key={cmd.id}
            onClick={() => onSelect(cmd.id)}
            type="button"
          >
            <span className="cmd-id">{cmd.id}</span>
            <span className="cmd-summary">{cmd.summary ?? cmd.description ?? ''}</span>
          </button>
        ))}
      </nav>
    </aside>
  )
}
