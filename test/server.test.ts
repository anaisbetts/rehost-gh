import { expect, test } from 'bun:test'
import type { Config } from '../src/config'
import { startServer } from '../src/server'
import { State } from '../src/state'

const CONFIG: Config = {
  pollIntervalMs: 60_000,
  repoName: 'rehost-gh',
  watches: [{ repo: 'owner/app', owner: 'owner', name: 'app', keep: 2, prereleases: false, include: [], exclude: [] }],
}

function serve(refresh?: () => Promise<void>) {
  const state = new State(':memory:')
  const server = startServer({ port: 0, dataDir: '/nonexistent', state, config: () => CONFIG, refresh })
  return {
    url: `http://localhost:${server.port}`,
    close: () => {
      server.stop()
      state.close()
    },
  }
}

test('POST /refresh resyncs and sends the browser back to the index', async () => {
  let refreshes = 0
  const app = serve(async () => {
    refreshes++
  })
  try {
    const response = await fetch(`${app.url}/refresh`, { method: 'POST', redirect: 'manual' })

    expect(refreshes).toBe(1)
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/')
  } finally {
    app.close()
  }
})

test('a failing refresh still returns to the index', async () => {
  const app = serve(async () => {
    throw new Error('GitHub is down')
  })
  try {
    const response = await fetch(`${app.url}/refresh`, { method: 'POST', redirect: 'manual' })

    expect(response.status).toBe(303)
  } finally {
    app.close()
  }
})

test('GET /refresh and a server without a refresh hook are rejected', async () => {
  const withHook = serve(async () => {})
  try {
    expect((await fetch(`${withHook.url}/refresh`)).status).toBe(405)
  } finally {
    withHook.close()
  }

  const withoutHook = serve()
  try {
    expect((await fetch(`${withoutHook.url}/refresh`, { method: 'POST' })).status).toBe(405)
  } finally {
    withoutHook.close()
  }
})
