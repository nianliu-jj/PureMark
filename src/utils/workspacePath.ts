/**
 * 工作区路径判定工具。
 *
 * 用于区分本地绝对路径、远程（WSL / UNC 网络）路径，
 * 并据此决定工作区是否应在启动时自动加载。
 */
import { isWindows } from "./platform";

/**
 * 判断给定路径是否为本地绝对路径。
 *
 * Windows 下匹配盘符形式（如 C:\ 或 C:/），其它平台下以 / 开头即视为绝对路径。
 *
 * @param pathValue 待判定的路径
 * @returns 是本地绝对路径返回 true
 */
export function isAbsoluteLocalPath(pathValue: string): boolean {
  if (!pathValue) return false;

  if (isWindows) {
    return /^[a-zA-Z]:[\\/]/.test(pathValue);
  }

  return pathValue.startsWith("/");
}

/**
 * 判断路径是否为远程工作区路径（仅 Windows）。
 *
 * 匹配 WSL 路径（\\wsl$\ 或 \\wsl.localhost\）以及常规 UNC 网络共享路径（\\server\），
 * 这类路径访问较慢，通常需要避免自动加载。
 *
 * @param pathValue 待判定的路径
 * @returns 是远程工作区路径返回 true
 */
export function isRemoteWorkspacePath(pathValue: string): boolean {
  if (!pathValue || !isWindows) return false;

  return /^\\\\wsl(?:\$|\.localhost)\\/i.test(pathValue) || /^\\\\(?![?.]\\)/.test(pathValue);
}

/**
 * 判断是否应在启动时自动加载该工作区。
 *
 * 路径非空且不是远程路径时才自动加载，避免远程路径拖慢冷启动。
 *
 * @param pathValue 工作区路径
 * @returns 应自动加载返回 true
 */
export function shouldAutoLoadWorkspace(pathValue: string): boolean {
  return Boolean(pathValue) && !isRemoteWorkspacePath(pathValue);
}
