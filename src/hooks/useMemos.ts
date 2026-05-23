/**
 * 备忘录数据管理 Hook
 *
 * 封装所有备忘录相关的状态管理和数据操作，包括：
 * - 数据加载：初始加载 + 60秒定时刷新 + 外部变更通知刷新
 * - 搜索：300ms 防抖的关键词搜索
 * - 筛选：按完成状态（全部/待办/已完成）和标签筛选
 * - CRUD：创建、更新、删除、切换完成/置顶状态
 * - 回收站：软删除、恢复、永久删除、清空
 * - 导入导出：ZIP 格式的数据备份与恢复
 * - 标签联动：AI 创建备忘录时自动创建不存在的标签
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { Memo, MemoFormData, Tag } from '../../types/global';

/** 列表视图的筛选类型 */
type FilterType = 'all' | 'active' | 'completed';

export function useMemos() {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [trashMemos, setTrashMemos] = useState<Memo[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadMemos = useCallback(async () => {
    if (searchQuery.trim()) {
      const data = await window.api.searchMemos(searchQuery.trim());
      setMemos(data);
    } else {
      const data = await window.api.getMemos();
      setMemos(data);
    }
  }, [searchQuery]);

  const refreshTags = () => window.api.getTags().then(setAllTags);

  useEffect(() => {
    loadMemos();
    window.api.getTags().then(setAllTags);
    const interval = setInterval(loadMemos, 60000);

    const cleanupMemosChanged = window.api.onMemosChanged(() => {
      loadMemos();
      window.api.getTags().then(setAllTags);
    });

    return () => {
      clearInterval(interval);
      cleanupMemosChanged?.();
    };
  }, [loadMemos]);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      if (value.trim()) {
        const data = await window.api.searchMemos(value.trim());
        setMemos(data);
      } else {
        const data = await window.api.getMemos();
        setMemos(data);
      }
    }, 300);
  };

  const clearSearch = () => {
    setSearchQuery('');
    window.api.getMemos().then(setMemos);
  };

  const addMemo = async (memo: MemoFormData) => {
    await window.api.addMemo(memo);
    await loadMemos();
    refreshTags();
  };

  const updateMemo = async (memo: MemoFormData) => {
    await window.api.updateMemo(memo);
    await loadMemos();
    refreshTags();
  };

  const deleteMemo = async (id: string) => {
    await window.api.deleteMemo(id);
    await loadMemos();
    refreshTags();
  };

  const toggleComplete = async (id: string) => {
    await window.api.toggleComplete(id);
    await loadMemos();
  };

  const togglePin = async (id: string) => {
    await window.api.togglePin(id);
    await loadMemos();
  };

  const loadTrash = async () => {
    const data = await window.api.getTrash();
    setTrashMemos(data);
  };

  const restoreMemo = async (id: string) => {
    await window.api.restoreMemo(id);
    await loadTrash();
    await loadMemos();
  };

  const permanentDelete = async (id: string) => {
    await window.api.permanentDelete(id);
    await loadTrash();
  };

  const emptyTrash = async () => {
    await window.api.emptyTrash();
    setTrashMemos([]);
  };

  const exportData = async () => {
    const result = await window.api.exportData();
    if (result.success) {
      alert(`导出成功！共 ${result.count} 条备忘录\n保存至: ${result.path}`);
    } else if (result.error) {
      alert(`导出失败: ${result.error}`);
    }
  };

  const importData = async () => {
    const result = await window.api.importData();
    if (result.success) {
      alert(`导入完成！新增 ${result.imported} 条，跳过 ${result.skipped} 条重复`);
      await loadMemos();
      refreshTags();
    } else if (result.error) {
      alert(`导入失败: ${result.error}`);
    }
  };

  // 自动创建不存在的标签并添加备忘录（用于 AI 创建）
  const addMemoWithTags = async (memo: MemoFormData) => {
    if (memo.tags && memo.tags.length > 0) {
      const existingNames = allTags.map((t) => t.name);
      for (const tagName of memo.tags) {
        if (!existingNames.includes(tagName)) {
          await window.api.addTag({ name: tagName });
        }
      }
    }
    await window.api.addMemo(memo);
    await loadMemos();
    refreshTags();
  };

  // 过滤
  const filteredMemos = memos.filter((m) => {
    if (filter === 'active' && m.completed) return false;
    if (filter === 'completed' && !m.completed) return false;
    if (filterTag === '__none__' && m.tags && m.tags.length > 0) return false;
    if (filterTag && filterTag !== '__none__' && (!m.tags || !m.tags.includes(filterTag))) return false;
    return true;
  });

  const tagFilteredMemos = !filterTag
    ? memos
    : filterTag === '__none__'
      ? memos.filter((m) => !m.tags || m.tags.length === 0)
      : memos.filter((m) => m.tags && m.tags.includes(filterTag));

  const tagFilteredTrash = !filterTag
    ? trashMemos
    : filterTag === '__none__'
      ? trashMemos.filter((m) => !m.tags || m.tags.length === 0)
      : trashMemos.filter((m) => m.tags && m.tags.includes(filterTag));

  const activeCount = memos.filter((m) => !m.completed).length;

  return {
    memos, filteredMemos, tagFilteredMemos, trashMemos, tagFilteredTrash,
    activeCount, filter, setFilter, filterTag, setFilterTag,
    searchQuery, handleSearchChange, clearSearch,
    allTags, refreshTags,
    addMemo, updateMemo, deleteMemo, toggleComplete, togglePin,
    addMemoWithTags,
    loadTrash, restoreMemo, permanentDelete, emptyTrash,
    exportData, importData, loadMemos,
  };
}
