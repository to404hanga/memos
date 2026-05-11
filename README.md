# 备忘录提醒 (Memo Reminder)

一个简洁美观的桌面备忘录应用，支持 Markdown 编辑、图片插入和准时提醒功能。

## 功能

- 创建、编辑、删除备忘录
- 正文支持 Markdown 格式（标题、粗体、列表、代码块、引用等）
- 支持插入本地图片，编辑时可实时预览
- 设置提醒时间，到时桌面通知 + 应用内弹窗双重提醒
- 时间轴视图，按日期分组展示近期备忘项
- 列表视图，按状态筛选（全部/待办/已完成）
- 标记完成/未完成
- 系统托盘常驻，关闭窗口不退出
- 数据本地持久化存储

## 运行

```bash
# 安装依赖
npm install

# 直接运行（加载构建产物）
npx webpack build --mode production && npx electron .

# 开发模式（热更新）
npm run dev
```

## 技术栈

- Electron（桌面框架）
- React（UI 组件）
- Marked（Markdown 解析渲染）
- electron-store（本地数据持久化）
