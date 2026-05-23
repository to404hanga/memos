/**
 * AI Provider/Model 数据仓库
 *
 * 管理 AI 配置的持久化存储，包括：
 *
 * Provider 操作：
 * - getAllProviders / getProviderById: 查询
 * - saveProvider: 创建或更新（根据 id 是否存在自动判断）
 * - deleteProvider: 删除 Provider 并级联删除其下所有模型
 *
 * Model 操作：
 * - getAllModels / getModelById / getEnabledModelsOrdered: 查询
 * - saveModel: 创建或更新（新建时自动分配最低优先级）
 * - deleteModel: 删除并重排优先级
 * - setModelEnabled: 启用/禁用切换
 * - reorderModels: 批量更新全局优先级顺序（拖拽排序）
 * - updateModelRuntime: 更新运行时状态（lastError/lastUsedAt）
 *
 * 工具函数：
 * - isLocalUrl: 判断 URL 是否为本地地址（用于离线模式判断）
 */
import { v4 as uuidv4 } from 'uuid';
import { safeStorage } from 'electron';
import { getDb, saveDb } from './index';

// ===== API Key 加解密（使用系统密钥链） =====

function encryptApiKey(plainKey: string): string {
  if (!plainKey) return '';
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plainKey).toString('base64');
  }
  // 加密不可用时原样存储（首次启动 app.ready 前或 Linux 无 libsecret）
  return plainKey;
}

function decryptApiKey(stored: string): string {
  if (!stored) return '';
  // 尝试解密：如果是 base64 编码的加密数据则解密，否则当作明文返回
  if (safeStorage.isEncryptionAvailable()) {
    try {
      const buf = Buffer.from(stored, 'base64');
      return safeStorage.decryptString(buf);
    } catch {
      // 解密失败说明是旧版明文数据，原样返回
      return stored;
    }
  }
  return stored;
}

export interface AiProvider {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  apiKey: string;
  createdAt: string;
}

export interface AiModel {
  id: string;
  providerId: string;
  name: string;
  displayName?: string;
  enabled: boolean;
  thinking: boolean;
  maxContext?: number;
  priority: number;
  lastError?: string;
  lastUsedAt?: string;
  createdAt: string;
}

function rowToProvider(row: any): AiProvider {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    baseUrl: row.base_url,
    apiKey: decryptApiKey(row.api_key || ''),
    createdAt: row.created_at,
  };
}

function rowToModel(row: any): AiModel {
  return {
    id: row.id,
    providerId: row.provider_id,
    name: row.name,
    displayName: row.display_name || undefined,
    enabled: row.enabled === 1,
    thinking: row.thinking === 1,
    maxContext: row.max_context || undefined,
    priority: row.priority,
    lastError: row.last_error || undefined,
    lastUsedAt: row.last_used_at || undefined,
    createdAt: row.created_at,
  };
}

export function getAllProviders(): AiProvider[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM ai_providers ORDER BY created_at ASC');
  const rows: any[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows.map(rowToProvider);
}

export function getProviderById(id: string): AiProvider | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM ai_providers WHERE id = ?');
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return rowToProvider(row);
  }
  stmt.free();
  return null;
}

export function getAllModels(): AiModel[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM ai_models ORDER BY priority ASC');
  const rows: any[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows.map(rowToModel);
}

export function getModelById(id: string): AiModel | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM ai_models WHERE id = ?');
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return rowToModel(row);
  }
  stmt.free();
  return null;
}

export function getEnabledModelsOrdered(): AiModel[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM ai_models WHERE enabled = 1 ORDER BY priority ASC');
  const rows: any[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows.map(rowToModel);
}

export function saveProvider(input: any): AiProvider {
  const db = getDb();
  const encryptedKey = encryptApiKey(input.apiKey || '');
  const isUpdate = input.id && getProviderById(input.id);
  if (isUpdate) {
    db.run(
      'UPDATE ai_providers SET name = ?, type = ?, base_url = ?, api_key = ? WHERE id = ?',
      [input.name, input.type, input.baseUrl, encryptedKey, input.id]
    );
    saveDb();
    return getProviderById(input.id)!;
  }
  const id = input.id || uuidv4();
  db.run(
    'INSERT INTO ai_providers (id, name, type, base_url, api_key, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, input.name, input.type, input.baseUrl, encryptedKey, new Date().toISOString()]
  );
  saveDb();
  return getProviderById(id)!;
}

export function deleteProvider(id: string): boolean {
  const db = getDb();
  const target = getProviderById(id);
  if (!target) return false;

  db.run('DELETE FROM ai_models WHERE provider_id = ?', [id]);
  db.run('DELETE FROM ai_providers WHERE id = ?', [id]);

  // 重排 priority
  const remain = getAllModels();
  db.run('UPDATE ai_models SET priority = priority + 100000');
  remain.forEach((m, idx) => {
    db.run('UPDATE ai_models SET priority = ? WHERE id = ?', [idx, m.id]);
  });
  saveDb();
  return true;
}

export function saveModel(input: any): AiModel {
  const db = getDb();
  const isUpdate = input.id && getModelById(input.id);
  if (isUpdate) {
    db.run(
      'UPDATE ai_models SET name = ?, display_name = ?, thinking = ?, max_context = ? WHERE id = ?',
      [input.name, input.displayName || null, input.thinking ? 1 : 0, input.maxContext || null, input.id]
    );
    saveDb();
    return getModelById(input.id)!;
  }
  if (!input.providerId) throw new Error('providerId 不能为空');

  const maxStmt = db.prepare('SELECT COALESCE(MAX(priority), -1) AS m FROM ai_models');
  maxStmt.step();
  const max = (maxStmt.getAsObject() as any).m;
  maxStmt.free();
  const id = input.id || uuidv4();
  db.run(
    'INSERT INTO ai_models (id, provider_id, name, display_name, enabled, thinking, max_context, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, input.providerId, input.name, input.displayName || null, input.enabled === false ? 0 : 1, input.thinking ? 1 : 0, input.maxContext || null, max + 1, new Date().toISOString()]
  );
  saveDb();
  return getModelById(id)!;
}

export function deleteModel(id: string): boolean {
  const db = getDb();
  const target = getModelById(id);
  if (!target) return false;
  db.run('DELETE FROM ai_models WHERE id = ?', [id]);
  db.run('UPDATE ai_models SET priority = priority - 1 WHERE priority > ?', [target.priority]);
  saveDb();
  return true;
}

export function setModelEnabled(id: string, enabled: boolean): boolean {
  const db = getDb();
  db.run('UPDATE ai_models SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
  saveDb();
  return true;
}

export function reorderModels(sortedIds: string[]): void {
  const db = getDb();
  db.run('UPDATE ai_models SET priority = priority + 100000');
  sortedIds.forEach((id, idx) => {
    db.run('UPDATE ai_models SET priority = ? WHERE id = ?', [idx, id]);
  });
  saveDb();
}

export function updateModelRuntime(id: string, fields: { lastError?: string | null; lastUsedAt?: string | null }): void {
  const db = getDb();
  const sets: string[] = [];
  const args: any[] = [];
  if ('lastError' in fields) {
    sets.push('last_error = ?');
    args.push(fields.lastError || null);
  }
  if ('lastUsedAt' in fields) {
    sets.push('last_used_at = ?');
    args.push(fields.lastUsedAt || null);
  }
  if (sets.length === 0) return;
  args.push(id);
  db.run(`UPDATE ai_models SET ${sets.join(', ')} WHERE id = ?`, args);
  saveDb();
}

export function isLocalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      /^192\.168\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    );
  } catch { return false; }
}
