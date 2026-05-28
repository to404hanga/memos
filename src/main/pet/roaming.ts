/**
 * 宠物随机移动模块
 * 
 * 宠物在 idle 状态时会随机决定是否移动。
 * 移动规则：
 * - 不允许纯垂直运动，必须有水平分量
 * - 允许完全水平运动
 * - 有向左运动分量时使用 running_left 状态
 * - 有向右运动分量时使用 running_right 状态
 * - 移动一段距离后回到 idle
 * - 桌宠只在当前所在屏幕范围内移动，不跨屏
 */
import { BrowserWindow, screen } from 'electron';
import { PetStateMachine, PetState } from './state';
import { setSetting } from '../database/settings.repo';

const MOVE_SPEED = 2;            // 每帧移动像素（固定步长）
const FRAME_INTERVAL = 30;       // 帧间隔 ms（~33fps）
const IDLE_MIN_WAIT = 15000;     // idle 最少等待时间 ms（15秒）
const IDLE_MAX_WAIT = 60000;     // idle 最多等待时间 ms（60秒）
const MOVE_MIN_DISTANCE = 100;   // 单次移动最短距离 px
const MOVE_MAX_DISTANCE = 500;   // 单次移动最长距离 px

/**
 * 获取宠物当前所在屏幕的工作区边界（绝对坐标）
 */
function getCurrentScreenBounds(petWindow: BrowserWindow): { x: number; y: number; width: number; height: number } {
  const [px, py] = petWindow.getPosition();
  const [pw, ph] = petWindow.getSize();
  // 以窗口中心点判断所在屏幕
  const centerPoint = { x: px + pw / 2, y: py + ph / 2 };
  const display = screen.getDisplayNearestPoint(centerPoint);
  return display.workArea;
}

export class PetRoaming {
  private petWindow: BrowserWindow;
  private stateMachine: PetStateMachine;
  private moveTimer: ReturnType<typeof setInterval> | null = null;
  private scheduleTimer: ReturnType<typeof setTimeout> | null = null;
  private active = false;

  // 当前移动向量
  private dx = 0;
  private dy = 0;

  constructor(petWindow: BrowserWindow, stateMachine: PetStateMachine) {
    this.petWindow = petWindow;
    this.stateMachine = stateMachine;
  }

  start(): void {
    this.active = true;
    this.scheduleNextMove();
  }

  stop(): void {
    this.active = false;
    if (this.moveTimer) {
      clearInterval(this.moveTimer);
      this.moveTimer = null;
    }
    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = null;
    }
  }

  /** 当前是否可以漫游（仅 idle 状态时） */
  private canRoam(): boolean {
    const state = this.stateMachine.getState();
    return state.currentState === 'idle' && state.visible;
  }

  private scheduleNextMove(): void {
    if (!this.active) return;

    const delay = IDLE_MIN_WAIT + Math.random() * (IDLE_MAX_WAIT - IDLE_MIN_WAIT);
    this.scheduleTimer = setTimeout(() => {
      if (this.canRoam()) {
        this.startMove();
      } else {
        this.scheduleNextMove();
      }
    }, delay);
  }

  private startMove(): void {
    if (!this.petWindow || this.petWindow.isDestroyed()) return;

    // 生成随机方向（不允许纯垂直，必须有水平分量）
    this.dx = Math.random() > 0.5 ? 1 : -1;
    this.dy = (Math.random() - 0.5);

    // 归一化到固定步长
    const len = Math.sqrt(this.dx * this.dx + this.dy * this.dy);
    this.dx = (this.dx / len) * MOVE_SPEED;
    this.dy = (this.dy / len) * MOVE_SPEED;

    // 设置移动状态
    const moveState: PetState = this.dx < 0 ? 'running_left' : 'running_right';
    this.stateMachine.transition(moveState);

    // 随机总距离，按每帧实际位移累计
    const targetDistance = MOVE_MIN_DISTANCE + Math.random() * (MOVE_MAX_DISTANCE - MOVE_MIN_DISTANCE);
    let traveled = 0;
    let frameCount = 0;

    this.moveTimer = setInterval(() => {
      if (!this.petWindow || this.petWindow.isDestroyed() || !this.active) {
        this.stopMove();
        return;
      }

      // 到达目标距离后停止
      if (traveled >= targetDistance) {
        this.stopMove();
        return;
      }

      // 获取当前所在屏幕的工作区边界
      const bounds = getCurrentScreenBounds(this.petWindow);
      const [winW, winH] = this.petWindow.getSize();
      const [x, y] = this.petWindow.getPosition();

      let newX = x + this.dx;
      let newY = y + this.dy;

      // 限制在当前屏幕范围内 + 碰撞反弹
      const minX = bounds.x;
      const maxX = bounds.x + bounds.width - winW;
      const minY = bounds.y;
      const maxY = bounds.y + bounds.height - winH;

      if (newX < minX) { newX = minX; this.dx = Math.abs(this.dx); this.switchDirection(); }
      if (newX > maxX) { newX = maxX; this.dx = -Math.abs(this.dx); this.switchDirection(); }
      if (newY < minY) { newY = minY; this.dy = Math.abs(this.dy); }
      if (newY > maxY) { newY = maxY; this.dy = -Math.abs(this.dy); }

      this.petWindow.setPosition(Math.round(newX), Math.round(newY));
      traveled += Math.sqrt(this.dx * this.dx + this.dy * this.dy);

      // 每 30 帧（~1秒）保存一次位置，防止意外退出丢失
      frameCount++;
      if (frameCount % 30 === 0) {
        setSetting('pet_position_x', String(Math.round(newX)));
        setSetting('pet_position_y', String(Math.round(newY)));
      }
    }, FRAME_INTERVAL);
  }

  private switchDirection(): void {
    const moveState: PetState = this.dx < 0 ? 'running_left' : 'running_right';
    this.stateMachine.transition(moveState);
  }

  private stopMove(): void {
    if (this.moveTimer) {
      clearInterval(this.moveTimer);
      this.moveTimer = null;
    }

    // 回到 idle
    if (this.stateMachine.getState().currentState.startsWith('running_')) {
      this.stateMachine.transition('idle');
    }

    // 保存最终位置和所在屏幕
    if (this.petWindow && !this.petWindow.isDestroyed()) {
      const [x, y] = this.petWindow.getPosition();
      this.stateMachine.setPosition(x, y);
      setSetting('pet_position_x', String(x));
      setSetting('pet_position_y', String(y));
      // 记录所在屏幕 ID
      const display = screen.getDisplayNearestPoint({ x, y });
      setSetting('pet_display_id', String(display.id));
    }

    this.scheduleNextMove();
  }
}
