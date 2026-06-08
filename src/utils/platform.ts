/**
 * 平台判定常量。
 *
 * 基于 shared 层的平台探测结果，导出一组布尔常量供渲染层使用，
 * 避免各处重复调用 getPlatform 与枚举比较。
 */
import { getPlatform, PlatformType } from "@/shared/utils/platform";

/** 当前是否为 macOS 平台 */
export const isMac = getPlatform() === PlatformType.MacOS;
/** 当前是否为 Windows 平台 */
export const isWindows = getPlatform() === PlatformType.Windows;
/** 当前是否为 Linux 平台 */
export const isLinux = getPlatform() === PlatformType.Linux;
/** 平台无法识别时为 true */
export const isUnknown = getPlatform() === PlatformType.Unknown;
