/**
 * 桌宠管理面板
 * 支持查看已有宠物、切换当前宠物、导入新宠物包、删除用户宠物
 */
import React, { useState, useEffect, useCallback } from 'react';

interface PetAction {
  action: string;
  label: string;
  required?: boolean;
}

interface PetInfo {
  id: string;
  name: string;
  description: string;
  author: string;
  source: 'builtin' | 'user';
}

interface Props {
  onClose: () => void;
}

export const PetManagerPanel: React.FC<Props> = ({ onClose }) => {
  const [pets, setPets] = useState<PetInfo[]>([]);
  const [currentPetId, setCurrentPetId] = useState('');
  const [actions, setActions] = useState<PetAction[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [importName, setImportName] = useState('');
  const [importMap, setImportMap] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    const [petList, petState, actionList] = await Promise.all([
      (window as any).api.petGetPets(),
      (window as any).api.petGetState(),
      (window as any).api.petGetActions(),
    ]);
    setPets(petList);
    setCurrentPetId(petState?.currentPet || '');
    setActions(actionList);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSwitch = async (petId: string) => {
    await (window as any).api.petSetCurrentPet(petId);
    setCurrentPetId(petId);
  };

  const handleDelete = async (petId: string) => {
    const result = await (window as any).api.petDelete(petId);
    if (result.success) {
      await loadData();
    } else {
      setError(result.error || '删除失败');
    }
  };

  const handleSelectGif = async (action: string) => {
    const filePath = await (window as any).api.petSelectGif();
    if (filePath) {
      setImportMap(prev => ({ ...prev, [action]: filePath }));
    }
  };

  const handleImport = async () => {
    if (!importName.trim()) {
      setError('请输入宠物名称');
      return;
    }
    if (!importMap['idle']) {
      setError('必须选择「待机」动作的 GIF');
      return;
    }
    setImporting(true);
    setError('');
    const result = await (window as any).api.petImport(importName.trim(), importMap);
    setImporting(false);
    if (result.success) {
      setShowImport(false);
      setImportName('');
      setImportMap({});
      await loadData();
    } else {
      setError(result.error || '导入失败');
    }
  };

  const getFileName = (filePath: string) => {
    return filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal pet-manager-modal" onClick={e => e.stopPropagation()}>
        <div className="pet-manager-header">
          <h2>🐾 桌宠管理</h2>
          <button className="pet-manager-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="pet-manager-error">{error}</div>}

        {!showImport ? (
          <>
            {/* 宠物列表 */}
            <div className="pet-manager-list">
              {pets.map(pet => (
                <div
                  key={pet.id}
                  className={`pet-manager-item ${pet.id === currentPetId ? 'active' : ''}`}
                  onClick={() => handleSwitch(pet.id)}
                >
                  <div className="pet-manager-item-info">
                    <span className="pet-manager-item-name">{pet.name}</span>
                    <span className="pet-manager-item-source">
                      {pet.source === 'builtin' ? '内置' : '自定义'}
                    </span>
                  </div>
                  <div className="pet-manager-item-actions">
                    {pet.id === currentPetId && <span className="pet-manager-badge">当前</span>}
                    {pet.source === 'user' && (
                      <button
                        className="pet-manager-delete-btn"
                        onClick={(e) => { e.stopPropagation(); handleDelete(pet.id); }}
                      >
                        删除
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {pets.length === 0 && (
                <div className="pet-manager-empty">暂无桌宠，请导入一个</div>
              )}
            </div>

            <button className="pet-manager-import-btn" onClick={() => setShowImport(true)}>
              + 导入新桌宠
            </button>
          </>
        ) : (
          <>
            {/* 导入面板 */}
            <div className="pet-import-panel">
              <div className="pet-import-field">
                <label>宠物名称</label>
                <input
                  type="text"
                  value={importName}
                  onChange={e => setImportName(e.target.value)}
                  placeholder="例如：QQ企鹅"
                />
              </div>

              <div className="pet-import-actions-label">为每个动作选择对应的 GIF 文件：</div>
              <div className="pet-import-actions">
                {actions.map(({ action, label, required }) => (
                  <div key={action} className="pet-import-action-row">
                    <span className="pet-import-action-label">
                      {label}
                      {required && <span className="pet-import-required">*</span>}
                    </span>
                    <button
                      className="pet-import-select-btn"
                      onClick={() => handleSelectGif(action)}
                    >
                      {importMap[action] ? getFileName(importMap[action]) : '选择文件...'}
                    </button>
                    {importMap[action] && (
                      <button
                        className="pet-import-clear-btn"
                        onClick={() => setImportMap(prev => {
                          const next = { ...prev };
                          delete next[action];
                          return next;
                        })}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="pet-import-footer">
              <button className="pet-import-cancel" onClick={() => { setShowImport(false); setImportMap({}); setImportName(''); }}>
                取消
              </button>
              <button
                className="pet-import-confirm"
                onClick={handleImport}
                disabled={importing}
              >
                {importing ? '导入中...' : '确认导入'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
