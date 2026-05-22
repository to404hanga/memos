# 备忘录提醒 (Memo Reminder)

一个简洁美观的桌面备忘录应用，支持 Markdown 编辑、图片插入、周期提醒和时间轴视图。

## 功能

- 创建、编辑、删除备忘录
- 搜索功能：按标题/内容关键词实时搜索
- 标签/分类：创建自定义标签，按标签筛选备忘录
- 置顶功能：重要备忘录置顶显示
- 正文支持 Markdown 格式（标题、粗体、列表、代码块、引用等）
- 实时 Markdown 编辑器：左右分栏同步编辑+预览，快捷工具栏
- 支持插入本地图片，支持拖拽图片到编辑区
- 附件支持：可添加 PDF、文档、压缩包等任意类型文件，支持拖拽和点击打开
- 灵活的提醒方式：
  - 支持同一备忘录设置多个提醒
  - 单次提醒：指定具体日期时间
  - 每天提醒：固定时间重复
  - 工作日提醒：每个工作日提醒（支持中国法定假日和调休）
  - 每周提醒：指定星期几和时间
  - 每月提醒：指定几号和时间
- 到时桌面通知 + 应用内弹窗双重提醒
- 周期提醒触发后自动调度下一次
- 静默期：指定日期范围内暂停提醒（适合出差/休假）
- 时间轴视图：中轴线布局，备忘项按日期分组、左右交替展示
- 日历视图：月历形式查看有提醒的日期，点击日期查看详情
- 看板视图：类 Trello 的三列看板（待办/进行中/已完成），支持拖拽移动
- 列表视图：按状态筛选（全部/待办/已完成）
- 标记完成/未完成
- 回收站：删除后可恢复，30 天后自动清理
- 暗色模式：自动跟随系统 / 浅色 / 深色三种模式
- 系统托盘常驻，关闭窗口不退出
- SQLite 本地数据库持久化存储
- 导入/导出：ZIP 格式打包备忘录数据和图片，跨设备迁移
- Webhook：提醒触发时自动推送到企微机器人（Markdown 格式，支持模板变量）
- CLI 命令行：全部功能可通过 `memo` 命令操作，与 GUI 共享数据

## 运行

```bash
# 安装依赖
npm install

# 构建主进程 + 渲染进程，然后运行
npm run build:main && npx webpack build --mode production && npx electron .

# 开发模式（前端热更新）
npm run dev
# 修改主进程代码后需要手动重新构建：
npm run build:main

# 注册 CLI 全局命令
npm link
```

## 项目结构

```
src/
├── main/               # Electron 主进程（TypeScript）
│   ├── index.ts        # 入口：窗口/托盘/生命周期
│   ├── database/       # SQLite 数据库初始化和 CRUD
│   ├── scheduler/      # 提醒调度（含中国假日判断）
│   ├── ai/             # AI 多模型调用引擎
│   ├── ipc/            # IPC handler
│   ├── api-server/     # CLI HTTP API
│   └── webhook/        # 企微 Webhook 推送
├── hooks/              # React 自定义 Hooks
│   ├── useTheme.ts     # 主题管理
│   └── useMemos.ts     # 备忘录状态管理
├── components/         # React 组件
├── styles/             # CSS 变量
├── App.tsx             # 主应用组件
└── index.tsx           # React 入口
```

## CLI 使用

> 需要 GUI 应用已启动（CLI 通过本地 HTTP API 与 GUI 通信）

```bash
memo list                          # 列出待办
memo list -a -v                    # 列出全部（含已完成），显示内容预览
memo search 关键词                  # 搜索
memo show <id>                     # 查看详情（id 可只写前几位）
memo add "开会" -r "2026-05-15 10:00"  # 新建 + 提醒
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

- Electron（桌面框架）
- React + TypeScript（UI 组件）
- Marked（Markdown 解析渲染）
- sql.js（SQLite 本地数据库）
