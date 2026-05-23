/**
 * AI 工具定义模块
 *
 * 定义了 AI 助手可用的工具列表：
 * - create_memo: 创建备忘录（客户端工具）
 * - list_memos: 查询备忘录列表（服务端工具）
 * - complete_memo: 标记完成/取消完成（服务端工具）
 * - delete_memo: 删除备忘录（服务端工具）
 * - update_memo: 修改备忘录字段（服务端工具）
 */

export const CLIENT_TOOLS = new Set(['create_memo']);
export const SERVER_TOOLS = new Set(['list_memos', 'complete_memo', 'delete_memo', 'update_memo']);

export const AI_TOOLS_OPENAI = [
  {
    type: 'function',
    function: {
      name: 'create_memo',
      description: '创建一条新的备忘录/待办。仅生成预览卡片，由用户点击「✓ 创建」后才会真正写入数据库。所以可以放心调用，无需先反复确认。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '备忘录标题' },
          content: { type: 'string', description: '正文内容（Markdown）' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签列表' },
          reminderTime: { type: 'string', description: 'ISO 8601 格式的提醒时间，如 2026-05-21T15:00:00+08:00' },
          recurrence: {
            type: 'object', description: '周期提醒配置。type=weekly 时必须提供 dayOfWeek；type=monthly 时必须提供 dayOfMonth',
            properties: {
              type: { type: 'string', enum: ['once', 'daily', 'workday', 'weekly', 'monthly'] },
              hour: { type: 'number', description: '提醒的小时（0-23）' },
              minute: { type: 'number', description: '提醒的分钟（0-59）' },
              dayOfWeek: { type: 'number', description: 'weekly 必填。0=周日, 1=周一, ..., 6=周六' },
              dayOfMonth: { type: 'number', description: 'monthly 必填。每月几号（1-31）' },
            },
            required: ['type', 'hour', 'minute'],
          },
          mutePeriods: {
            type: 'array',
            description: '静默期列表，在这些日期范围内不提醒',
            items: {
              type: 'object',
              properties: {
                from: { type: 'string', description: '起始日期 YYYY-MM-DD' },
                to: { type: 'string', description: '结束日期 YYYY-MM-DD' },
              },
              required: ['from', 'to'],
            },
          },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_memos',
      description: '查询用户已有的备忘录/待办列表。可按关键词、标签、状态、时间范围筛选。支持多关键词（AND 交集匹配）。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '在标题或内容中搜索的关键词（多个词空格分隔，取交集），可选' },
          keywords: { type: 'array', items: { type: 'string' }, description: '多关键词数组（OR 并集匹配，适合同义词/近义词扩展搜索），可选。若同时提供 keyword 和 keywords，将合并使用' },
          tag: { type: 'string', description: '只返回包含此标签的备忘录，可选' },
          status: { type: 'string', enum: ['all', 'active', 'completed'], description: '过滤状态' },
          dateFrom: { type: 'string', description: '起始日期（含），ISO 8601 或 YYYY-MM-DD 格式，可选' },
          dateTo: { type: 'string', description: '截止日期（含），ISO 8601 或 YYYY-MM-DD 格式，可选' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_memo',
      description: '标记一条备忘录为已完成（或取消完成）。接受标题的模糊关键词或精确 ID。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '备忘录的标题关键词或 ID' },
          undo: { type: 'boolean', description: '设为 true 则取消完成' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_memo',
      description: '删除一条备忘录（移入回收站）。接受标题的模糊关键词或精确 ID。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '备忘录的标题关键词或 ID' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_memo',
      description: '修改一条已有的备忘录。通过标题关键词或 ID 定位，然后更新指定字段。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '备忘录的标题关键词或精确 ID' },
          title: { type: 'string', description: '新标题（可选）' },
          content: { type: 'string', description: '新内容 Markdown（可选）' },
          tags: { type: 'array', items: { type: 'string' }, description: '新标签列表（可选）' },
          addTags: { type: 'array', items: { type: 'string' }, description: '追加标签' },
          removeTags: { type: 'array', items: { type: 'string' }, description: '移除指定标签' },
          reminderTime: { type: 'string', description: '新的提醒时间 ISO 8601' },
          recurrence: {
            type: 'object', description: '新的周期提醒配置',
            properties: {
              type: { type: 'string', enum: ['once', 'daily', 'workday', 'weekly', 'monthly'] },
              hour: { type: 'number' }, minute: { type: 'number' },
              dayOfWeek: { type: 'number' }, dayOfMonth: { type: 'number' },
            },
          },
        },
        required: ['query'],
      },
    },
  },
];

export const AI_TOOLS_ANTHROPIC = AI_TOOLS_OPENAI.map((t) => ({
  name: t.function.name,
  description: t.function.description,
  input_schema: t.function.parameters,
}));
