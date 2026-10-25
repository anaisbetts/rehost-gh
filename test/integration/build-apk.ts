import { writeMinimalApk } from '../apk'

const [path, versionName, versionCode, pkg, ...abis] = Bun.argv.slice(2)
if (!path || !versionName || !versionCode || !pkg) {
  throw new Error('usage: build-apk.ts <path> <versionName> <versionCode> <package> [abi...]')
}

await writeMinimalApk(path, { package: pkg, versionName, versionCode: Number(versionCode) }, abis)
