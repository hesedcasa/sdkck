'use client'

import {useMemo, useState} from 'react'

import {buildArgv, type CommandMeta, type RunResult} from '../lib/types'

export function CommandDetail({bin, command}: {bin: string; command: CommandMeta}) {
  const [argValues, setArgValues] = useState<Record<string, string>>({})
  const [flagValues, setFlagValues] = useState<Record<string, boolean | string>>({})
  const [result, setResult] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)

  // Reset form state whenever the selected command changes.
  const argv = useMemo(() => buildArgv(command, argValues, flagValues), [command, argValues, flagValues])
  const preview = `${bin || 'sdkck'} ${command.id}${argv.length ? ' ' + argv.join(' ') : ''}`

  async function run() {
    setRunning(true)
    setResult(null)
    try {
      const res = await fetch('/api/run', {
        body: JSON.stringify({argv, id: command.id}),
        headers: {'content-type': 'application/json'},
        method: 'POST',
      })
      setResult((await res.json()) as RunResult)
    } catch (error) {
      setResult({durationMs: 0, error: String(error), output: String(error), success: false})
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="detail" key={command.id}>
      <h1>
        {command.id}
        {command.pluginName && <span className="badge">{command.pluginName}</span>}
      </h1>
      {(command.description || command.summary) && <p className="desc">{command.description ?? command.summary}</p>}

      {command.args.length > 0 && (
        <>
          <div className="section-title">Arguments</div>
          {command.args.map((arg) => (
            <div className="field" key={arg.name}>
              <label htmlFor={`arg-${arg.name}`}>
                {arg.name}
                {arg.required && <span className="req">*</span>}
              </label>
              {arg.description && <div className="hint">{arg.description}</div>}
              {arg.options ? (
                <select
                  id={`arg-${arg.name}`}
                  onChange={(e) => setArgValues((v) => ({...v, [arg.name]: e.target.value}))}
                  value={argValues[arg.name] ?? ''}
                >
                  <option value="">— choose —</option>
                  {arg.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`arg-${arg.name}`}
                  onChange={(e) => setArgValues((v) => ({...v, [arg.name]: e.target.value}))}
                  placeholder={arg.default ? String(arg.default) : ''}
                  type="text"
                  value={argValues[arg.name] ?? ''}
                />
              )}
            </div>
          ))}
        </>
      )}

      {command.flags.length > 0 && (
        <>
          <div className="section-title">Flags</div>
          {command.flags.map((flag) =>
            flag.type === 'boolean' ? (
              <div className="field checkbox-row" key={flag.name}>
                <input
                  checked={flagValues[flag.name] === true}
                  id={`flag-${flag.name}`}
                  onChange={(e) => setFlagValues((v) => ({...v, [flag.name]: e.target.checked}))}
                  type="checkbox"
                />
                <label htmlFor={`flag-${flag.name}`}>
                  --{flag.name}
                  {flag.description ? <span className="hint" style={{display: 'inline', marginLeft: 8}}>{flag.description}</span> : null}
                </label>
              </div>
            ) : (
              <div className="field" key={flag.name}>
                <label htmlFor={`flag-${flag.name}`}>
                  --{flag.name}
                  {flag.char ? ` (-${flag.char})` : ''}
                  {flag.required && <span className="req">*</span>}
                  {flag.multiple && <span className="badge">multiple</span>}
                </label>
                {flag.description && <div className="hint">{flag.description}</div>}
                {flag.options ? (
                  <select
                    id={`flag-${flag.name}`}
                    onChange={(e) => setFlagValues((v) => ({...v, [flag.name]: e.target.value}))}
                    value={(flagValues[flag.name] as string) ?? ''}
                  >
                    <option value="">— choose —</option>
                    {flag.options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`flag-${flag.name}`}
                    onChange={(e) => setFlagValues((v) => ({...v, [flag.name]: e.target.value}))}
                    placeholder={
                      flag.default !== undefined ? String(flag.default) : flag.multiple ? 'comma,separated,values' : ''
                    }
                    type="text"
                    value={(flagValues[flag.name] as string) ?? ''}
                  />
                )}
              </div>
            ),
          )}
        </>
      )}

      <div className="section-title">Command</div>
      <div className="preview">$ {preview}</div>

      <button className="run-btn" disabled={running} onClick={run} type="button">
        {running ? 'Running…' : 'Run command'}
      </button>

      {result && (
        <div className="output">
          <div className={`status ${result.success ? 'ok' : 'err'}`}>
            {result.success ? '✓ Success' : '✗ Failed'} · {result.durationMs}ms
          </div>
          <pre>{result.output || '(no output)'}</pre>
        </div>
      )}
    </div>
  )
}
