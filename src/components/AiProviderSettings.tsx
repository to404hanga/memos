import React, { useEffect, useState } from 'react';
import type { AiProvider, AiProviderInput, AiProviderType, AiModel, AiTestResult } from '../../types/global';

interface Props {
  onClose: () => void;
}

const PROVIDER_PRESETS: Record<AiProviderType, { baseUrl: string; hint: string }> = {
  openai: {
    baseUrl: 'https://api.deepseek.com/v1',
    hint: '兼容 OpenAI 接口（DeepSeek/通义/智谱/混元/Moonshot/OpenAI 等）',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    hint: 'Anthropic Claude 系列',
  },
  ollama: {
    baseUrl: 'http://127.0.0.1:11434',
    hint: '本地 Ollama，无需 API Key',
  },
};

function emptyProviderDraft(): AiProviderInput {
  return {
    name: 'DeepSeek',
    type: 'openai',
    baseUrl: PROVIDER_PRESETS.openai.baseUrl,
    apiKey: '',
  };
}

export default function AiProviderSettings({ onClose }: Props): React.ReactElement {
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [models, setModels] = useState<AiModel[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [editingProvider, setEditingProvider] = useState<AiProviderInput | null>(null);
  const [showAddModel, setShowAddModel] = useState(false);
  const [newModelName, setNewModelName] = useState('');
  const [newModelAlias, setNewModelAlias] = useState('');
  const [newModelThinking, setNewModelThinking] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, AiTestResult>>({});
  const [dragId, setDragId] = useState<string | null>(null);

  const reload = async () => {
    const [ps, ms] = await Promise.all([window.api.aiGetProviders(), window.api.aiGetModels()]);
    setProviders(ps);
    setModels(ms);
    if (!selectedProviderId && ps.length > 0) setSelectedProviderId(ps[0].id);
    if (selectedProviderId && !ps.find((p) => p.id === selectedProviderId)) {
      setSelectedProviderId(ps[0]?.id || null);
    }
  };

  useEffect(() => { reload(); }, []);

  // Provider 操作
  const handleAddProvider = () => setEditingProvider(emptyProviderDraft());
  const handleEditProvider = (p: AiProvider) => setEditingProvider({ ...p });
  const handleDeleteProvider = async (id: string) => {
    if (!confirm('确认删除该 Provider 及其下所有模型？')) return;
    await window.api.aiDeleteProvider(id);
    await reload();
  };

  const handleSaveProvider = async () => {
    if (!editingProvider) return;
    if (!editingProvider.name.trim() || !editingProvider.baseUrl.trim()) {
      alert('名称 / Base URL 不能为空');
      return;
    }
    const saved = await window.api.aiSaveProvider(editingProvider);
    setEditingProvider(null);
    await reload();
    setSelectedProviderId(saved.id);
  };

  const handleTypeChange = (type: AiProviderType) => {
    if (!editingProvider) return;
    const preset = PROVIDER_PRESETS[type];
    setEditingProvider({
      ...editingProvider,
      type,
      baseUrl: editingProvider.baseUrl || preset.baseUrl,
    });
  };

  // Model 操作
  const selectedProvider = providers.find((p) => p.id === selectedProviderId) || null;
  const providerModels = selectedProvider
    ? models.filter((m) => m.providerId === selectedProvider.id)
    : [];

  const resetAddModelForm = () => {
    setNewModelName('');
    setNewModelAlias('');
    setNewModelThinking(false);
    setEditingModelId(null);
    setShowAddModel(false);
  };

  const handleStartEditModel = (m: AiModel) => {
    setNewModelName(m.name);
    setNewModelAlias(m.displayName || '');
    setNewModelThinking(m.thinking);
    setEditingModelId(m.id);
    setShowAddModel(true);
  };

  const handleSubmitModel = async () => {
    if (!selectedProvider || !newModelName.trim()) {
      alert('模型名不能为空');
      return;
    }
    const name = newModelName.trim();
    const alias = newModelAlias.trim() || undefined;

    if (editingModelId) {
      // 编辑：允许同名（同一个），别处不能重名
      const conflict = providerModels.find((m) => m.id !== editingModelId && m.name === name);
      if (conflict) { alert('该模型名已存在'); return; }
      await window.api.aiSaveModel({
        id: editingModelId,
        providerId: selectedProvider.id,
        name,
        displayName: alias,
        enabled: true,
        thinking: newModelThinking,
      });
    } else {
      if (providerModels.find((m) => m.name === name)) {
        alert('该模型名已存在');
        return;
      }
      await window.api.aiSaveModel({
        providerId: selectedProvider.id,
        name,
        displayName: alias,
        enabled: true,
        thinking: newModelThinking,
      });
    }
    resetAddModelForm();
    await reload();
  };

  const handleToggleModel = async (m: AiModel) => {
    await window.api.aiToggleModel(m.id, !m.enabled);
    await reload();
  };

  const handleDeleteModel = async (id: string) => {
    if (!confirm('确认删除该模型？')) return;
    await window.api.aiDeleteModel(id);
    await reload();
  };

  const handleTestModel = async (m: AiModel) => {
    const provider = providers.find((p) => p.id === m.providerId);
    if (!provider) return;
    setTesting(m.id);
    const result = await window.api.aiTestModel(provider, m.name, m.thinking);
    setTestResults((prev) => ({ ...prev, [m.id]: result }));
    setTesting(null);
    await reload();
  };

  // 拖拽排序（全局，跨 Provider）
  const sortedAllModels = [...models].sort((a, b) => a.priority - b.priority);

  const handleDragStart = (id: string) => setDragId(id);
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const handleDrop = async (targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); return; }
    const fromIdx = sortedAllModels.findIndex((m) => m.id === dragId);
    const toIdx = sortedAllModels.findIndex((m) => m.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...sortedAllModels];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setDragId(null);
    await window.api.aiReorderModels(next.map((m) => m.id));
    await reload();
  };

  const formatRelative = (iso?: string) => {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    return `${Math.floor(diff / 86400000)} 天前`;
  };

  const providerOf = (m: AiModel) => providers.find((p) => p.id === m.providerId);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal ai-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ai-settings-header">
          <div className="ai-settings-title">
            <span className="ai-settings-title-icon">⚙️</span>
            <div>
              <h2>AI 配置</h2>
              <p className="ai-settings-subtitle">管理 Provider 与模型，支持自动降级与思考模式</p>
            </div>
          </div>
          <button className="ai-icon-btn" onClick={onClose} title="关闭">✕</button>
        </div>

        <div className="ai-settings-body">
          {/* 左侧：Provider 列表 */}
          <div className="ai-pane ai-pane-providers">
            <div className="ai-pane-header">
              <span>Providers（供应商）</span>
              <button className="ai-pane-add" onClick={handleAddProvider}>+ 新增</button>
            </div>
            {providers.length === 0 && (
              <div className="ai-pane-empty-mini">
                <span className="ai-empty-icon">📭</span>
                <span>暂无 Provider</span>
                <span className="hint">点击右上角「+ 新增」开始</span>
              </div>
            )}
            <div className="ai-provider-pane-list">
              {providers.map((p) => {
                const count = models.filter((m) => m.providerId === p.id).length;
                const enabledCount = models.filter((m) => m.providerId === p.id && m.enabled).length;
                return (
                  <div
                    key={p.id}
                    className={`ai-provider-pane-row ${selectedProviderId === p.id ? 'selected' : ''}`}
                    onClick={() => setSelectedProviderId(p.id)}
                  >
                    <div className="ai-provider-pane-name">
                      {p.name}
                      <span className={`ai-type-badge type-${p.type}`}>{p.type}</span>
                    </div>
                    <div className="ai-provider-pane-meta">
                      {enabledCount}/{count} 个模型启用
                    </div>
                    <div className="ai-provider-pane-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="ai-row-btn" onClick={() => handleEditProvider(p)}>编辑</button>
                      <button className="ai-row-btn danger" onClick={() => handleDeleteProvider(p.id)}>删除</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 右侧：当前选中 Provider 的模型 + 全局优先级 */}
          <div className="ai-pane ai-pane-models">
            {selectedProvider ? (
              <>
                <div className="ai-pane-header">
                  <span>「{selectedProvider.name}」的模型</span>
                  <button
                    className="ai-pane-add"
                    onClick={() => {
                      if (showAddModel) resetAddModelForm();
                      else { setEditingModelId(null); setNewModelName(''); setNewModelAlias(''); setNewModelThinking(false); setShowAddModel(true); }
                    }}
                  >
                    {showAddModel ? '✕ 取消' : '+ 添加模型'}
                  </button>
                </div>

                {showAddModel && (
                  <div className="ai-add-model-panel">
                    <div className="ai-add-form">
                      <div className="ai-add-form-row">
                        <label>模型名 <span className="required">*</span></label>
                        <input
                          type="text"
                          value={newModelName}
                          onChange={(e) => setNewModelName(e.target.value)}
                          placeholder="如 deepseek-chat、claude-3-5-sonnet-latest"
                          autoFocus
                          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitModel(); }}
                        />
                        <p className="hint">提供给 API 的实际模型标识符</p>
                      </div>
                      <div className="ai-add-form-row">
                        <label>别名（可选）</label>
                        <input
                          type="text"
                          value={newModelAlias}
                          onChange={(e) => setNewModelAlias(e.target.value)}
                          placeholder="如 DeepSeek-V3 主用、Claude 写作"
                          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitModel(); }}
                        />
                        <p className="hint">用于界面展示，会以 <code>{selectedProvider.name} / 别名</code> 的形式显示</p>
                      </div>
                      <div className="ai-add-form-row">
                        <label className="ai-checkbox-label">
                          <input
                            type="checkbox"
                            checked={newModelThinking}
                            onChange={(e) => setNewModelThinking(e.target.checked)}
                          />
                          🧠 启用思考模式（reasoning / extended thinking）
                        </label>
                        <p className="hint">仅对支持的模型生效（o1/r1/qwq/claude-sonnet-4 等）</p>
                      </div>
                      <div className="ai-add-form-actions">
                        <button className="btn-cancel" onClick={resetAddModelForm}>取消</button>
                        <button className="btn-submit" onClick={handleSubmitModel}>
                          {editingModelId ? '保存修改' : '添加模型'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {providerModels.length === 0 && !showAddModel && (
                  <div className="ai-pane-empty">该 Provider 下还没有模型，点击「+ 添加模型」</div>
                )}

                <div className="ai-model-list">
                  {providerModels.map((m) => {
                    const tr = testResults[m.id];
                    const globalRank = sortedAllModels.findIndex((x) => x.id === m.id) + 1;
                    const display = m.displayName || m.name;
                    return (
                      <div key={m.id} className="ai-model-row">
                        <input
                          type="checkbox"
                          className="ai-enable-cb"
                          checked={m.enabled}
                          onChange={() => handleToggleModel(m)}
                          title={m.enabled ? '已启用（参与 Auto 模式调度）' : '已禁用'}
                        />
                        <span className="ai-model-rank" title="全局优先级">#{globalRank}</span>
                        <div className="ai-model-info">
                          <div className="ai-model-name">
                            <span className="ai-model-display">
                              <span className="ai-model-provider-prefix">{selectedProvider.name} / </span>
                              {display}
                            </span>
                            {m.thinking && <span className="ai-thinking-badge" title="已开启思考模式">🧠</span>}
                          </div>
                          <div className="ai-model-meta">
                            {m.displayName && (
                              <span className="meta-id">实际模型名: <code>{m.name}</code></span>
                            )}
                            {m.lastUsedAt && !m.lastError && (
                              <span className="meta-ok">最近使用: {formatRelative(m.lastUsedAt)}</span>
                            )}
                            {m.lastError && (
                              <span className="meta-err" title={m.lastError}>⚠️ {m.lastError.slice(0, 60)}</span>
                            )}
                            {tr && tr.success && (
                              <span className="meta-ok">✅ {tr.latencyMs}ms</span>
                            )}
                            {tr && !tr.success && (
                              <span className="meta-err">❌ {tr.error?.slice(0, 60)}</span>
                            )}
                          </div>
                        </div>
                        <button
                          className="ai-row-btn"
                          onClick={() => handleTestModel(m)}
                          disabled={testing === m.id}
                        >{testing === m.id ? '…' : '测试'}</button>
                        <button className="ai-row-btn" onClick={() => handleStartEditModel(m)}>编辑</button>
                        <button className="ai-row-btn danger" onClick={() => handleDeleteModel(m.id)}>删除</button>
                      </div>
                    );
                  })}
                </div>

                {/* 全局优先级 */}
                {sortedAllModels.length > 1 && (
                  <div className="ai-priority-section">
                    <div className="ai-priority-header">
                      <span>🎯 全局优先级（Auto 模式按此顺序降级）</span>
                    </div>
                    <p className="hint">拖动 ☰ 跨 Provider 调整启用顺序</p>
                    <div className="ai-priority-list">
                      {sortedAllModels.map((m, idx) => {
                        const p = providerOf(m);
                        return (
                          <div
                            key={m.id}
                            className={`ai-priority-row ${dragId === m.id ? 'dragging' : ''} ${!m.enabled ? 'disabled' : ''}`}
                            draggable
                            onDragStart={() => handleDragStart(m.id)}
                            onDragOver={handleDragOver}
                            onDrop={() => handleDrop(m.id)}
                          >
                            <span className="ai-drag-handle">☰</span>
                            <span className="ai-priority-num">{idx + 1}</span>
                            <span className="ai-priority-status">
                              {m.enabled ? '✅' : '⬜'}
                            </span>
                            <span className="ai-priority-label">
                              <span className="ai-priority-provider">{p?.name || '?'}</span>
                              <span className="ai-priority-sep"> / </span>
                              <span className="ai-priority-model">{m.displayName || m.name}</span>
                              {m.thinking && <span className="ai-thinking-badge">🧠</span>}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="ai-pane-placeholder">
                <div className="ai-pane-placeholder-icon">🤖</div>
                <h4>开始配置你的 AI</h4>
                <p>从左侧选择一个 Provider 查看模型，或点击「+ 新增」创建第一个 Provider</p>
                {providers.length === 0 && (
                  <button className="btn-submit" onClick={handleAddProvider}>+ 新增 Provider</button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Provider 编辑弹窗 */}
        {editingProvider && (
          <div className="modal-overlay" onClick={() => setEditingProvider(null)}>
            <div className="modal ai-edit-modal" onClick={(e) => e.stopPropagation()}>
              <h3>{editingProvider.id ? '编辑 Provider' : '新增 Provider'}</h3>
              <div className="ai-edit-modal-body">
                <div className="form-group">
                  <label>类型</label>
                  <select
                    className="rec-select"
                    value={editingProvider.type}
                    onChange={(e) => handleTypeChange(e.target.value as AiProviderType)}
                  >
                    <option value="openai">OpenAI 兼容</option>
                    <option value="anthropic">Anthropic Claude</option>
                    <option value="ollama">Ollama（本地）</option>
                  </select>
                  <p className="hint">{PROVIDER_PRESETS[editingProvider.type].hint}</p>
                </div>
                <div className="form-group">
                  <label>名称</label>
                  <input
                    type="text"
                    value={editingProvider.name}
                    onChange={(e) => setEditingProvider({ ...editingProvider, name: e.target.value })}
                    placeholder="DeepSeek"
                  />
                </div>
                <div className="form-group">
                  <label>接口地址 (Base URL)</label>
                  <input
                    type="text"
                    value={editingProvider.baseUrl}
                    onChange={(e) => setEditingProvider({ ...editingProvider, baseUrl: e.target.value })}
                    placeholder={PROVIDER_PRESETS[editingProvider.type].baseUrl}
                  />
                </div>
                {editingProvider.type !== 'ollama' && (
                  <div className="form-group">
                    <label>API Key</label>
                    <input
                      type="password"
                      value={editingProvider.apiKey}
                      onChange={(e) => setEditingProvider({ ...editingProvider, apiKey: e.target.value })}
                      placeholder="sk-..."
                    />
                    <p className="hint">明文存储于本地数据库；导出时不会包含此字段</p>
                  </div>
                )}
              </div>

              <div className="form-actions">
                <div style={{ flex: 1 }} />
                <button className="btn-cancel" onClick={() => setEditingProvider(null)}>取消</button>
                <button className="btn-submit" onClick={handleSaveProvider}>保存</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
