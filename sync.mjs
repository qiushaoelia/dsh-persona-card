#!/usr/bin/env node
/**
 * 把 dsh-persona-card 的源码同步到 DSH profile 的 vendor 目录。
 *
 * 用法:
 *   node sync.mjs                # 同步到默认 profile
 *   node sync.mjs web            # 同步到 web profile
 *   node sync.mjs desktop --restart   # 同步后重启 DSH
 *   node sync.mjs --list         # 列出可用 profile
 *
 * 为什么需要它:profile 里的 node_modules/dsh-persona-card 是指向
 * vendor/dsh-persona-card 的软链,而 vendor 是实体副本。改源码后必须
 * 把新文件复制过去,否则 DSH 跑的还是旧代码。
 */

import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { execSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"

const PKG_NAME = "dsh-persona-card"
const SRC = dirname(fileURLToPath(import.meta.url))
const DSH_HOME = join(homedir(), ".dsh")
const PROFILES = join(DSH_HOME, "profiles")

/** 只同步参与运行的文件,不碰 README/LICENSE/cards。 */
const INCLUDE = ["lib", "package.json", "cordis.patch.yml"]

const argv = process.argv.slice(2)
const wantRestart = argv.includes("--restart")
const wantList = argv.includes("--list")
const profileArg = argv.find((a) => !a.startsWith("--"))

/* ---------------------------------------------------------------- 输出 */

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`
}

function die(msg) {
  console.error(c.red("✗ ") + msg)
  process.exit(1)
}

/* ---------------------------------------------------------------- profile */

function listProfiles() {
  if (!existsSync(PROFILES)) die(`找不到 profile 目录: ${PROFILES}`)
  return readdirSync(PROFILES).filter((name) => {
    if (name.startsWith(".") || name.includes(".bak") || name.includes(".broken")) return false
    const p = join(PROFILES, name)
    return statSync(p).isDirectory() && existsSync(join(p, "package.json"))
  })
}

function resolveProfile(name) {
  const profiles = listProfiles()
  if (name !== undefined) {
    if (!profiles.includes(name)) {
      die(`没有名为 "${name}" 的 profile。可用: ${profiles.join(", ")}`)
    }
    return name
  }
  // 默认:优先 desktop(Electron 应用),否则取第一个
  if (profiles.includes("desktop")) return "desktop"
  if (profiles.length === 0) die("没有可用的 profile")
  return profiles[0]
}

if (wantList) {
  const profiles = listProfiles()
  console.log(c.bold("可用 profile:"))
  for (const p of profiles) {
    const installed = existsSync(join(PROFILES, p, "vendor", PKG_NAME))
    console.log(`  ${installed ? c.green("✓") : c.dim("·")} ${p}`)
  }
  process.exit(0)
}

const profile = resolveProfile(profileArg)
const profileDir = join(PROFILES, profile)
const destDir = join(profileDir, "vendor", PKG_NAME)

/* ---------------------------------------------------------------- 预检 */

if (!existsSync(join(profileDir, "package.json"))) {
  die(`profile 目录异常: ${profileDir}`)
}

const pkgJsonPath = join(profileDir, "package.json")
const profilePkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"))
const hasDep = profilePkg.dependencies?.[PKG_NAME] !== undefined
const hasBundle = Array.isArray(profilePkg.dsh?.profile?.bundles)
  && profilePkg.dsh.profile.bundles.includes(PKG_NAME)

if (!hasDep || !hasBundle) {
  console.log(c.yellow("! 这个 profile 还没登记该插件"))
  if (!hasDep) console.log(c.dim(`  dependencies 里缺少 "${PKG_NAME}"`))
  if (!hasBundle) console.log(c.dim(`  dsh.profile.bundles 里缺少 "${PKG_NAME}"`))
  console.log(c.dim(`  首次安装请手动加好,再跑 pnpm install。`))
}

/* ---------------------------------------------------------------- 同步 */

console.log(c.bold(`同步 ${PKG_NAME}`))
console.log(c.dim(`  源   ${SRC}`))
console.log(c.dim(`  目标 ${destDir}`))

// 目标已存在时先清空,避免旧文件残留(比如改过文件名)
if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true })

let copied = 0
for (const item of INCLUDE) {
  const from = join(SRC, item)
  if (!existsSync(from)) {
    console.log(c.yellow(`  ! 跳过(不存在): ${item}`))
    continue
  }
  cpSync(from, join(destDir, item), { recursive: true })
  copied += 1
  console.log(`  ${c.green("→")} ${item}`)
}

if (copied === 0) die("没有复制任何文件,检查源码目录是否完整")

console.log(c.green(`✓ 已同步 ${copied} 项到 ${profile} profile`))

/* ---------------------------------------------------------------- 重启 */

if (wantRestart) {
  console.log(c.dim("\n重启 DSH…"))
  try {
    if (process.platform === "win32") {
      const script = [
        "$p = Get-CimInstance Win32_Process -Filter \"name='DeepSeek Harness.exe'\" |",
        "  Where-Object { $_.CommandLine -like '*dsh-desktop-host*' };",
        "if ($p) { Stop-Process -Id $p.ProcessId -Force; 'killed' } else { 'not running' }"
      ].join("")
      const out = execSync(`powershell -NoProfile -Command "${script}"`, { encoding: "utf8" })
      console.log("  " + out.trim())
      console.log(c.dim("  Electron 应用会自动重启 dsh 进程。"))
    } else {
      console.log(c.yellow("  非 Windows 平台,请手动重启 dsh。"))
    }
  } catch (error) {
    console.log(c.yellow(`  重启失败: ${error.message}`))
    console.log(c.dim("  手动重启 DSH 即可。"))
  }
} else {
  console.log(c.dim("\n重启 DSH 后生效。加 --restart 可自动重启。"))
}
