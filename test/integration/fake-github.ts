import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const FIXTURES = process.env.FIXTURES ?? '/fixtures'
const PORT = Number(process.env.PORT ?? 3000)
const RELEASES_PATH = '/repos/fixture/app/releases'

/**
 * Just enough of the GitHub API for rehost-gh: one release holding every file in $FIXTURES, assets that redirect to
 * a "storage" URL which (like the real one) rejects requests still carrying an Authorization header, and a user
 * with a private email.
 */
const files = (await readdir(FIXTURES)).sort()
const assets = files.map((name, i) => ({ id: i + 1, name, size: Bun.file(join(FIXTURES, name)).size }))
const releases = [
  { id: 1, tag_name: 'v1.0.0', draft: false, prerelease: false, published_at: '2026-01-01T00:00:00Z', assets },
]

Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url)
    console.log(req.method, url.pathname)

    if (url.pathname.startsWith('/storage/')) {
      if (req.headers.has('authorization')) return new Response('auth header sent to storage', { status: 400 })
      return new Response(Bun.file(join(FIXTURES, decodeURIComponent(url.pathname.slice('/storage/'.length)))))
    }

    if (req.headers.get('authorization') !== 'Bearer fake-token') return new Response('bad token', { status: 401 })

    if (url.pathname === RELEASES_PATH) {
      if (req.headers.get('if-none-match') === '"v1"') return new Response(null, { status: 304 })
      return Response.json(releases, { headers: { ETag: '"v1"' } })
    }

    const asset = url.pathname.match(/^\/repos\/fixture\/app\/releases\/assets\/(\d+)$/)
    if (asset) {
      const name = assets[Number(asset[1]) - 1]?.name
      if (!name) return new Response('no such asset', { status: 404 })
      return Response.redirect(new URL(`/storage/${encodeURIComponent(name)}`, req.url).toString(), 302)
    }

    if (url.pathname === '/user') return Response.json({ login: 'fixture', name: 'Fixture Bot', email: null })
    if (url.pathname === '/user/emails') return new Response('needs the email scope', { status: 403 })

    return new Response('not found', { status: 404 })
  },
})

console.log(`Fake GitHub serving ${files.length} fixtures on ${PORT}`)
