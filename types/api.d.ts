/**
 * Electron IPC API 类型定义
 *
 * 定义了渲染进程（React 前端）与主进程之间通信的完整接口。
 * 所有方法通过 preload.js 中的 contextBridge 暴露到 window.api 上。
 *
 * 接口分为以下几组：
 * 1. 备忘录 CRUD 操作
 * 2. 图片/附件管理
 * 3. 标签管理
 * 4. 数据导入导出
 * 5. Webhook 测试
 * 6. AI 助手（Provider/Model/对话/流式）
 * 7. 事件监听
 */

import { Memo, MemoFormData, ReminderData, ImageResult, Attachment, Tag } from './memo';
import { AiProvider, AiProviderInput, AiModel, AiModelInput, AiMessage, AiChatArgs, AiStreamChunk, AiChatResult, AiConversationMeta, AiConversation, AiTestResult } from './ai';

export interface ElectronAPI {
  // ==================== 备忘录 CRUD ====================

  /** 获取所有未删除的备忘录列表 */
  getMemos: () => Promise<Memo[]>;
  /** 根据关键词搜索备忘录（标题和内容模糊匹配） */
  searchMemos: (keyword: string) => Promise<Memo[]>;
  /** 创建新备忘录 */
  addMemo: (memo: MemoFormData) => Promise<Memo>;
  /** 更新已有备忘录（需包含 id 字段） */
  updateMemo: (memo: MemoFormData) => Promise<Memo | null>;
  /** 软删除备忘录（移入回收站，30 天后自动清理） */
  deleteMemo: (id: string) => Promise<boolean>;
  /** 获取回收站中的备忘录列表 */
  getTrash: () => Promise<Memo[]>;
  /** 从回收站恢复备忘录 */
  restoreMemo: (id: string) => Promise<Memo | null>;
  /** 永久删除备忘录（不可恢复） */
  permanentDelete: (id: string) => Promise<boolean>;
  /** 清空回收站（永久删除所有已删除的备忘录） */
  emptyTrash: () => Promise<boolean>;
  /** 切换备忘录完成状态 */
  toggleComplete: (id: string) => Promise<Memo | null>;
  /** 切换备忘录置顶状态 */
  togglePin: (id: string) => Promise<Memo | null>;

  // ==================== 图片/附件管理 ====================

  /** 通过系统文件选择器选取图片并保存到应用数据目录 */
  selectImage: () => Promise<ImageResult | null>;
  /** 保存拖拽到编辑器的图片文件 */
  saveDroppedImage: (filePath: string) => Promise<ImageResult | null>;
  /** 获取已存储图片的完整路径（用于渲染） */
  getImagePath: (fileName: string) => Promise<string>;
  /** 通过系统文件选择器选取附件并保存 */
  selectAttachment: () => Promise<Attachment | null>;
  /** 保存拖拽到编辑器的非图片文件 */
  saveDroppedFile: (filePath: string) => Promise<Attachment | null>;
  /** 使用系统默认程序打开附件 */
  openAttachment: (filePath: string) => Promise<void>;

  // ==================== 标签管理 ====================

  /** 获取所有标签 */
  getTags: () => Promise<Tag[]>;
  /** 创建新标签 */
  addTag: (tag: { name: string; color?: string }) => Promise<Tag>;
  /** 更新标签信息（名称/颜色） */
  updateTag: (tag: Tag) => Promise<Tag>;
  /** 删除标签（不影响已关联的备忘录） */
  deleteTag: (id: string) => Promise<boolean>;

  // ==================== 数据导入导出 ====================

  /** 导出所有数据为 ZIP 文件（含备忘录 JSON + 图片/附件） */
  exportData: () => Promise<{ success: boolean; path?: string; count?: number; error?: string }>;
  /** 从 ZIP 文件导入数据（自动去重） */
  importData: () => Promise<{ success: boolean; imported?: number; skipped?: number; tagsImported?: number; error?: string }>;

  // ==================== Webhook ====================

