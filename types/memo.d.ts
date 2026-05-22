/**
 * 备忘录核心类型定义
 *
 * 定义了备忘录系统中所有核心数据结构，包括：
 * - 周期提醒配置（Recurrence）
 * - 静默期配置（MutePeriod）
 * - 附件信息（Attachment）
 * - 标签管理（Tag）
 * - 企微 Webhook 推送配置（WebhookConfig）
 * - 备忘录实体（Memo）及表单数据（MemoFormData）
 */

/**
 * 周期提醒配置
 *
 * 支持单次提醒和多种周期提醒模式：
 * - once: 单次提醒，需指定具体时间 (time 字段)
 * - daily: 每天提醒，需指定 hour + minute
 * - workday: 工作日提醒（自动跳过周末和中国法定假日）
 * - weekly: 每周提醒，需指定 dayOfWeek + hour + minute
 * - monthly: 每月提醒，需指定 dayOfMonth + hour + minute
 */
export interface Recurrence {
  /** 提醒类型 */
  type: 'once' | 'daily' | 'workday' | 'weekly' | 'monthly';
  /** 单次提醒的 ISO 时间字符串，仅 type='once' 时使用 */
  time?: string;
  /** 提醒时刻 - 小时（0-23），周期提醒时使用 */
  hour?: number;
  /** 提醒时刻 - 分钟（0-59），周期提醒时使用 */
  minute?: number;
  /** 星期几（0=周日, 1=周一, ..., 6=周六），仅 type='weekly' 时使用 */
  dayOfWeek?: number;
  /** 每月几号（1-31），仅 type='monthly' 时使用 */
  dayOfMonth?: number;
}

/**
 * 静默期配置
 *
 * 在静默期内，即使有周期提醒也不会触发通知。
 * 适用于请假、出差等场景，避免不必要的提醒打扰。
 */
export interface MutePeriod {
  /** 静默期开始日期，格式: YYYY-MM-DD */
  from: string;
  /** 静默期结束日期，格式: YYYY-MM-DD */
  to: string;
}

/**
 * 附件信息
 *
 * 附件存储在应用数据目录的 attachments 文件夹中，
 * 文件名使用 UUID 重命名以避免冲突，同时保留原始文件名用于展示。
 */
export interface Attachment {
  /** 存储时的文件名（UUID 格式，确保唯一性） */
  fileName: string;
  /** 原始文件名（用于界面展示） */
  originalName: string;
  /** 文件大小（字节） */
  size: number;
  /** 文件的完整存储路径 */
  filePath: string;
}

/**
 * 标签
 *
 * 用于对备忘录进行分类管理，支持自定义颜色。
 * 标签数据独立存储，多个备忘录可共享同一标签。
 */
export interface Tag {
  /** 标签唯一标识（UUID） */
  id: string;
  /** 标签名称（用户可见） */
  name: string;
  /** 标签颜色（CSS 色值，如 #007aff） */
  color: string;
}

/**
 * 企业微信 Webhook 推送配置
 *
 * 当备忘录提醒触发时，可同时向企业微信群发送通知消息。
 * 支持 Markdown 格式的消息模板，可使用变量替换：
 * - {{title}} - 备忘录标题
 * - {{content}} - 备忘录内容
 * - {{tags}} - 标签列表
 * - {{time}} - 提醒时间
 */
export interface WebhookConfig {
  /** 是否启用 Webhook 推送 */
  enabled: boolean;
  /** 企业微信 Webhook 地址 */
  url: string;
  /** 推送内容模板（支持 Markdown 和变量替换） */
  content: string;
}

/**
 * 备忘录完整实体
 *
 * 代表数据库中一条完整的备忘录记录，包含所有字段。
 * 置顶项在列表中会排在最前面，已完成项可通过筛选器查看。
 * 删除操作为软删除（设置 deletedAt），30 天后自动清理。
 */
export interface Memo {
  /** 备忘录唯一标识（UUID） */
  id: string;
  /** 标题（必填） */
  title: string;
  /** 内容（支持 Markdown 格式） */
  content: string;
  /** 最近一次提醒时间（ISO 格式），用于列表展示和排序 */
  reminderTime: string | null;
  /** 兼容旧数据的单个周期配置（新版使用 reminders 数组） */
  recurrence: Recurrence | null;
  /** 多提醒配置数组，一个备忘录可设置多个不同类型的提醒 */
  reminders: Recurrence[];
  /** 静默期列表，在这些日期范围内不触发提醒 */
  mutePeriods: MutePeriod[];
  /** 附件列表 */
  attachments: Attachment[];
  /** 企微 Webhook 配置，null 表示未启用 */
  webhook: WebhookConfig | null;
  /** 是否已完成 */
  completed: boolean;
  /** 是否置顶（置顶项在看板视图中归入"进行中"列） */
  pinned: boolean;
  /** 关联的标签名称列表 */
  tags: string[];
  /** 创建时间（ISO 格式） */
  createdAt: string;
  /** 软删除时间（ISO 格式），null 表示未删除 */
  deletedAt: string | null;
}

/**
 * 备忘录表单数据
 *
 * 用于创建和编辑备忘录时提交的数据结构。
 * 与 Memo 相比，大部分字段为可选（创建时可不填）。
 * 编辑时需提供 id 字段以标识目标记录。
 */
export interface MemoFormData {
  /** 备忘录 ID，编辑时必填，创建时不传 */
  id?: string;
  /** 标题（必填） */
  title: string;
  /** 内容（Markdown 格式） */
  content: string;
  /** 最近一次提醒时间 */
  reminderTime?: string | null;
  /** 旧版单周期配置（兼容） */
  recurrence?: Recurrence | null;
  /** 多提醒配置 */
  reminders?: Recurrence[];
  /** 静默期列表 */
  mutePeriods?: MutePeriod[];
  /** 附件列表 */
  attachments?: Attachment[];
  /** Webhook 配置 */
  webhook?: WebhookConfig | null;
  /** 标签名称列表 */
  tags?: string[];
}

/**
 * 提醒弹窗数据
 *
 * 当提醒时间到达时，主进程通过 IPC 向渲染进程发送此数据，
 * 渲染进程收到后展示提醒弹窗。
 */
export interface ReminderData {
  /** 触发提醒的备忘录 ID */
  id: string;
  /** 备忘录标题 */
  title: string;
  /** 备忘录内容（用于弹窗展示） */
  content: string;
}

/**
 * 图片选择/保存结果
 *
 * 用户通过文件选择器或拖拽插入图片后返回的结果，
 * 包含图片的存储文件名和完整路径，用于在 Markdown 中引用。
 */
export interface ImageResult {
  /** 存储的文件名 */
  fileName: string;
  /** 图片的完整存储路径（用于 Markdown 引用） */
  filePath: string;
}
