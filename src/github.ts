import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import debug from 'debug'
import type { State } from './state'

const d = debug('rehost-gh:github')

const DEFAULT_API_BASE = 'https://api.github.com'
const RELEASES_PER_PAGE = 100
const USER_AGENT = 'rehost-gh'

export interface Release {
  id: number
  tag_name: string
  draft: boolean
  prerelease: boolean
  published_at: string | null
  assets: ReleaseAsset[]
}

export interface ReleaseAsset {
  id: number
  name: string
  size: number
}

export interface DownloadResult {
  size: number
  sha1: string
  sha256: string
}

export interface Identity {
  name: string
  email: string
}

interface UserResponse {
  login: string
  name: string | null
  email: string | null
}

interface EmailResponse {
  email: string
  primary: boolean
  verified: boolean
}

export class GitHubClient {
  private readonly apiBase: string

  constructor(
    private readonly token: string,
    private readonly state: State,
    apiBase = process.env.GITHUB_API_URL ?? DEFAULT_API_BASE
  ) {
    this.apiBase = apiBase.replace(/\/$/, '')
  }

  /** Newest releases first. Unchanged results come from the ETag cache and don't count against the rate limit. */
  async listReleases(owner: string, name: string): Promise<Release[]> {
    const url = `${this.apiBase}/repos/${owner}/${name}/releases?per_page=${RELEASES_PER_PAGE}`
    const cached = this.state.getCached(url)

    const headers = this.headers('application/vnd.github+json')
    if (cached) headers['If-None-Match'] = cached.etag

    const response = await fetch(url, { headers })
    if (response.status === 304 && cached) {
      d('%s/%s releases unchanged', owner, name)
      return JSON.parse(cached.body) as Release[]
    }
    await ensureOk(response, `listing releases of ${owner}/${name}`)

    const body = await response.text()
    const etag = response.headers.get('etag')
    if (etag) this.state.putCached(url, etag, body)

    return JSON.parse(body) as Release[]
  }

  /** Streams an asset to `dest` via a temporary file, hashing it on the way. */
  async downloadAsset(owner: string, name: string, assetId: number, dest: string): Promise<DownloadResult> {
    const url = `${this.apiBase}/repos/${owner}/${name}/releases/assets/${assetId}`

    // Assets redirect to a pre-signed storage URL which rejects requests that still carry our Authorization header,
    // so follow the redirect by hand.
    let response = await fetch(url, { headers: this.headers('application/octet-stream'), redirect: 'manual' })
    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      response = await fetch(location, { headers: { 'User-Agent': USER_AGENT } })
    }
    await ensureOk(response, `downloading asset ${assetId} of ${owner}/${name}`)
    if (!response.body) throw new Error(`Empty response downloading asset ${assetId} of ${owner}/${name}`)

    await mkdir(dirname(dest), { recursive: true })
    const tmp = `${dest}.partial`
    const sha1 = new Bun.CryptoHasher('sha1')
    const sha256 = new Bun.CryptoHasher('sha256')
    const writer = Bun.file(tmp).writer()
    let size = 0

    try {
      for await (const chunk of response.body) {
        sha1.update(chunk)
        sha256.update(chunk)
        writer.write(chunk)
        size += chunk.byteLength
      }
      await writer.end()
      await rename(tmp, dest)
    } catch (e) {
      await rm(tmp, { force: true })
      throw e
    }

    d('downloaded %s (%d bytes)', dest, size)
    return { size, sha1: sha1.digest('hex'), sha256: sha256.digest('hex') }
  }

  /** Name and email of the token's owner, falling back to the login and the noreply address. */
  async identity(): Promise<Identity> {
    const userResponse = await fetch(`${this.apiBase}/user`, { headers: this.headers('application/vnd.github+json') })
    await ensureOk(userResponse, 'looking up the token owner')
    const user = (await userResponse.json()) as UserResponse

    let email = user.email
    if (!email) {
      const emailsResponse = await fetch(`${this.apiBase}/user/emails`, {
        headers: this.headers('application/vnd.github+json'),
      })
      if (emailsResponse.ok) {
        const emails = (await emailsResponse.json()) as EmailResponse[]
        email = emails.find((e) => e.primary && e.verified)?.email ?? null
      } else {
        d('cannot read /user/emails (%d), using the noreply address', emailsResponse.status)
      }
    }

    return {
      name: user.name || user.login,
      email: email ?? `${user.login}@users.noreply.github.com`,
    }
  }

  private headers(accept: string): Record<string, string> {
    return {
      Accept: accept,
      Authorization: `Bearer ${this.token}`,
      'User-Agent': USER_AGENT,
      'X-GitHub-Api-Version': '2022-11-28',
    }
  }
}

async function ensureOk(response: Response, what: string) {
  if (response.ok) return

  const remaining = response.headers.get('x-ratelimit-remaining')
  const reset = response.headers.get('x-ratelimit-reset')
  if (remaining === '0' && reset) {
    throw new Error(`GitHub rate limit hit while ${what}, resets at ${new Date(Number(reset) * 1000).toISOString()}`)
  }

  const text = await response.text().catch(() => '')
  throw new Error(`GitHub returned ${response.status} while ${what}: ${text.slice(0, 200)}`)
}
