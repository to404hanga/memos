/**
 * 宠物包扫描与管理
 * 扫描内置和用户自定义宠物包，提供统一的宠物列表
 */
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

export interface PetMeta {
  id: string;
  name: string;
  description: string;
  author: string;
  source: 'builtin' | 'user'; // 来源：内置 or 用户导入
  dir: string;                 // 宠物包绝对路径
}

// 内置宠物目录
function getBuiltinPetsDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar', 'assets', 'pets');
  }
  return path.join(__dirname, '..', '..', 'assets', 'pets');
}

// 用户自定义宠物目录
function getUserPetsDir(): string {
  const dir = path.join(app.getPath('userData'), 'pets');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * 在目录中查找匹配 *{keyword}*.gif 的第一个文件
 * 例如 findGif(dir, 'idle') 可匹配 idle.gif / becky-idle.gif / my-idle-anim.gif
 */
function findGif(dir: string, keyword: string): string | null {
  try {
    const files = fs.readdirSync(dir);
    const match = files.find(f => f.includes(keyword) && f.endsWith('.gif'));
    return match ? path.join(dir, match) : null;
  } catch {
    return null;
  }
}

function scanPetsInDir(dir: string, source: 'builtin' | 'user'): PetMeta[] {
  const pets: PetMeta[] = [];
  if (!fs.existsSync(dir)) return pets;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const petDir = path.join(dir, entry.name);
    const metaPath = path.join(petDir, 'meta.json');

    // 至少需要 *idle*.gif 才算有效宠物包
    if (!findGif(petDir, 'idle')) continue;

    let meta: Partial<PetMeta> = {};
    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      } catch {}
    }

    pets.push({
      id: meta.id || entry.name,
      name: meta.name || entry.name,
      description: meta.description || '',
      author: meta.author || 'unknown',
      source,
      dir: petDir,
    });
  }
  return pets;
}

/**
 * 获取所有可用宠物列表（内置 + 用户，用户同 ID 覆盖内置）
 */
export function getAllPets(): PetMeta[] {
  const builtinPets = scanPetsInDir(getBuiltinPetsDir(), 'builtin');
  const userPets = scanPetsInDir(getUserPetsDir(), 'user');

  // 用户同 ID 宠物覆盖内置
  const petMap = new Map<string, PetMeta>();
  for (const pet of builtinPets) {
    petMap.set(pet.id, pet);
  }
  for (const pet of userPets) {
    petMap.set(pet.id, pet);
  }

  return Array.from(petMap.values());
}

/**
 * 根据宠物 ID 获取宠物包信息
 */
export function getPetById(petId: string): PetMeta | undefined {
  return getAllPets().find(p => p.id === petId);
}

/**
 * 获取宠物某个状态的 GIF 文件路径
 * 
 * 直接使用 *{keyword}*.gif 通配匹配，兼容任何命名格式：
 * - idle.gif / becky-idle.gif / my-idle-anim.gif 都能匹配
 */
export function getPetGifPath(petId: string, state: string): string | null {
  const pet = getPetById(petId);
  if (!pet) return null;

  const STATE_KEYWORD_MAP: Record<string, string> = {
    idle: 'idle',
    reminder: 'jumping',
    ai_working: 'running',
    all_done: 'waving',
    overdue: 'failed',
    sleeping: 'waiting',
    review: 'review',
    failed: 'failed',
  };

  const keyword = STATE_KEYWORD_MAP[state] || 'idle';
  return findGif(pet.dir, keyword);
}

/**
 * 获取默认宠物 ID（第一个内置宠物）
 */
export function getDefaultPetId(): string {
  const pets = getAllPets();
  return pets.length > 0 ? pets[0].id : '';
}
