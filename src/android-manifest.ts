const RES_XML_TYPE = 0x0003
const RES_STRING_POOL_TYPE = 0x0001
const RES_XML_RESOURCE_MAP_TYPE = 0x0180
const RES_XML_START_NAMESPACE_TYPE = 0x0100
const RES_XML_END_NAMESPACE_TYPE = 0x0101
const RES_XML_START_ELEMENT_TYPE = 0x0102
const RES_XML_END_ELEMENT_TYPE = 0x0103

const UTF8_FLAG = 1 << 8
const NO_INDEX = 0xffffffff
const TYPE_STRING = 0x03
const TYPE_INT_DEC = 0x10
const TYPE_INT_HEX = 0x11

const ATTR_VERSION_CODE = 0x0101021b
const ATTR_VERSION_NAME = 0x0101021c

const ANDROID_NS_URI = 'http://schemas.android.com/apk/res/android'
const ANDROID_ABIS = ['arm64-v8a', 'armeabi-v7a', 'armeabi', 'x86_64', 'x86', 'riscv64'] as const

export interface AndroidManifestInfo {
  package: string
  versionName: string
  versionCode: number
}

/** Reads package, versionName and versionCode out of a binary `AndroidManifest.xml`. */
export function parseAndroidManifest(data: Uint8Array): AndroidManifestInfo {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (data.byteLength < 8) throw new Error('AndroidManifest.xml is too short')

  const type = view.getUint16(0, true)
  const headerSize = view.getUint16(2, true)
  const size = view.getUint32(4, true)
  if (type !== RES_XML_TYPE) throw new Error('AndroidManifest.xml is not binary XML')
  if (headerSize < 8 || size > data.byteLength) throw new Error('AndroidManifest.xml is truncated')

  let strings: string[] | null = null
  let resourceIds: number[] = []
  let offset = headerSize

  while (offset + 8 <= data.byteLength) {
    const chunkType = view.getUint16(offset, true)
    const chunkSize = view.getUint32(offset + 4, true)
    if (chunkSize < 8 || offset + chunkSize > data.byteLength) {
      throw new Error('AndroidManifest.xml has a truncated chunk')
    }

    if (chunkType === RES_STRING_POOL_TYPE) {
      strings = parseStringPool(data, view, offset)
    } else if (chunkType === RES_XML_RESOURCE_MAP_TYPE) {
      resourceIds = parseResourceMap(view, offset, chunkSize)
    } else if (chunkType === RES_XML_START_ELEMENT_TYPE) {
      if (!strings) throw new Error('AndroidManifest.xml is missing a string pool')
      return readManifestElement(view, offset, strings, resourceIds)
    }

    offset += chunkSize
  }

  throw new Error('AndroidManifest.xml has no manifest element')
}

/**
 * Builds a minimal binary manifest with the fields `parseAndroidManifest` needs. Used by tests and the integration
 * fixture APK.
 */
