import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { type Config, loadConfig, watchConfig } from './config'
import { GitHubClient } from './github'
import { publish } from './publish'
import { startServer } from './server'
import { Signer } from './signing'
import { State } from './state'
import { Syncer } from './sync'

const CONFIG_FILE = 'rehost-gh.toml'
const DEFAULT_PORT = 8080

async function main() {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('GITHUB_TOKEN must be set')

  const dataDir = resolve(process.env.DATA_DIR ?? './data')
  const port = Number(process.env.PORT ?? DEFAULT_PORT)
  const configPath = join(dataDir, CONFIG_FILE)
  await mkdir(dataDir, { recursive: true })

  let config: Config = await loadConfig(configPath)
  const state = new State(join(dataDir, 'state.db'))
  const github = new GitHubClient(token, state)
  const signer = await Signer.open(join(dataDir, 'gnupg'), () => github.identity())

  const syncer = new Syncer(state, github, join(dataDir, 'downloads'), async (c) => {
    await publish(dataDir, c, state, signer)
  })
  const server = startServer({ port, dataDir, state, config: () => config })

  const configWatcher = watchConfig(configPath, (next) => {
    console.log('Config changed, resyncing')
    config = next
    void syncer.setConfig(next)
  })
  process.on('SIGHUP', () => {
    console.log('Got SIGHUP, resyncing')
    void syncer.syncAll()
  })
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      syncer.stop()
      configWatcher.close()
      server.stop()
      state.close()
      process.exit(0)
    })
  }

  await syncer.setConfig(config)
}

main().catch((e) => {
  console.error((e as Error).message)
  process.exit(1)
})
