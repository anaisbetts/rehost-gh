import { describe, expect, test } from 'bun:test'
import { parseConfig, parseDuration } from '../src/config'

describe('parseConfig', () => {
  test('applies defaults', () => {
    const config = parseConfig('[[watch]]\nrepo = "owner/name"\n')

    expect(config.pollIntervalMs).toBe(30 * 60 * 1000)
    expect(config.repoName).toBe('rehost-gh')
    expect(config.watches).toEqual([
      { repo: 'owner/name', owner: 'owner', name: 'name', keep: 3, prereleases: false, include: [], exclude: [] },
    ])
  })

  test('reads every watch and its options', () => {
    const config = parseConfig(`
poll_interval = "1h30m"
repo_name = "my-pkgs"

[[watch]]
repo = "a/one"
keep = 5
prereleases = true
include = ["*.deb"]
exclude = ["*-dbg*"]

[[watch]]
repo = "b/two.js"
`)

    expect(config.pollIntervalMs).toBe(90 * 60 * 1000)
    expect(config.repoName).toBe('my-pkgs')
    expect(config.watches.map((w) => w.repo)).toEqual(['a/one', 'b/two.js'])
    expect(config.watches[0]).toMatchObject({ keep: 5, prereleases: true, include: ['*.deb'], exclude: ['*-dbg*'] })
  })

  test('allows no watches', () => {
    expect(parseConfig('').watches).toEqual([])
  })

  test.each([
    ['[[watch]]\nrepo = "not-a-repo"\n', /owner\/name/],
    ['[[watch]]\nrepo = "a/b"\nkeep = 0\n', /keep/],
    ['[[watch]]\nrepo = "a/b"\ninclude = "*.deb"\n', /include/],
    ['[[watch]]\nrepo = "a/b"\n[[watch]]\nrepo = "A/B"\n', /more than once/],
    ['repo_name = "Has Spaces"\n', /repo_name/],
    ['watch = "nope"\n', /\[\[watch\]\]/],
  ])('rejects %p', (text, error) => {
    expect(() => parseConfig(text)).toThrow(error)
  })
})

describe('parseDuration', () => {
  test.each([
    ['30m', 30 * 60 * 1000],
    ['2h', 2 * 60 * 60 * 1000],
    ['1d', 24 * 60 * 60 * 1000],
    ['1h 15m', 75 * 60 * 1000],
    ['90s', 90 * 1000],
  ])('%s', (text, ms) => {
    expect(parseDuration(text)).toBe(ms)
  })

  test.each(['', '30', 'soon', '5m later', '10s'])('rejects %p', (text) => {
    expect(() => parseDuration(text)).toThrow()
  })
})
