import debug from 'debug'

const d = debug('rehost-gh:exec')

export interface ExecOptions {
  cwd?: string
  env?: Record<string, string>
  stdin?: string
}

/** Runs a command to completion and returns its stdout, throwing with stderr attached if it exits non-zero. */
export async function exec(cmd: string[], options: ExecOptions = {}): Promise<string> {
  d('%s', cmd.join(' '))

  const proc = Bun.spawn(cmd, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdin: options.stdin === undefined ? 'ignore' : new TextEncoder().encode(options.stdin),
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (code !== 0) {
    throw new Error(`${cmd[0]} exited with ${code}: ${(stderr || stdout).trim().slice(0, 2000)}`)
  }

  return stdout
}
