---
name: memo-cli
description: |
  备忘录 CLI 管理工具。当用户提到备忘录、待办事项、提醒、todo、任务管理相关内容时使用此 Skill。
  触发场景包括但不限于：
  - 用户让你帮忙记录一件事、创建待办、添加提醒（如"帮我记一下明天开会"、"提醒我下周交报告"）
  - 用户询问有哪些待办、任务进展（如"我还有什么没做的"、"看看我的备忘录"）
  - 用户让你标记某事完成、删除某个备忘（如"开会的事搞定了"、"那个任务不用了"）
  - 用户让你搜索某个备忘录（如"之前那个关于拨测的备忘在哪"）
  - 用户提到标签管理、导入导出备忘录数据
  - 用户说"记住这个"、"帮我备忘"、"加个 todo"、"加个提醒"
  即使用户没有明确说"备忘录"，只要语义上是在管理任务/待办/提醒，都应该使用此 Skill。
  前提条件：备忘录 GUI 应用需已启动（CLI 通过本地 HTTP API 通信，端口 19527）。
  如果 GUI 未启动，CLI 会自动降级为直连数据库模式（提醒调度不可用，其他功能正常）。
---

# 备忘录 CLI 管理

通过 `memo` 命令管理用户的备忘录。CLI 与桌面 GUI 应用共享数据（SQLite），所有操作实时同步。

## 运行模式

- **GUI 运行时**：CLI 通过本地 HTTP API（127.0.0.1:19527）与 GUI 通信，数据实时同步，支持提醒调度
- **GUI 未运行时**：CLI 自动降级为直连数据库模式（使用 sql.js），增删改查正常，但提醒调度不可用
- 模式检测自动完成，无需手动切换

## 可用命令

### 查看

```bash
memo list                          # 列出未完成的待办
memo list -a                       # 列出全部（含已完成）
memo list -v                       # 显示内容预览
memo list -a -v                    # 全部 + 预览
memo search <关键词>                # 搜索备忘录（按标题和内容匹配）
memo search <关键词> -v             # 搜索 + 预览
memo show <id>                     # 查看详情（含标签、提醒、附件、webhook 等完整信息）
```

> `show` 输出包括：标题、ID、完成/置顶状态、标签、提醒列表、webhook 配置、附件数、创建时间、正文内容。

### 创建

```bash
memo add "标题" -c "正文内容" -t "标签1,标签2" -r "2026-05-15 10:00"
```

参数说明：
- `-c, --content` 正文（支持 Markdown）
- `-t, --tags` 标签，逗号分隔
- `-r, --reminder` 单次提醒时间，格式如 "2026-05-15 10:00"（会自动转为 ISO 格式）

### 编辑

```bash
memo edit <id> -T "新标题" -c "新内容" -t "新标签1,新标签2"
```

参数说明：
- `-T, --title` 修改标题
- `-c, --content` 修改内容
- `-t, --tags` 修改标签（逗号分隔，会替换原有标签）

### 状态操作

```bash
memo done <id>                     # 切换完成/未完成（toggle）
memo pin <id>                      # 切换置顶（toggle）
memo delete <id>                   # 删除（移到回收站，可恢复）
```

### 回收站

```bash
memo trash                         # 查看回收站
memo restore <id>                  # 从回收站恢复
memo empty-trash                   # 清空回收站（永久删除所有回收站内容）
```

### 标签

```bash
memo tag ls                        # 列出所有标签（含颜色）
memo tag add <名称> -c "#ff9500"   # 添加标签（-c 指定颜色，默认 #007aff）
memo tag delete <id>               # 删除标签
```

### 导入导出

```bash
memo export backup.json            # 导出到 JSON 文件（未删除的备忘录 + 标签）
memo export                        # 导出到标准输出
memo import backup.json            # 从 JSON 导入（已存在的 ID 会跳过）
```

> 注意：`export` 只导出未删除的备忘录，回收站中的内容不会被导出。

## 命令别名

| 命令 | 别名 |
|------|------|
| `memo list` | `memo ls` |
| `memo search` | `memo s` |
| `memo add` | `memo a` |
| `memo edit` | `memo e` |
| `memo done` | `memo d` |
| `memo delete` | `memo rm` |
| `memo tag list` | `memo tag ls` |
| `memo tag delete` | `memo tag rm` |

## 使用原则

1. **操作前先查**：不确定 ID 时先 `memo list` 或 `memo search` 找到目标
2. **ID 前缀匹配**：不需要输入完整 UUID，前 6-8 位就够了
3. **创建要完整**：尽量从用户的话中提取标题、内容、标签、提醒时间，一次性填全
4. **时间理解**：用户说"明天下午3点"需转换为具体日期时间格式（如 "2026-05-26 15:00"）
5. **反馈确认**：操作后告诉用户结果（"已创建"、"已标记完成"等）
6. **批量操作**：如果用户一次提到多件事，可以连续执行多条命令
7. **搜索优先**：当不确定目标备忘录时，优先使用 search 而非 list，效率更高
8. **标签复用**：创建备忘时尽量使用已有标签，先 `memo tag ls` 确认
