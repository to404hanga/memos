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
 */
import { BrowserWindow, screen } from 'electron';
import { PetStateMachine, PetState } from './state';

const MOVE_SPEED = 2;            // 每帧移动像素
const FRAME_INTERVAL = 30;       // 帧间隔 ms（~33fps）
const IDLE_MIN_WAIT = 30000;     // idle 最少等待时间 ms（30秒）
const IDLE_MAX_WAIT = 60000;     // idle 最多等待时间 ms（60秒）
const MOVE_MIN_DURATION = 1500;  // 单次移动最短时间 ms
const MOVE_MAX_DURATION = 4000;  // 单次移动最长时间 ms

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
        // 不能漫游时，稍后再试
        this.scheduleNextMove();
      }
    }, delay);
  }

  private startMove(): void {
    if (!this.petWindow || this.petWindow.isDestroyed()) return;

    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    const [curX, curY] = this.petWindow.getPosition();
    const [winW, winH] = this.petWindow.getSize();

    // 生成随机方向（不允许纯垂直，必须有水平分量）
    // dx 范围 [-1, 1] 且不为 0
    this.dx = Math.random() > 0.5 ? 1 : -1;
    // dy 范围 [-0.5, 0.5]，允许为 0（完全水平）
    this.dy = (Math.random() - 0.5);

    // 归一化到速度
    const len = Math.sqrt(this.dx * this.dx + this.dy * this.dy);
    this.dx = (this.dx / len) * MOVE_SPEED;
    this.dy = (this.dy / len) * MOVE_SPEED;

    // 设置移动状态
    const moveState: PetState = this.dx < 0 ? 'running_left' : 'running_right';
    this.stateMachine.transition(moveState);

    // 移动持续时间
    const duration = MOVE_MIN_DURATION + Math.random() * (MOVE_MAX_DURATION - MOVE_MIN_DURATION);
    const startTime = Date.now();

    this.moveTimer = setInterval(() => {
      if (!this.petWindow || this.petWindow.isDestroyed() || !this.active) {
        this.stopMove();
        return;
      }

      // 超时停止
      if (Date.now() - startTime > duration) {
        this.stopMove();
        return;
      }

      const [x, y] = this.petWindow.getPosition();
      let newX = x + this.dx;
      let newY = y + this.dy;

      // 边界碰撞反弹
      if (newX < 0) { newX = 0; this.dx = Math.abs(this.dx); this.switchDirection(); }
      if (newX > screenWidth - winW) { newX = screenWidth - winW; this.dx = -Math.abs(this.dx); this.switchDirection(); }
      if (newY < 0) { newY = 0; this.dy = Math.abs(this.dy); }
      if (newY > screenHeight - winH) { newY = screenHeight - winH; this.dy = -Math.abs(this.dy); }

      this.petWindow.setPosition(Math.round(newX), Math.round(newY));
    }, FRAME_INTERVAL);
  }

  private switchDirection(): void {
    // 水平方向反转时切换 running_left / running_right
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

    // 保存最终位置
    if (this.petWindow && !this.petWindow.isDestroyed()) {
      const [x, y] = this.petWindow.getPosition();
      this.stateMachine.setPosition(x, y);
    }

    // 安排下一次移动
    this.scheduleNextMove();
  }
}
