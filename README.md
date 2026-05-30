# 备忘录提醒 (Memo Reminder)

一个简洁美观的桌面备忘录应用，支持 Markdown 编辑、图片插入、周期提醒、多视图切换、AI 助手、语音输入和桌面宠物。

## 功能

### 核心

- 创建、编辑、删除备忘录
- 搜索功能：按标题/内容关键词实时搜索
- 标签/分类：创建自定义标签（含颜色），按标签筛选备忘录
- 置顶功能：重要备忘录置顶显示
- 标记完成/未完成
- 回收站：删除后可恢复，30 天后自动清理

### 编辑器

- 正文支持 Markdown 格式（标题、粗体、列表、代码块、引用等）
- 实时 Markdown 编辑器：左右分栏同步编辑+预览，快捷工具栏
- 支持插入本地图片，支持拖拽图片到编辑区
- 附件支持：可添加 PDF、文档、压缩包等任意类型文件，支持拖拽和点击打开

### 提醒

- 支持同一备忘录设置多个提醒
- 单次提醒：指定具体日期时间
- 每天提醒：固定时间重复
- 工作日提醒：每个工作日提醒（支持中国法定假日和调休）
- 每周提醒：指定星期几和时间
- 每月提醒：指定几号和时间
- 到时桌面通知 + 桌宠弹窗提醒（支持完成/延后5分钟）
- 周期提醒触发后自动调度下一次
- 静默期：指定日期范围内暂停提醒（适合出差/休假）

### 视图

- 列表视图：按状态筛选（全部/待办/已完成）
- 时间轴视图：中轴线布局，备忘项按日期分组、左右交替展示
- 日历视图：月历形式查看有提醒的日期，点击日期查看详情
- 看板视图：类 Trello 的三列看板（待办/进行中/已完成），支持拖拽移动

### AI 助手

- 内置多模型 AI 对话，支持流式响应
- 支持 OpenAI 兼容协议（DeepSeek/通义/智谱/混元/Moonshot 等）、Anthropic Claude、Ollama 本地模型
- AI 工具调用：可直接操作备忘录（创建/查询/编辑/完成等）
- 上下文压缩策略，支持长对话
- Provider 降级机制，多模型自动切换
- 对话历史管理

### 语音输入

- AI 侧边栏支持语音输入，点击麦克风按钮录音
- 本地离线语音识别，基于 Qwen3-ASR-0.6B ONNX 模型（sherpa-onnx 推理引擎）
- 支持 52 种语言和方言（含中文普通话 + 23 种方言 + 英语等）
- 模拟流式识别：实时返回部分结果（partial text），VAD 静音检测自动分段
- AI 润色：识别结果自动流式润色为自然书面语，润色失败回退原始文本
- 热词配置：自定义热词列表提高特定词语识别率
- 纠错映射：自定义纠错规则修正常见识别错误
- 模型按需下载（约 600MB），首次使用时提示下载，支持取消
- 懒加载 + 空闲 5 分钟自动释放，不影响日常使用性能
- 录音最长 5 分钟自动停止
- 全程离线运行，无需联网

### 桌面宠物

- 始终浮动在桌面上的动画角色，作为应用状态的可视化代理
- 支持多宠物包：内置 QQ 企鹅，支持用户导入自定义 GIF 宠物包
- 动画状态与应用联动：
  - `idle` 待机 / `running` AI 工作中 / `waving` 任务完成
  - `failed` 执行失败 / `review` 等待确认 / `jumping` 提醒到期
  - `running-left` / `running-right` 随机漫游 / 拖拽移动
- 单击宠物弹出 AI 对话框，复用完整 AI 助手功能（流式对话、工具调用、创建备忘录）
- 到期提醒弹窗：替代传统应用内弹窗，支持"完成"和"5分钟后提醒"
- 随机漫游：宠物在当前屏幕范围内随机移动，支持多屏
- 拖拽移动 + 位置记忆（跨重启保持位置，多屏感知）：拖动时根据水平方向播放向左/向右运动动画
- 鼠标穿透：透明区域点击穿透，仅宠物区域响应交互
- 对话框智能弹出方向：根据宠物在屏幕中的位置自动选择展开方向
- 桌宠管理面板：查看/切换/导入/删除宠物包，为每个动作指定 GIF

### 其他

- 暗色模式：自动跟随系统 / 浅色 / 深色三种模式
- 系统托盘常驻，关闭窗口不退出
- SQLite 本地数据库持久化存储（sql.js）
- 导入/导出：JSON 格式打包备忘录数据，跨设备迁移
- Webhook：提醒触发时自动推送到企微机器人（Markdown 格式，支持模板变量）
- CLI 命令行：全部功能可通过 `memo` 命令操作，与 GUI 共享数据

## 运行

```bash
# 安装依赖
npm install

# 开发模式（前端热更新 + 主进程 development 构建）
npm run dev

# 生产构建（主进程 + 渲染进程），然后运行
npm run build && npx electron .

# 单独构建主进程
npm run build:main          # 生产模式（tree-shaking + 压缩）
npm run build:main:dev      # 开发模式（source map，便于调试）

# 打包分发
npm run dist:mac            # macOS（dmg + zip）
npm run dist:win            # Windows（nsis + portable）
npm run dist:linux          # Linux（AppImage）

# 注册 CLI 全局命令
npm link
```

## 项目结构