  /** 测试企微 Webhook 推送（发送一条测试消息） */
  testWebhook: (url: string, content: string, memo: { title: string; content: string; tags: string[] }) => Promise<{ success: boolean; status?: number; body?: string; error?: string }>;

  // ==================== AI 助手 ====================

  // --- Provider 管理 ---
  /** 获取所有 AI Provider 列表 */
  aiGetProviders: () => Promise<AiProvider[]>;
  /** 创建或更新 AI Provider */
  aiSaveProvider: (provider: AiProviderInput) => Promise<AiProvider>;
  /** 删除 AI Provider（同时删除其下所有模型） */
  aiDeleteProvider: (id: string) => Promise<boolean>;

  // --- Model 管理 ---
  /** 获取所有 AI 模型列表（按优先级排序） */
  aiGetModels: () => Promise<AiModel[]>;
  /** 创建或更新 AI 模型 */
  aiSaveModel: (model: AiModelInput) => Promise<AiModel>;
  /** 删除 AI 模型 */
  aiDeleteModel: (id: string) => Promise<boolean>;
  /** 启用/禁用模型（禁用后不参与 Auto 模式调度） */
  aiToggleModel: (id: string, enabled: boolean) => Promise<boolean>;
  /** 批量更新模型全局优先级顺序（传入排序后的 ID 数组） */
  aiReorderModels: (sortedIds: string[]) => Promise<boolean>;
  /** 测试模型连接是否正常（发送简单请求验证） */
  aiTestModel: (provider: AiProviderInput, modelName: string, thinking: boolean) => Promise<AiTestResult>;
  /** 获取 Ollama 服务上已安装的本地模型列表 */
  aiOllamaModels: (baseUrl: string) => Promise<{ success: boolean; models: string[]; error?: string }>;

  // --- Prompt 模板 ---
  /** 获取当前自定义系统提示词模板（空字符串表示使用默认） */
  aiGetPromptTemplate: () => Promise<string>;
  /** 设置自定义系统提示词模板 */
  aiSetPromptTemplate: (template: string) => Promise<boolean>;

  // --- 对话功能 ---
  /** 检查当前是否有可用的 AI 模型（至少一个启用且 Provider 配置正确） */
  aiHasUsableModel: () => Promise<boolean>;
  /** 非流式 AI 对话（一次性返回完整回复，适用于简单场景） */
  aiChat: (args: AiChatArgs | AiMessage[]) => Promise<AiChatResult>;
  /**
   * 流式 AI 对话
   * 通过 onChunk 回调逐块接收响应，支持实时展示思考过程和内容生成。
   * @returns streamId 用于后续取消流式请求
   */
  aiChatStream: (args: AiChatArgs, onChunk: (chunk: AiStreamChunk) => void) => string;
  /** 取消流式请求（停止接收后续 chunk） */
  aiChatStreamOff: (streamId: string) => void;

  // --- 对话历史 ---
  /** 获取所有对话记录的元数据列表（按更新时间倒序） */
  aiGetConversations: () => Promise<AiConversationMeta[]>;
  /** 获取某个对话的完整内容（含所有消息） */
  aiGetConversation: (id: string) => Promise<AiConversation | null>;
  /** 保存/更新对话记录 */
  aiSaveConversation: (conv: { id: string; title?: string; messages: AiMessage[] }) => Promise<boolean>;
  /** 删除单个对话记录 */
  aiDeleteConversation: (id: string) => Promise<boolean>;
  /** 清空所有对话历史 */
  aiClearConversations: () => Promise<boolean>;

  // ==================== 事件监听 ====================

  /** 监听提醒事件（主进程调度器触发时通知渲染进程弹窗） */
  onReminder: (callback: (data: ReminderData) => void) => void;
  /** 监听备忘录数据变更事件（API Server 或其他来源修改数据时通知刷新） */
  onMemosChanged: (callback: () => void) => void;
}

/**
 * 全局 Window 扩展声明
 *
 * 将 ElectronAPI 挂载到 window.api，使渲染进程可直接调用。
 */
declare global {
  interface Window {
    api: ElectronAPI;
  }
}