export function encodeAndroidManifest(info: AndroidManifestInfo): Uint8Array {
  const strings = [
    'versionCode',
    'versionName',
    'package',
    'manifest',
    'android',
    ANDROID_NS_URI,
    info.package,
    info.versionName,
  ]
  const stringPool = encodeStringPool(strings)
  const resourceMap = encodeResourceMap([ATTR_VERSION_CODE, ATTR_VERSION_NAME])
  const startNs = encodeNamespace(RES_XML_START_NAMESPACE_TYPE, 4, 5)
  const startEl = encodeManifestElement(info.versionCode)
  const endEl = encodeEndElement()
  const endNs = encodeNamespace(RES_XML_END_NAMESPACE_TYPE, 4, 5)

  const bodySize =
    8 + stringPool.length + resourceMap.length + startNs.length + startEl.length + endEl.length + endNs.length
  const out = new Uint8Array(bodySize)
  const view = new DataView(out.buffer)
  view.setUint16(0, RES_XML_TYPE, true)
  view.setUint16(2, 8, true)
  view.setUint32(4, bodySize, true)

  let offset = 8
  for (const chunk of [stringPool, resourceMap, startNs, startEl, endEl, endNs]) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** Architecture from the `lib/<abi>/` entries of an APK listing. Fat APKs are `universal`; no native libs is `any`. */
export function androidArchFromListing(listing: string): string {
  const found = new Set<string>()
  for (const line of listing.split('\n')) {
    const match = line.match(/(?:^|\/)lib\/([^/]+)\//)
    if (match && (ANDROID_ABIS as readonly string[]).includes(match[1]!)) found.add(match[1]!)
  }
  if (found.size === 0) return 'any'
  if (found.size === 1) return [...found][0]!
  return 'universal'
}

export function formatAndroidVersion(versionName: string, versionCode: number): string {
  return `${versionName}+${versionCode}`
}

export function parseAndroidVersion(version: string): { versionName: string; versionCode: number } {
  const i = version.lastIndexOf('+')
  const versionCode = i === -1 ? Number.NaN : Number(version.slice(i + 1))
  if (i <= 0 || !Number.isInteger(versionCode) || versionCode <= 0) {
    throw new Error(`Invalid Android version '${version}', expected versionName+versionCode`)
  }
  return { versionName: version.slice(0, i), versionCode }
}

export function androidFileName(name: string, version: string, arch: string): string {
  const { versionName, versionCode } = parseAndroidVersion(version)
  return `${name}-${versionName}+${versionCode}-${arch}.apk`
}

function parseStringPool(data: Uint8Array, view: DataView, offset: number): string[] {
  const headerSize = view.getUint16(offset + 2, true)
  const stringCount = view.getUint32(offset + 8, true)
  const flags = view.getUint32(offset + 16, true)
  const stringsStart = view.getUint32(offset + 20, true)
  const utf8 = (flags & UTF8_FLAG) !== 0
  const strings: string[] = []

  for (let i = 0; i < stringCount; i++) {
    const rel = view.getUint32(offset + headerSize + i * 4, true)
    const start = offset + stringsStart + rel
    strings.push(utf8 ? decodeUtf8String(data, start) : decodeUtf16String(view, data, start))
  }
  return strings
}

function parseResourceMap(view: DataView, offset: number, chunkSize: number): number[] {
  const headerSize = view.getUint16(offset + 2, true)
  const ids: number[] = []
  for (let i = offset + headerSize; i + 4 <= offset + chunkSize; i += 4) ids.push(view.getUint32(i, true))
  return ids
}

function readManifestElement(
  view: DataView,
  offset: number,
  strings: string[],
  resourceIds: number[]
): AndroidManifestInfo {
  const attributeStart = view.getUint16(offset + 24, true)
  const attributeSize = view.getUint16(offset + 26, true)
  const attributeCount = view.getUint16(offset + 28, true)
  if (attributeSize < 20) throw new Error('AndroidManifest.xml has invalid attributes')

  let pkg: string | undefined
  let versionName: string | undefined
  let versionCode: number | undefined

  for (let i = 0; i < attributeCount; i++) {
    const attr = offset + 16 + attributeStart + i * attributeSize
    const name = view.getUint32(attr + 4, true)
    const raw = view.getUint32(attr + 8, true)
    const dataType = view.getUint8(attr + 15)
    const data = view.getUint32(attr + 16, true)
    const resourceId = name < resourceIds.length ? resourceIds[name]! : 0
    const nameStr = stringAt(strings, name)

    if (resourceId === ATTR_VERSION_CODE || nameStr === 'versionCode') {
      versionCode = integerAttr(dataType, data)
    } else if (resourceId === ATTR_VERSION_NAME || nameStr === 'versionName') {
      versionName = stringAttr(strings, dataType, data, raw)
    } else if (nameStr === 'package') {
      pkg = stringAttr(strings, dataType, data, raw)
    }
  }

  if (!pkg) throw new Error('AndroidManifest.xml is missing package')
  if (!versionName) throw new Error('AndroidManifest.xml is missing versionName')
  if (versionCode === undefined || !Number.isInteger(versionCode) || versionCode <= 0) {
    throw new Error('AndroidManifest.xml is missing versionCode')
  }
  return { package: pkg, versionName, versionCode }
}

function integerAttr(dataType: number, data: number): number {
  if (dataType === TYPE_INT_DEC || dataType === TYPE_INT_HEX) return data
  throw new Error('AndroidManifest.xml versionCode is not an integer')
}

function stringAttr(strings: string[], dataType: number, data: number, raw: number): string {
  if (dataType === TYPE_STRING) return requireString(strings, data, 'attribute')
  if (raw !== NO_INDEX) return requireString(strings, raw, 'attribute')
  return String(data)
}

function stringAt(strings: string[], index: number): string | undefined {
  return index < strings.length ? strings[index] : undefined
}

function requireString(strings: string[], index: number, what: string): string {
  const value = stringAt(strings, index)
  if (!value) throw new Error(`AndroidManifest.xml ${what} is missing a string`)
  return value
}

function decodeUtf16String(view: DataView, data: Uint8Array, start: number): string {
  if (start + 2 > data.byteLength) throw new Error('AndroidManifest.xml string is truncated')
  let length = view.getUint16(start, true)
  let offset = start + 2
  if (length & 0x8000) {
    if (offset + 2 > data.byteLength) throw new Error('AndroidManifest.xml string is truncated')
    length = ((length & 0x7fff) << 16) | view.getUint16(offset, true)
    offset += 2
  }
  const end = offset + length * 2
  if (end > data.byteLength) throw new Error('AndroidManifest.xml string is truncated')
  return new TextDecoder('utf-16le').decode(data.subarray(offset, end))
}

function decodeUtf8String(data: Uint8Array, start: number): string {
  const chars = decodeUtf8Length(data, start)
  const bytes = decodeUtf8Length(data, chars.next)
  const end = bytes.next + bytes.length
  if (end > data.byteLength) throw new Error('AndroidManifest.xml string is truncated')
  return new TextDecoder().decode(data.subarray(bytes.next, end))
}

function decodeUtf8Length(data: Uint8Array, start: number): { length: number; next: number } {
  if (start >= data.byteLength) throw new Error('AndroidManifest.xml string is truncated')
  const first = data[start]!
  if ((first & 0x80) === 0) return { length: first, next: start + 1 }
  if (start + 1 >= data.byteLength) throw new Error('AndroidManifest.xml string is truncated')
  return { length: ((first & 0x7f) << 8) | data[start + 1]!, next: start + 2 }
}

function encodeStringPool(strings: string[]): Uint8Array {
  const encoded = strings.map(encodeUtf16String)
  const headerSize = 28
  const offsetsSize = strings.length * 4
  const stringsStart = headerSize + offsetsSize
  const dataSize = encoded.reduce((sum, s) => sum + s.length, 0)
  const size = stringsStart + dataSize
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)

  view.setUint16(0, RES_STRING_POOL_TYPE, true)
  view.setUint16(2, headerSize, true)
  view.setUint32(4, size, true)
  view.setUint32(8, strings.length, true)
  view.setUint32(12, 0, true)
  view.setUint32(16, 0, true)
  view.setUint32(20, stringsStart, true)
  view.setUint32(24, 0, true)

  let cursor = stringsStart
  for (const [i, bytes] of encoded.entries()) {
    view.setUint32(headerSize + i * 4, cursor - stringsStart, true)
    out.set(bytes, cursor)
    cursor += bytes.length
  }
  return out
}

function encodeUtf16String(text: string): Uint8Array {
  const chars = new Uint8Array(text.length * 2)
  const view = new DataView(chars.buffer)
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), true)
  const out = new Uint8Array(2 + chars.length + 2)
  new DataView(out.buffer).setUint16(0, text.length, true)
  out.set(chars, 2)
  return out
}