```
src/
├── main/               # Electron 主进程（TypeScript）
│   ├── index.ts        # 入口：窗口/托盘/生命周期
│   ├── database/       # SQLite 数据库
│   │   ├── index.ts    # 初始化 + 迁移
│   │   ├── memo.repo.ts    # 备忘录 CRUD
│   │   ├── ai.repo.ts      # AI 配置/对话持久化
│   │   └── settings.repo.ts # 应用设置
│   ├── services/       # 业务逻辑层（IPC 和 API 共用）
│   ├── scheduler/      # 提醒调度（单 timer 策略 + 系统唤醒检测）
│   ├── ai/             # AI 多模型调用引擎
│   │   ├── providers.ts    # OpenAI / Anthropic / Ollama 调用封装
│   │   ├── tools.ts        # 工具定义
│   │   ├── executor.ts     # 服务端工具执行
│   │   ├── compact.ts      # 上下文压缩策略
│   │   ├── conversation.ts # 对话循环 + Provider 降级
│   │   ├── http.ts         # HTTP 请求工具
│   │   └── index.ts        # 对外接口
│   ├── asr/            # 语音识别模块
│   │   ├── engine.ts       # sherpa-onnx ASR 引擎封装
│   │   ├── downloader.ts   # 模型下载管理
│   │   ├── ipc.ts          # ASR IPC handlers
│   │   └── index.ts        # 模块入口
│   ├── ipc/            # IPC handler
│   ├── pet/            # 桌宠模块
│   │   ├── index.ts       # 模块入口（初始化/位置恢复）
│   │   ├── window.ts      # 透明置顶窗口创建
│   │   ├── state.ts       # 宠物状态机
│   │   ├── pets.ts        # 宠物包扫描/导入/管理
│   │   ├── roaming.ts     # 随机漫游
│   │   └── ipc.ts         # 桌宠 IPC
│   ├── api-server/     # CLI HTTP API（端口 19527）
│   └── webhook/        # 企微 Webhook 推送
├── pet/                # 桌宠渲染进程
│   ├── index.tsx       # React 入口（暗色主题）
│   ├── PetRenderer.tsx # 宠物动画 + 对话框 + 提醒弹窗
│   ├── AIChatDialog.tsx # AI 对话框（复用 useAiChat）
│   └── styles.css      # 桌宠窗口样式
├── hooks/              # React 自定义 Hooks
│   ├── useTheme.ts     # 主题管理（系统/浅色/深色）
│   ├── useMemos.ts     # 备忘录状态管理
│   ├── useAiChat.ts    # AI 对话状态 + 流式处理
│   └── useVoiceInput.ts # 语音输入状态 + AI 润色流
├── components/         # React 组件
│   ├── MemoList.tsx    # 列表视图
│   ├── MemoForm.tsx    # 备忘录表单
│   ├── MemoItem.tsx    # 备忘项卡片
│   ├── Timeline.tsx    # 时间轴视图
│   ├── CalendarView.tsx    # 日历视图
│   ├── KanbanView.tsx      # 看板视图
│   ├── MarkdownView.tsx    # Markdown 渲染
│   ├── ReminderEditor.tsx  # 提醒编辑器
│   ├── AttachmentManager.tsx   # 附件管理
│   ├── VoiceInputButton.tsx    # 语音输入按钮
│   ├── AiChatModal.tsx     # AI 对话弹窗
│   ├── AiMessageList.tsx   # AI 消息列表
│   ├── AiHistoryPanel.tsx  # AI 对话历史
│   ├── AiModelSelector.tsx # AI 模型选择
│   ├── AiPreviewCard.tsx   # AI 预览卡片
│   ├── AiProviderSettings.tsx  # AI Provider 设置
│   ├── PetManagerPanel.tsx    # 桌宠管理面板
│   └── WebhookConfigPanel.tsx  # Webhook 配置
├── styles/
│   └── variables.css   # CSS 变量（主题色/间距等）
├── App.tsx             # 主应用组件
├── index.tsx           # React 入口
└── index.html          # HTML 模板
cli.js                  # CLI 入口（Commander.js）
preload.js              # Electron preload 脚本（主窗口）
preload-pet.js          # Electron preload 脚本（桌宠窗口）
webpack.pet.config.js   # 桌宠渲染进程打包配置
assets/pets/            # 内置桌宠 GIF 资源
```

## CLI 使用

> GUI 运行时通过 HTTP API 通信；GUI 未运行时自动降级为直连数据库模式（提醒调度不可用）

```bash
memo list                          # 列出待办
memo list -a -v                    # 列出全部（含已完成），显示内容预览
memo search 关键词                  # 搜索
memo show <id>                     # 查看详情（id 可只写前几位）
memo add "开会" -r "2026-05-15 10:00"  # 新建 + 提醒
memo add "标题" -c "内容" -t "标签"    # 新建 + 内容 + 标签
memo edit <id> -T "新标题"          # 编辑
memo done <id>                     # 标记完成/未完成
memo pin <id>                      # 置顶/取消
memo delete <id>                   # 删除（移到回收站）
memo trash                         # 查看回收站
memo restore <id>                  # 恢复
memo empty-trash                   # 清空回收站
memo tag ls                        # 列出标签
memo tag add 工作 -c "#ff9500"     # 添加标签
memo export backup.json            # 导出到文件
memo import backup.json            # 从文件导入
```

## 技术栈

- Electron 28（桌面框架）
- React 18 + TypeScript（UI 组件）
- Webpack 5（构建工具）
- sql.js（SQLite 本地数据库，基于 WebAssembly）
- sherpa-onnx-node（离线语音识别引擎，Qwen3-ASR 模型）
- Marked（Markdown 解析渲染）
- DOMPurify（HTML 安全过滤）
- Commander.js（CLI 框架）
