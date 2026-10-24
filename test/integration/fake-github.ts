import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Release, ReleaseAsset } from '../../src/github'

const FIXTURES = process.env.FIXTURES ?? '/fixtures'
const PORT = Number(process.env.PORT ?? 3000)
const RELEASES_PATH = '/repos/fixture/app/releases'

interface Asset {
  id: number
  name: string
  size: number
  tag: string
}

/**
 * Just enough of the GitHub API for rehost-gh: one release per `v<version>` directory in $FIXTURES (later versions
 * published later), assets that redirect to a "storage" URL which (like the real one) rejects requests still carrying
 * an Authorization header, and a user with a private email.
 */
const tags = (await readdir(FIXTURES)).sort()
const assets: Asset[] = []
const releases: Release[] = []
for (const [i, tag] of tags.entries()) {
  const releaseAssets: ReleaseAsset[] = []
  for (const name of (await readdir(join(FIXTURES, tag))).sort()) {
    const asset = { id: assets.length + 1, name, size: Bun.file(join(FIXTURES, tag, name)).size, tag }
    assets.push(asset)
    releaseAssets.push({ id: asset.id, name, size: asset.size })
  }
  releases.unshift({
    id: i + 1,
    tag_name: tag,
    draft: false,
    prerelease: false,
    published_at: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
    assets: releaseAssets,
  })
}

Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url)
    console.log(req.method, url.pathname)

    const storage = url.pathname.match(/^\/storage\/(\d+)$/)
    if (storage) {
      if (req.headers.has('authorization')) return new Response('auth header sent to storage', { status: 400 })
      const asset = assets[Number(storage[1]) - 1]
      if (!asset) return new Response('no such asset', { status: 404 })
      return new Response(Bun.file(join(FIXTURES, asset.tag, asset.name)))
    }

    if (req.headers.get('authorization') !== 'Bearer fake-token') return new Response('bad token', { status: 401 })

    if (url.pathname === RELEASES_PATH) {
      if (req.headers.get('if-none-match') === '"v1"') return new Response(null, { status: 304 })
      return Response.json(releases, { headers: { ETag: '"v1"' } })
    }

    const asset = url.pathname.match(/^\/repos\/fixture\/app\/releases\/assets\/(\d+)$/)
    if (asset) return Response.redirect(new URL(`/storage/${asset[1]}`, req.url).toString(), 302)

    if (url.pathname === '/user') return Response.json({ login: 'fixture', name: 'Fixture Bot', email: null })
    if (url.pathname === '/user/emails') return new Response('needs the email scope', { status: 403 })

    return new Response('not found', { status: 404 })
  },
})

console.log(`Fake GitHub serving ${assets.length} fixtures across ${tags.join(', ')} on ${PORT}`)
