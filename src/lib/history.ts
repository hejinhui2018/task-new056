/**
 * 撤销/重做：快照栈。
 * 纯 TS 类，不依赖 React，便于测试；UI 层订阅 current。
 */
export class History<T> {
  private past: T[] = [];
  private present: T;
  private future: T[] = [];

  constructor(
    initial: T,
    private readonly maxSize = 100,
    /** 相等判定：相同状态不产生历史记录（默认引用相等） */
    private readonly equals: (a: T, b: T) => boolean = (a, b) =>
      a === b,
  ) {
    this.present = initial;
  }

  get current(): T {
    return this.present;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** 提交一个新状态；与当前相同则忽略。 */
  commit(next: T): T {
    if (this.equals(this.present, next)) return this.present;
    this.past.push(this.present);
    if (this.past.length > this.maxSize) this.past.shift();
    this.present = next;
    this.future = [];
    return this.present;
  }

  undo(): T {
    if (!this.canUndo) return this.present;
    this.future.push(this.present);
    this.present = this.past.pop()!;
    return this.present;
  }

  redo(): T {
    if (!this.canRedo) return this.present;
    this.past.push(this.present);
    this.present = this.future.pop()!;
    return this.present;
  }

  /** 重置为全新基线（清空所有历史）。 */
  reset(initial: T): T {
    this.past = [];
    this.future = [];
    this.present = initial;
    return this.present;
  }
}
