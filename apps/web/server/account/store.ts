/**
 * apps/web · 账户与用户仓储门面 (Account Store · T09)。
 * 提供用户元数据、关联书籍引用与多租户用户数据读取。
 */
import { resolve } from 'node:path'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { atomicWriteFileSync } from '@mozhou/data-plane'
import { resolveDefaultDataRoot } from '../dataRoot.js'
import type { AuthUserInfo } from '../auth/session.js'

export interface UserProfile extends AuthUserInfo {
  readonly plan: string
  readonly bookIds: readonly string[]
  readonly updatedAt: string
}

export class AccountStore {
  private _dataRoot: string = resolveDefaultDataRoot()

  setDataRoot(dir: string): void {
    this._dataRoot = resolve(dir)
  }

  private userProfilePath(userId: string): string {
    const userDir = resolve(this._dataRoot, 'users', userId)
    mkdirSync(userDir, { recursive: true })
    return resolve(userDir, 'profile.json')
  }

  getProfile(userId: string): UserProfile | null {
    const path = this.userProfilePath(userId)
    if (!existsSync(path)) return null
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as UserProfile
    } catch {
      return null
    }
  }

  saveProfile(profile: UserProfile): void {
    const path = this.userProfilePath(profile.id)
    atomicWriteFileSync(path, JSON.stringify(profile, null, 2) + '\n')
  }

  recordBookForUser(userId: string, bookId: string): void {
    const existing = this.getProfile(userId)
    const bookIds = existing ? Array.from(new Set([...existing.bookIds, bookId])) : [bookId]
    const updated: UserProfile = {
      id: userId,
      email: existing?.email ?? '',
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      plan: existing?.plan ?? 'free',
      bookIds,
    }
    this.saveProfile(updated)
  }
}

export const defaultAccountStore = new AccountStore()
