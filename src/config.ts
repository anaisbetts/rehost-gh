import { type FSWatcher, watch } from 'node:fs'
import { basename, dirname } from 'node:path'
import debug from 'debug'

const d = debug('rehost-gh:config')

const DEFAULT_POLL_INTERVAL = '30m'
const DEFAULT_REPO_NAME = 'rehost-gh'
const DEFAULT_KEEP = 3
const RELOAD_DEBOUNCE_MS = 500

const DURATION_UNITS_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
}

export interface WatchConfig {
  /** `owner/name` */
  repo: string
  owner: string
  name: string
  keep: number
  prereleases: boolean
  include: string[]
  exclude: string[]
}

export interface Config {
  pollIntervalMs: number
  repoName: string
  watches: WatchConfig[]
}

export function parseConfig(text: string): Config {
  const raw = Bun.TOML.parse(text) as Record<string, unknown>

  const pollInterval = optionalString(raw, 'poll_interval') ?? DEFAULT_POLL_INTERVAL
  const repoName = optionalString(raw, 'repo_name') ?? DEFAULT_REPO_NAME
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(repoName)) {
    throw new Error(`repo_name must be lowercase letters, digits, '.', '_' or '-', got '${repoName}'`)
  }

  const rawWatches = raw.watch ?? []
  if (!Array.isArray(rawWatches)) {
    throw new Error('watch must be an array of tables, use [[watch]]')
  }

  const watches = rawWatches.map((w, i) => parseWatch(w, i))
  const seen = new Set<string>()
  for (const w of watches) {
    const key = w.repo.toLowerCase()
    if (seen.has(key)) throw new Error(`${w.repo} is watched more than once`)
    seen.add(key)
  }

  return { pollIntervalMs: parseDuration(pollInterval), repoName, watches }
}

export async function loadConfig(path: string): Promise<Config> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    throw new Error(`Config file ${path} does not exist, copy rehost-gh.example.toml there to get started`)
  }

  return parseConfig(await file.text())
}

/**
 * Calls `onChange` with the new config whenever the file changes and still parses. The parent directory is watched
 * rather than the file, because most editors save by replacing the file.
 */
export function watchConfig(path: string, onChange: (config: Config) => void): FSWatcher {
  let timer: ReturnType<typeof setTimeout> | undefined
  const file = basename(path)

  return watch(dirname(path), (_event, changed) => {
    if (changed !== file) return

    clearTimeout(timer)
    timer = setTimeout(async () => {
      try {
        onChange(await loadConfig(path))
      } catch (e) {
        console.error(`Ignoring config change, ${path} is invalid: ${(e as Error).message}`)
      }
    }, RELOAD_DEBOUNCE_MS)
  })
}

export function parseDuration(text: string): number {
  const parts = [...text.matchAll(/(\d+)\s*([smhd])/g)]
  const consumed = parts.map((p) => p[0]).join('')
  if (parts.length === 0 || consumed.replace(/\s/g, '') !== text.replace(/\s/g, '')) {
    throw new Error(`Invalid duration '${text}', use something like '30m', '1h' or '1h30m'`)
  }

  const ms = parts.reduce((acc, p) => acc + Number(p[1]) * DURATION_UNITS_MS[p[2]!]!, 0)
  if (ms < 60 * 1000) throw new Error(`Duration '${text}' is too short, use at least 1m`)

  d('parsed duration %s as %dms', text, ms)
  return ms
}

function parseWatch(raw: unknown, index: number): WatchConfig {
  if (typeof raw !== 'object' || raw === null) throw new Error(`watch #${index + 1} must be a table`)

  const table = raw as Record<string, unknown>
  const repo = optionalString(table, 'repo')
  const match = repo?.match(/^([\w.-]+)\/([\w.-]+)$/)
  if (!repo || !match) throw new Error(`watch #${index + 1} needs repo = "owner/name"`)

  const keep = table.keep ?? DEFAULT_KEEP
  if (typeof keep !== 'number' || !Number.isInteger(keep) || keep < 1) {
    throw new Error(`${repo}: keep must be a positive integer`)
  }

  const prereleases = table.prereleases ?? false
  if (typeof prereleases !== 'boolean') throw new Error(`${repo}: prereleases must be true or false`)

  return {
    repo,
    owner: match[1]!,
    name: match[2]!,
    keep,
    prereleases,
    include: stringList(table, 'include', repo),
    exclude: stringList(table, 'exclude', repo),
  }
}

function optionalString(table: Record<string, unknown>, key: string): string | undefined {
  const value = table[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${key} must be a string`)
  return value
}

function stringList(table: Record<string, unknown>, key: string, repo: string): string[] {
  const value = table[key] ?? []
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new Error(`${repo}: ${key} must be a list of strings`)
  }
  return value as string[]
}