function encodeResourceMap(ids: number[]): Uint8Array {
  const size = 8 + ids.length * 4
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  view.setUint16(0, RES_XML_RESOURCE_MAP_TYPE, true)
  view.setUint16(2, 8, true)
  view.setUint32(4, size, true)
  for (const [i, id] of ids.entries()) view.setUint32(8 + i * 4, id, true)
  return out
}

function encodeNamespace(type: number, prefix: number, uri: number): Uint8Array {
  const out = new Uint8Array(24)
  const view = new DataView(out.buffer)
  writeNodeHeader(view, type, 24)
  view.setUint32(16, prefix, true)
  view.setUint32(20, uri, true)
  return out
}

function encodeManifestElement(versionCode: number): Uint8Array {
  const attrCount = 3
  const size = 16 + 20 + 20 * attrCount
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  writeNodeHeader(view, RES_XML_START_ELEMENT_TYPE, size)
  view.setUint32(16, NO_INDEX, true)
  view.setUint32(20, 3, true)
  view.setUint16(24, 20, true)
  view.setUint16(26, 20, true)
  view.setUint16(28, attrCount, true)

  writeAttribute(view, 36, 5, 0, NO_INDEX, TYPE_INT_DEC, versionCode)
  writeAttribute(view, 56, 5, 1, 7, TYPE_STRING, 7)
  writeAttribute(view, 76, NO_INDEX, 2, 6, TYPE_STRING, 6)
  return out
}

function encodeEndElement(): Uint8Array {
  const out = new Uint8Array(24)
  const view = new DataView(out.buffer)
  writeNodeHeader(view, RES_XML_END_ELEMENT_TYPE, 24)
  view.setUint32(16, NO_INDEX, true)
  view.setUint32(20, 3, true)
  return out
}

function writeNodeHeader(view: DataView, type: number, size: number) {
  view.setUint16(0, type, true)
  view.setUint16(2, 16, true)
  view.setUint32(4, size, true)
  view.setUint32(8, 2, true)
  view.setUint32(12, NO_INDEX, true)
}

function writeAttribute(
  view: DataView,
  offset: number,
  ns: number,
  name: number,
  raw: number,
  dataType: number,
  data: number
) {
  view.setUint32(offset, ns, true)
  view.setUint32(offset + 4, name, true)
  view.setUint32(offset + 8, raw, true)
  view.setUint16(offset + 12, 8, true)
  view.setUint8(offset + 14, 0)
  view.setUint8(offset + 15, dataType)
  view.setUint32(offset + 16, data, true)
}
