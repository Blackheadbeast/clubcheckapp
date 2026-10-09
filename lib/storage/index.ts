// Where generated files are kept. Document logic asks for a file by key and does not know or care
// what is behind it: a folder on disk in development, memory in tests, and later an S3-compatible
// bucket by adding a driver here. Keys are chosen by the server, never by a caller.

import { promises as fs } from 'fs'
import path from 'path'

export interface FileStorage {
  name: string
  put(key: string, data: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<Buffer | null>
  delete(key: string): Promise<void>
}

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/
function checkKey(key: string) {
  if (!SAFE_KEY.test(key) || key.includes('..') || key.length > 300) throw new Error('Invalid storage key')
  return key
}

export class LocalFileStorage implements FileStorage {
  name = 'local'
  constructor(private root: string) {}
  private file(key: string) {
    const full = path.resolve(this.root, checkKey(key))
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Invalid storage key')
    return full
  }
  async put(key: string, data: Buffer) {
    const file = this.file(key)
    await fs.mkdir(path.dirname(file), { recursive: true })
    // Written beside the target and moved into place, so a reader never sees half a file.
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(temp, data)
    await fs.rename(temp, file)
  }
  async get(key: string) {
    const file = this.file(key)
    try { return await fs.readFile(file) } catch { return null }
  }
  async delete(key: string) {
    await fs.unlink(this.file(key)).catch(() => {})
  }
}

export class MemoryStorage implements FileStorage {
  name = 'memory'
  files = new Map<string, Buffer>()
  async put(key: string, data: Buffer) { this.files.set(checkKey(key), Buffer.from(data)) }
  async get(key: string) { return this.files.get(checkKey(key)) || null }
  async delete(key: string) { this.files.delete(checkKey(key)) }
}

let current: FileStorage | null = null

/**
 * FILE_STORAGE=local (the default) keeps files under FILE_STORAGE_DIR, or .data/files in the
 * project. FILE_STORAGE=memory keeps them for the life of the process. Anything stored can always
 * be rebuilt from the database, so losing this folder loses no records.
 */
export function getStorage(): FileStorage {
  if (current) return current
  const kind = (process.env.FILE_STORAGE || 'local').toLowerCase()
  if (kind === 'memory') current = new MemoryStorage()
  else if (kind === 'local') current = new LocalFileStorage(process.env.FILE_STORAGE_DIR || path.join(process.cwd(), '.data', 'files'))
  else throw new Error(`FILE_STORAGE=${kind} is not a storage driver this build has. Use "local" or "memory", or add the driver in lib/storage.`)
  return current
}

export function setStorageForTests(storage: FileStorage | null) {
  current = storage
}
