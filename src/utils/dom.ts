/**
 * DOM 操作工具。
 *
 * 提供对 document 头部 <link> 标签的轻量管理，
 * 用于动态注入样式表 / 图标等外链资源。
 */

/**
 * 创建并插入一个 <link> 标签到 <head>。
 *
 * 通过 id 做幂等控制：若同 id 的 <link> 已存在则直接返回，避免重复插入。
 *
 * @param id   link 标签的唯一 id（用于去重与后续查找）
 * @param href 资源地址
 * @param rel  link 关系类型（如 stylesheet、icon 等）
 */
export function createLinkTag(id: string, href: string, rel: string) {
  let link = document.getElementById(id) as HTMLLinkElement | null;
  if (link) return;
  link = document.createElement("link");
  link.id = id;
  link.rel = rel;
  link.href = href;
  document.head.appendChild(link);
}
