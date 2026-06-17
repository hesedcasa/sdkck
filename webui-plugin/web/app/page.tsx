'use client'

import {useEffect, useState} from 'react'

import {CommandDetail} from '../components/CommandDetail'
import {CommandList} from '../components/CommandList'
import type {CommandsResponse} from '../lib/types'

export default function Page() {
  const [data, setData] = useState<CommandsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string>()

  useEffect(() => {
    fetch('/api/commands')
      .then((res) => res.json())
      .then((json: CommandsResponse) => setData(json))
      .catch((error_) => setError(String(error_)))
  }, [])

  if (error) {
    return <div className="empty">Failed to load commands: {error}</div>
  }

  if (!data) {
    return <div className="empty">Loading commands…</div>
  }

  const selected = data.commands.find((c) => c.id === selectedId)

  return (
    <div className="app">
      <CommandList
        bin={data.bin}
        commands={data.commands}
        onSelect={setSelectedId}
        query={query}
        selectedId={selectedId}
        setQuery={setQuery}
        version={data.version}
      />
      <main className="main">
        {selected ? (
          <CommandDetail bin={data.bin} command={selected} />
        ) : (
          <div className="empty">
            Select a command from the left to view its options and run it.
            <br />
            {data.commands.length} commands available.
          </div>
        )}
      </main>
    </div>
  )
}
