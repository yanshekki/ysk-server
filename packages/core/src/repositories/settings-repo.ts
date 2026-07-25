import type { YskDatabase } from '../db/database.js';

export class SettingsRepository {
  constructor(private readonly db: YskDatabase) {}

  get(key: string): string | undefined {
    return this.db.snapshot.settings[key];
  }

  getJson<T>(key: string): T | undefined {
    const v = this.get(key);
    if (v === undefined) return undefined;
    return JSON.parse(v) as T;
  }

  set(key: string, value: string): void {
    this.db.snapshot.settings[key] = value;
    this.db.persist();
  }

  setJson(key: string, value: unknown): void {
    this.set(key, JSON.stringify(value));
  }
}
