import { realpath, stat } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'
import debug from 'debug'
import type { Config } from './config'
import { renderIndexPage, type WatchSummary } from './index-page'
import { MANIFEST_FILE, type Manifest, WWW_LINK } from './publish'
import type { State } from './state'

const d = debug('rehost-gh:server')

export interface ServerOptions {
  port: number
  dataDir: string
  state: State
  config: () => Config
}

/** Serves the published tree as static files, plus `/healthz` and an index page with setup instructions. */
export function startServer(options: ServerOptions) {
  const server = Bun.serve({
    port: options.port,
    async fetch(req) {
      const url = new URL(req.url)
      if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405 })

      if (url.pathname === '/healthz') return new Response('ok\n')
      if (url.pathname === '/') return indexPage(req, url, options)

      return serveFile(req, options.dataDir, url.pathname)
    },
    error(e) {
      console.error(`Request failed: ${e.message}`)
      return new Response('Internal server error', { status: 500 })
    },
  })

  console.log(`Listening on http://localhost:${server.port}`)
  return server
}

async function serveFile(req: Request, dataDir: string, pathname: string): Promise<Response> {
  const notFound = new Response('Not found', { status: 404 })

  let root: string
  let relative: string
  try {
    root = await realpath(join(dataDir, WWW_LINK))
    relative = normalize(decodeURIComponent(pathname))
  } catch {
    return notFound
  }
  if (relative.split(sep).includes('..')) return notFound

  const path = join(root, relative)
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) return notFound

  d('%s %s', req.method, pathname)
  const file = Bun.file(path)
  const range = parseRange(req.headers.get('range'), info.size)
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } })
  }
  if (range) {
    return new Response(file.slice(range.start, range.end + 1), {
      status: 206,
      headers: {
        'Content-Range': `bytes ${range.start}-${range.end}/${info.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Type': file.type,
      },
    })
  }

  return new Response(file, {
    headers: { 'Accept-Ranges': 'bytes', 'Last-Modified': info.mtime.toUTCString() },
  })
}

async function indexPage(req: Request, url: URL, options: ServerOptions): Promise<Response> {
  const manifestFile = Bun.file(join(options.dataDir, WWW_LINK, MANIFEST_FILE))
  const manifest = (await manifestFile.exists()) ? ((await manifestFile.json()) as Manifest) : null

  const statuses = new Map(options.state.statuses().map((s) => [s.watch, s]))
  const watches: WatchSummary[] = options.config().watches.map((w) => ({
    repo: w.repo,
    packages: options.state.assets(w.repo).length,
    status: statuses.get(w.repo) ?? null,
  }))

  const proto = req.headers.get('x-forwarded-proto') ?? url.protocol.replace(/:$/, '')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? url.host

  return new Response(renderIndexPage(`${proto}://${host}`, manifest, watches, options.state.assets()), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

/** Parses a single `bytes=start-end` range, which is all package managers ever send. */
function parseRange(header: string | null, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/)
  if (!match || (match[1] === '' && match[2] === '')) return null

  const start = match[1] === '' ? Math.max(0, size - Number(match[2])) : Number(match[1])
  const end = match[1] === '' || match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  if (start > end || start >= size) return 'unsatisfiable'

  return { start, end }
}
