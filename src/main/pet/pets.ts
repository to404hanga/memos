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
 * 在目录中查找精确匹配 {action}.gif 的文件
 */
function findGif(dir: string, action: string): string | null {
  const filePath = path.join(dir, `${action}.gif`);
  return fs.existsSync(filePath) ? filePath : null;
}

function scanPetsInDir(dir: string, source: 'builtin' | 'user'): PetMeta[] {
  const pets: PetMeta[] = [];
  if (!fs.existsSync(dir)) return pets;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const petDir = path.join(dir, entry.name);
    const metaPath = path.join(petDir, 'meta.json');

    // 至少需要 idle.gif 才算有效宠物包
    if (!fs.existsSync(path.join(petDir, 'idle.gif'))) continue;

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
 * 精确匹配 {action}.gif
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
    running_left: 'running-left',
    running_right: 'running-right',
  };

  const action = STATE_KEYWORD_MAP[state] || 'idle';
  return findGif(pet.dir, action);
}

/**
 * 获取默认宠物 ID（第一个内置宠物）
 */
export function getDefaultPetId(): string {
  const pets = getAllPets();
  return pets.length > 0 ? pets[0].id : '';
}

/**
 * 所有可用的标准动作名
 */
export const PET_ACTIONS = [
  { action: 'idle', label: '待机', required: true },
  { action: 'running', label: 'AI 工作中' },
  { action: 'running-left', label: '向左跑' },
  { action: 'running-right', label: '向右跑' },
  { action: 'waving', label: '完成/庆祝' },
  { action: 'failed', label: '失败/焦急' },
  { action: 'jumping', label: '跳跃/提醒' },
  { action: 'waiting', label: '等待/睡眠' },
  { action: 'review', label: '审视/确认' },
];

/**
 * 导入宠物包
 * @param petName 宠物名称（将作为目录名和 ID）
 * @param actionMap 动作 → 源 GIF 文件绝对路径 的映射
 */
export function importPetPack(petName: string, actionMap: Record<string, string>): { success: boolean; error?: string } {
  if (!actionMap['idle']) {
    return { success: false, error: '必须提供 idle 动作的 GIF' };
  }

  const userDir = getUserPetsDir();
  const petId = petName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const petDir = path.join(userDir, petId);

  // 创建目录
  if (!fs.existsSync(petDir)) {
    fs.mkdirSync(petDir, { recursive: true });
  }

  // 复制并重命名 GIF
  for (const [action, srcPath] of Object.entries(actionMap)) {
    if (!srcPath || !fs.existsSync(srcPath)) continue;
    const destPath = path.join(petDir, `${action}.gif`);
    fs.copyFileSync(srcPath, destPath);
  }

  // 写入 meta.json
  const meta = { id: petId, name: petName, description: '', author: 'user' };
  fs.writeFileSync(path.join(petDir, 'meta.json'), JSON.stringify(meta, null, 2));

  return { success: true };
}

/**
 * 删除用户导入的宠物包
 */
export function deleteUserPet(petId: string): { success: boolean; error?: string } {
  const pet = getPetById(petId);
  if (!pet) return { success: false, error: '宠物不存在' };
  if (pet.source !== 'user') return { success: false, error: '不能删除内置宠物' };

  fs.rmSync(pet.dir, { recursive: true, force: true });
  return { success: true };
}

/**
 * 获取宠物包已有的动作 GIF 列表
 */
export function getPetActions(petId: string): { action: string; exists: boolean }[] {
  const pet = getPetById(petId);
  if (!pet) return [];

  return PET_ACTIONS.map(({ action }) => ({
    action,
    exists: fs.existsSync(path.join(pet.dir, `${action}.gif`)),
  }));
}
