/**
 * 通用辅助工具。
 *
 * 收纳与具体业务无关的小型工具函数：UUID 生成、
 * 基于路径的不可变嵌套属性写入等。
 */

/**
 * 生成随机 UUID（v4 风格）。
 *
 * 基于 Math.random 填充模板字符串，符合 UUID v4 的版本位与变体位约定
 * （第 13 位固定为 4，第 17 位高 2 位固定为 10）。
 *
 * @returns 形如 "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx" 的 UUID 字符串
 */
export function randomUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 根据路径不可变地设置嵌套属性。
 *
 * 以浅拷贝方式沿路径逐层复制对象（不修改入参），
 * 仅在最后一层写入新值，返回全新对象，保证不可变更新语义。
 *
 * @param obj 目标对象
 * @param path 属性路径，如 'a.b.c'
 * @param value 要设置的值
 * @returns 应用变更后的新对象
 */
export function setNestedProperty<T extends Record<string, any>>(
  obj: T,
  path: string,
  value: any
): T {
  const keys = path.split(".");
  const result = { ...obj };
  let current: any = result;

  // 遍历到倒数第二层
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    } else {
      current[key] = { ...current[key] };
    }
    current = current[key];
  }

  // 设置最后一层的值
  const lastKey = keys[keys.length - 1];
  current[lastKey] = value;

  return result;
}
