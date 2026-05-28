/**
 * 宠物状态机
 * 管理桌宠的动画状态、当前宠物、位置、可见性
 */

export type PetState = 'idle' | 'reminder' | 'ai_working' | 'all_done' | 'overdue' | 'sleeping' | 'review' | 'failed';

export interface PetStateContext {
  currentState: PetState;
  currentPet: string;            // 当前选中的宠物 ID
  position: { x: number; y: number };
  visible: boolean;
  bubbleMessage?: string;
}

export class PetStateMachine {
  private state: PetStateContext;
  private listeners: ((state: PetStateContext) => void)[] = [];
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(savedState?: Partial<PetStateContext>) {
    this.state = {
      currentState: 'idle',
      currentPet: '',
      position: { x: -1, y: -1 },
      visible: true,
      ...savedState,
    };
  }

  getState(): PetStateContext {
    return { ...this.state };
  }

  transition(newState: PetState, bubble?: string): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    this.state.currentState = newState;
    this.state.bubbleMessage = bubble;
    this.notify();

    // 完成/失败状态 3 秒后自动回 idle
    if (newState === 'all_done' || newState === 'failed') {
      this.idleTimer = setTimeout(() => {
        this.state.currentState = 'idle';
        this.state.bubbleMessage = undefined;
        this.notify();
      }, 3000);
    }
  }

  setCurrentPet(petId: string): void {
    this.state.currentPet = petId;
    this.notify();
  }

  setPosition(x: number, y: number): void {
    this.state.position = { x, y };
  }

  setVisible(visible: boolean): void {
    this.state.visible = visible;
    this.notify();
  }

  onStateChange(listener: (state: PetStateContext) => void): void {
    this.listeners.push(listener);
  }

  private notify(): void {
    const snapshot = { ...this.state };
    this.listeners.forEach(fn => fn(snapshot));
  }
}
