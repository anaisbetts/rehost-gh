import debug from 'debug'

const d = debug('rehost-gh:exec')

export interface ExecOptions {
  cwd?: string
  env?: Record<string, string>
  stdin?: string
}

/** Runs a command to completion and returns its stdout, throwing with stderr attached if it exits non-zero. */
export async function exec(cmd: string[], options: ExecOptions = {}): Promise<string> {
  const { stdout, stderr, code } = await run(cmd, options)
  if (code !== 0) throw failed(cmd, code, stderr, new TextDecoder().decode(stdout))
  return new TextDecoder().decode(stdout)
}

/** Like `exec`, but keeps stdout as bytes so binary files (Android manifests) are not decoded as text. */
export async function execBuffer(cmd: string[], options: ExecOptions = {}): Promise<Uint8Array> {
  const { stdout, stderr, code } = await run(cmd, options)
  if (code !== 0) throw failed(cmd, code, stderr, new TextDecoder().decode(stdout))
  return stdout
}

async function run(cmd: string[], options: ExecOptions): Promise<{ stdout: Uint8Array; stderr: string; code: number }> {
  d('%s', cmd.join(' '))

  const proc = Bun.spawn(cmd, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdin: options.stdin === undefined ? 'ignore' : new TextEncoder().encode(options.stdin),
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).bytes(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, code }
}

function failed(cmd: string[], code: number, stderr: string, stdout: string): Error {
  return new Error(`${cmd[0]} exited with ${code}: ${(stderr || stdout).trim().slice(0, 2000)}`)
}
