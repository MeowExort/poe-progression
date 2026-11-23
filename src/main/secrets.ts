import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** The part of Electron's safeStorage this needs: encryption tied to the OS user account. */
export interface Cipher {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

/**
 * Keeps secrets in a file, encrypted by the operating system (DPAPI on Windows), so they
 * cannot be read by copying the file to another account or machine. If the OS cannot encrypt,
 * nothing is stored at all: a plain-text session cookie on disk is not an acceptable fallback.
 */
export class SecretStore {
  constructor(
    private readonly file: string,
    private readonly cipher: Cipher
  ) {}

  get available(): boolean {
    return this.cipher.isEncryptionAvailable()
  }

  has(name: string): boolean {
    return typeof this.read()[name] === 'string'
  }

  get(name: string): string | null {
    const stored = this.read()[name]
    if (!stored || !this.available) return null
    try {
      return this.cipher.decryptString(Buffer.from(stored, 'base64'))
    } catch {
      // Encrypted under another OS account, or corrupted: as good as absent.
      return null
    }
  }

  set(name: string, value: string): boolean {
    if (!this.available) return false
    this.write({ ...this.read(), [name]: this.cipher.encryptString(value).toString('base64') })
    return true
  }

  delete(name: string): void {
    const all = this.read()
    if (!(name in all)) return
    delete all[name]
    this.write(all)
  }

  private read(): Record<string, string> {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
    } catch {
      return {}
    }
  }

  private write(all: Record<string, string>): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(all))
  }
}
