/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Account-scoped cache registry for Feishu user display names.
 */

const DEFAULT_MAX_SIZE = 500;
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface CacheEntry {
  name: string;
  userId?: string;
  identityResolved: boolean;
  expireAt: number;
}

export interface CachedUserIdentity {
  name: string;
  userId?: string;
  identityResolved: boolean;
}

export class UserNameCache {
  private map = new Map<string, CacheEntry>();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize = DEFAULT_MAX_SIZE, ttlMs = DEFAULT_TTL_MS) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  has(openId: string): boolean {
    return this.getValidEntry(openId) !== undefined;
  }

  get(openId: string): string | undefined {
    return this.getIdentity(openId)?.name;
  }

  getIdentity(openId: string): CachedUserIdentity | undefined {
    const entry = this.getValidEntry(openId);
    if (!entry) return undefined;
    this.map.delete(openId);
    this.map.set(openId, entry);
    return {
      name: entry.name,
      userId: entry.userId,
      identityResolved: entry.identityResolved,
    };
  }

  set(openId: string, name: string): void {
    const existing = this.getValidEntry(openId);
    this.map.delete(openId);
    this.map.set(openId, {
      name,
      userId: existing?.userId,
      identityResolved: existing?.identityResolved ?? false,
      expireAt: Date.now() + this.ttlMs,
    });
    this.evict();
  }

  setResolved(openId: string, name: string, userId?: string): void {
    this.map.delete(openId);
    this.map.set(openId, {
      name,
      userId,
      identityResolved: true,
      expireAt: Date.now() + this.ttlMs,
    });
    this.evict();
  }

  setMany(entries: Iterable<[string, string]>): void {
    for (const [openId, name] of entries) {
      this.set(openId, name);
    }
  }

  filterMissing(openIds: string[]): string[] {
    return openIds.filter((id) => !this.has(id));
  }

  getMany(openIds: string[]): Map<string, string> {
    const result = new Map<string, string>();
    for (const id of openIds) {
      if (this.has(id)) {
        result.set(id, this.get(id) ?? '');
      }
    }
    return result;
  }

  clear(): void {
    this.map.clear();
  }

  private getValidEntry(openId: string): CacheEntry | undefined {
    const entry = this.map.get(openId);
    if (!entry) return undefined;
    if (entry.expireAt <= Date.now()) {
      this.map.delete(openId);
      return undefined;
    }
    return entry;
  }

  private evict(): void {
    while (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}

const registry = new Map<string, UserNameCache>();

export function getUserNameCache(accountId: string): UserNameCache {
  let c = registry.get(accountId);
  if (!c) {
    c = new UserNameCache();
    registry.set(accountId, c);
  }
  return c;
}

export function clearUserNameCache(accountId?: string): void {
  if (accountId !== undefined) {
    registry.get(accountId)?.clear();
    registry.delete(accountId);
  } else {
    for (const c of registry.values()) c.clear();
    registry.clear();
  }
}
