#!/usr/bin/env node
'use strict';

const { Command } = require('commander');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CLI_PORT = 19527;
const API_BASE = `http://127.0.0.1:${CLI_PORT}/api`;

// ===== HTTP 请求工具 =====
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const payload = body ? JSON.stringify(body) : '';
    const options = {
      hostname: '127.0.0.1',
      port: CLI_PORT,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 3000,
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', () => {
      reject(new Error('无法连接到备忘录应用，请确保 GUI 已启动'));
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('连接超时'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// ===== 格式化输出 =====
function formatMemo(m, verbose) {
  const status = m.completed ? '✅' : m.pinned ? '📌' : '⬜';
  const tags = m.tags && m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : '';
  const reminders = m.reminders && m.reminders.length > 0 ? ` ⏰×${m.reminders.length}` : '';
  const line = `${status} ${m.id.substring(0, 8)} │ ${m.title}${tags}${reminders}`;
  if (verbose && m.content) {
    const preview = m.content.replace(/[#*`!\[\]()]/g, '').substring(0, 80);
    return `${line}\n   ${preview}`;
  }
  return line;
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('zh-CN');
}

function printMemos(memos, verbose) {
  if (memos.length === 0) {
    console.log('  (空)');
    return;
  }
  memos.forEach((m) => console.log(formatMemo(m, verbose)));
}

// ===== CLI 定义 =====
const program = new Command();
program
  .name('memo')
  .description('备忘录 CLI — 通过命令行管理备忘录')
  .version('1.0.0');

// 列出备忘录
program
  .command('list')
  .alias('ls')
  .description('列出所有备忘录')
  .option('-v, --verbose', '显示内容预览')
  .option('-a, --all', '包含已完成')
  .action(async (opts) => {
    try {
      let memos = await request('GET', '/api/memos');
      if (!opts.all) memos = memos.filter((m) => !m.completed);
      console.log(`\n📋 备忘录 (${memos.length} 项)\n`);
      printMemos(memos, opts.verbose);
      console.log();
    } catch (e) { console.error(e.message); }
  });

// 搜索
program
  .command('search <keyword>')
  .alias('s')
  .description('搜索备忘录')
  .option('-v, --verbose', '显示内容预览')
  .action(async (keyword, opts) => {
    try {
      const memos = await request('GET', `/api/search?q=${encodeURIComponent(keyword)}`);
      console.log(`\n🔍 搜索 "${keyword}" (${memos.length} 项)\n`);
      printMemos(memos, opts.verbose);
      console.log();
    } catch (e) { console.error(e.message); }
  });

// 查看详情
program
  .command('show <id>')
  .description('查看备忘录详情')
  .action(async (id) => {
    try {
      const memos = await request('GET', '/api/memos');
      const memo = memos.find((m) => m.id.startsWith(id));
      if (!memo) { console.error('未找到该备忘录'); return; }
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`标题: ${memo.title}`);
      console.log(`ID:   ${memo.id}`);
      console.log(`状态: ${memo.completed ? '已完成' : '待办'}${memo.pinned ? ' (置顶)' : ''}`);
      if (memo.tags && memo.tags.length > 0) console.log(`标签: ${memo.tags.join(', ')}`);
      if (memo.reminders && memo.reminders.length > 0) {
        console.log(`提醒: ${memo.reminders.length} 个`);
        memo.reminders.forEach((r, i) => {
          if (r.type === 'once') console.log(`  ${i + 1}. 单次 ${formatDate(r.time)}`);
          else console.log(`  ${i + 1}. ${r.type} ${String(r.hour||0).padStart(2,'0')}:${String(r.minute||0).padStart(2,'0')}`);
        });
      }
      if (memo.webhook && memo.webhook.enabled) console.log(`Webhook: ✅ ${memo.webhook.url}`);
      if (memo.attachments && memo.attachments.length > 0) console.log(`附件: ${memo.attachments.length} 个`);
      console.log(`创建: ${formatDate(memo.createdAt)}`);
      console.log(`${'─'.repeat(50)}`);
      if (memo.content) console.log(`\n${memo.content}\n`);
    } catch (e) { console.error(e.message); }
  });

// 新建
program
  .command('add <title>')
  .alias('a')
  .description('新建备忘录')
  .option('-c, --content <content>', '正文内容')
  .option('-t, --tags <tags>', '标签（逗号分隔）')
  .option('-r, --reminder <time>', '提醒时间 (如 "2026-05-15 10:00")')
  .action(async (title, opts) => {
    try {
      const data = { title, content: opts.content || '' };
      if (opts.tags) data.tags = opts.tags.split(',').map((t) => t.trim());
      if (opts.reminder) {
        data.reminders = [{ type: 'once', time: new Date(opts.reminder).toISOString() }];
      }
      const memo = await request('POST', '/api/memos', data);
      console.log(`✅ 已创建: ${memo.id.substring(0, 8)} │ ${memo.title}`);
    } catch (e) { console.error(e.message); }
  });

// 编辑
program
  .command('edit <id>')
  .alias('e')
  .description('编辑备忘录')
  .option('-T, --title <title>', '修改标题')
  .option('-c, --content <content>', '修改内容')
  .option('-t, --tags <tags>', '修改标签（逗号分隔）')
  .action(async (id, opts) => {
    try {
      const memos = await request('GET', '/api/memos');
      const memo = memos.find((m) => m.id.startsWith(id));
      if (!memo) { console.error('未找到该备忘录'); return; }
      const update = { id: memo.id };
      if (opts.title) update.title = opts.title;
      if (opts.content) update.content = opts.content;
      if (opts.tags) update.tags = opts.tags.split(',').map((t) => t.trim());
      const result = await request('PUT', '/api/memos', update);
      console.log(`✅ 已更新: ${result.id.substring(0, 8)} │ ${result.title}`);
    } catch (e) { console.error(e.message); }
  });

// 删除（软删除到回收站）
program
  .command('delete <id>')
  .alias('rm')
  .description('删除备忘录（移到回收站）')
  .action(async (id) => {
    try {
      const memos = await request('GET', '/api/memos');
      const memo = memos.find((m) => m.id.startsWith(id));
      if (!memo) { console.error('未找到该备忘录'); return; }
      await request('DELETE', '/api/memos', { id: memo.id });
      console.log(`🗑️  已删除: ${memo.title}`);
    } catch (e) { console.error(e.message); }
  });

// 标记完成/未完成
program
  .command('done <id>')
  .alias('d')
  .description('切换完成状态')
  .action(async (id) => {
    try {
      const memos = await request('GET', '/api/memos');
      const memo = memos.find((m) => m.id.startsWith(id));
      if (!memo) { console.error('未找到该备忘录'); return; }
      const result = await request('POST', '/api/memos/complete', { id: memo.id });
      console.log(`${result.completed ? '✅' : '⬜'} ${result.title}`);
    } catch (e) { console.error(e.message); }
  });

// 置顶/取消置顶
program
  .command('pin <id>')
  .description('切换置顶状态')
  .action(async (id) => {
    try {
      const memos = await request('GET', '/api/memos');
      const memo = memos.find((m) => m.id.startsWith(id));
      if (!memo) { console.error('未找到该备忘录'); return; }
      const result = await request('POST', '/api/memos/pin', { id: memo.id });
      console.log(`${result.pinned ? '📌 已置顶' : '📌 已取消置顶'}: ${result.title}`);
    } catch (e) { console.error(e.message); }
  });

// 回收站
program
  .command('trash')
  .description('查看回收站')
  .action(async () => {
    try {
      const memos = await request('GET', '/api/trash');
      console.log(`\n🗑️  回收站 (${memos.length} 项)\n`);
      memos.forEach((m) => {
        console.log(`  ${m.id.substring(0, 8)} │ ${m.title}  (删除于 ${formatDate(m.deletedAt)})`);
      });
      if (memos.length === 0) console.log('  (空)');
      console.log();
    } catch (e) { console.error(e.message); }
  });

// 恢复
program
  .command('restore <id>')
  .description('从回收站恢复备忘录')
  .action(async (id) => {
    try {
      const memos = await request('GET', '/api/trash');
      const memo = memos.find((m) => m.id.startsWith(id));
      if (!memo) { console.error('未在回收站中找到'); return; }
      await request('POST', '/api/memos/restore', { id: memo.id });
      console.log(`↩️  已恢复: ${memo.title}`);
    } catch (e) { console.error(e.message); }
  });

// 清空回收站
program
  .command('empty-trash')
  .description('清空回收站')
  .action(async () => {
    try {
      await request('DELETE', '/api/trash');
      console.log('🗑️  回收站已清空');
    } catch (e) { console.error(e.message); }
  });

// 标签管理
const tagCmd = program.command('tag').description('标签管理');

tagCmd
  .command('list')
  .alias('ls')
  .description('列出所有标签')
  .action(async () => {
    try {
      const tags = await request('GET', '/api/tags');
      console.log(`\n🏷️  标签 (${tags.length} 个)\n`);
      tags.forEach((t) => console.log(`  ${t.name} (${t.color})`));
      if (tags.length === 0) console.log('  (无)');
      console.log();
    } catch (e) { console.error(e.message); }
  });

tagCmd
  .command('add <name>')
  .option('-c, --color <color>', '颜色', '#007aff')
  .description('添加标签')
  .action(async (name, opts) => {
    try {
      const tag = await request('POST', '/api/tags', { name, color: opts.color });
      console.log(`🏷️  已添加: ${tag.name}`);
    } catch (e) { console.error(e.message); }
  });

tagCmd
  .command('delete <id>')
  .alias('rm')
  .description('删除标签')
  .action(async (id) => {
    try {
      await request('DELETE', '/api/tags', { id });
      console.log('🏷️  已删除');
    } catch (e) { console.error(e.message); }
  });

// 导出
program
  .command('export [path]')
  .description('导出备忘录数据（JSON 格式到标准输出或文件）')
  .action(async (filePath) => {
    try {
      const memos = await request('GET', '/api/memos');
      const tags = await request('GET', '/api/tags');
      const data = JSON.stringify({ memos, tags }, null, 2);
      if (filePath) {
        fs.writeFileSync(filePath, data, 'utf-8');
        console.log(`📤 已导出 ${memos.length} 条到 ${filePath}`);
      } else {
        process.stdout.write(data + '\n');
      }
    } catch (e) { console.error(e.message); }
  });

// 导入
program
  .command('import <path>')
  .description('从 JSON 文件导入备忘录')
  .action(async (filePath) => {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      const memos = data.memos || [];
      const existing = await request('GET', '/api/memos');
      const existingIds = new Set(existing.map((m) => m.id));
      let imported = 0, skipped = 0;
      for (const m of memos) {
        if (existingIds.has(m.id)) { skipped++; continue; }
        await request('POST', '/api/memos', m);
        imported++;
      }
      console.log(`📥 导入完成: 新增 ${imported}，跳过 ${skipped}`);
    } catch (e) { console.error(e.message); }
  });

program.parse();
