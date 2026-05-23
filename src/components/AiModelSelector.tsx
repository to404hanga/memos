/**
 * AI 模型选择器下拉菜单
 */
import React from 'react';
import type { AiModel, AiProvider } from '../../types/global';

type ModelChoice = 'auto' | string;

interface Props {
  modelChoice: ModelChoice;
  models: AiModel[];
  providers: AiProvider[];
  onSelect: (choice: ModelChoice) => void;
  onClose: () => void;
}

export default function AiModelSelector({ modelChoice, models, providers, onSelect, onClose }: Props): React.ReactElement {
  const modelsByProvider = providers.map((p) => ({
    provider: p,
    items: models.filter((m) => m.providerId === p.id),
  })).filter((g) => g.items.length > 0);

  return (
    <>
      <div className="ai-model-menu-mask" onClick={onClose} />
      <div className="ai-model-menu">
        <div
          className={`ai-model-menu-item ${modelChoice === 'auto' ? 'selected' : ''}`}
          onClick={() => onSelect('auto')}
        >
          <span>🤖 Auto</span>
          <span className="hint">按全局优先级自动降级</span>
        </div>
        <div className="ai-model-menu-divider" />
        {modelsByProvider.length === 0 && (
          <div className="ai-model-menu-empty">暂无模型，前往 ⚙️ 设置添加</div>
        )}
        {modelsByProvider.map((g) => (
          <div key={g.provider.id}>
            <div className="ai-model-menu-group">{g.provider.name}</div>
            {g.items.map((m) => {
              const display = m.displayName || m.name;
              return (
                <div
                  key={m.id}
                  className={`ai-model-menu-item ${modelChoice === m.id ? 'selected' : ''} ${!m.enabled ? 'disabled' : ''}`}
                  onClick={() => m.enabled && onSelect(m.id)}
                >
                  <span className="ai-menu-item-main">
                    <span className="ai-menu-item-name">{display}</span>
                    {m.thinking && <span className="ai-thinking-badge">🧠</span>}
                  </span>
                  {!m.enabled && <span className="hint">已禁用</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}
