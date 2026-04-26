/**
 * lint-staged 配置（函数形式）
 *
 * 原 package.json 的静态 glob 形式无法处理一类边缘情况：
 * 当 staged 文件仅落在 .oxlintrc.json 的 ignorePatterns 里（如 `lang/**`、
 * `iconfont/**`），oxlint 返回 "No files found to lint" 以 exit code 1 退出，
 * lint-staged 将其视为失败并 revert commit。
 *
 * 这里把过滤逻辑前置：把 oxlint 忽略目录里的文件剔除后再传给 oxlint/oxfmt，
 * 过滤后为空就整段跳过。
 */

/** 与 .oxlintrc.json 的 ignorePatterns 对应的路径片段。 */
const OXLINT_IGNORED_SEGMENTS = ["/lang/", "/iconfont/", "/icons/", "/patches/"]

function filterLintable(filenames) {
  return filenames.filter((absPath) => {
    const posix = absPath.replaceAll("\\", "/")
    return !OXLINT_IGNORED_SEGMENTS.some((seg) => posix.includes(seg))
  })
}

function quote(paths) {
  return paths.map((p) => `"${p}"`).join(" ")
}

export default {
  "*.{js,ts,tsx,vue}": (filenames) => {
    const lintable = filterLintable(filenames)
    if (lintable.length === 0) return []
    const args = quote(lintable)
    return [`oxlint --fix ${args}`, `oxfmt ${args}`]
  },
}
