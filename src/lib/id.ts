/** 生成展位 id：优先使用平台 UUID，失败时退化为进程内计数器。 */
let counter = 0;

export function nextId(prefix = 'booth'): string {
  counter += 1;
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}
