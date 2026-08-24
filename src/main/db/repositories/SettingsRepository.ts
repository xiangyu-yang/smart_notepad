import { getDb } from '../init';
import type { SettingsKey, SettingsMap } from '@shared/types';

export class SettingsRepository {
  static get<K extends SettingsKey>(key: K): SettingsMap[K] | undefined {
    const db = getDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return undefined;
    if (!row.value) return undefined;
    try {
      // 简单：统一以 JSON 存储，保证类型安全
      return JSON.parse(row.value) as SettingsMap[K];
    } catch {
      return row.value as SettingsMap[K];
    }
  }

  static set<K extends SettingsKey>(key: K, value: SettingsMap[K]): void {
    const db = getDb();
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO settings (key, value) VALUES (@key, @value)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run({ key, value: str });
    });
    tx();
  }
}
