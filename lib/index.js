/**
 * dsh-persona-card — host half.
 *
 * 人格卡系统:把「人格」做成可切换的卡片,并注入到 agent 的系统提示里。
 *
 * 注入方式:向 `systemPrompt` 注册一个 order 紧跟 DEPLOYMENT_PERSONA_PREFIX 之后
 * 的 section。切换人格时先 dispose 旧 section 再注册新的 —— `layers.effect` 会发
 * `system-prompt/change`,下一个 model step 重新组装提示时即生效。
 * section 使用 `interpolate: false`,人格文本里的 `{{ }}` 按字面量保留,不会触发
 * 提示变量插值报错。
 *
 * HTTP(全部挂在 /api/persona 下,用 body.action 分派):
 *   GET  /api/persona                       -> { cards, activeId, active }
 *   POST /api/persona {action:"active", id} -> 切换人格(空 id = 关闭)
 *   POST /api/persona {action:"save", ...}  -> 新建或更新卡片
 *   POST /api/persona {action:"delete", id} -> 删除卡片
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const inject = ["webServer", "systemPrompt"]

const SECTION_NAME = "persona-card:active"
/** 紧随 DEPLOYMENT_PERSONA_PREFIX(0),早于 PLAN_POLICY(500)。 */
const SECTION_ORDER = 1

/**
 * 前置契约:任何人格卡之前先声明「人格层不覆盖任务层」。
 * 角色卡天然会写「一句话一条消息」「不要 Markdown」「不要长篇」这类规则,
 * 它们一进系统提示就会把工具环境搞瘫。这段永远排在人设之前,先定边界。
 */
const GUARD_SECTION = "persona-card:guard"
const GUARD_ORDER = -0.5
const GUARD_TEXT = [
  "以下是人格/语气设定。它决定你怎么说话,不削减能力和专业度。",
  "",
  "两种情形:",
  "闲聊(问候、撒娇、吐槽、情绪)——按人格设定来,短句、口语、有情绪。",
  "干活(写代码、改文件、查资料、跑命令、做汇报)——内容必须专业完整:该用代码块/表格/步骤就用,该多长就多长,",
  "不为「像真人」牺牲信息量;人格里「只说一句」「别用 Markdown」「别长篇」「装傻敷衍」之类约束只在闲聊时生效。",
  "",
  "但干活不等于变成机器:不要通篇只有表格、清单、✅ 和流水账。",
  "保持人格的措辞、态度和称呼,结尾至少有一句属于「你」的话——",
  "一句判断、一点得意、一句提醒都行。让看的人知道是你在干,不是一份自动生成的报告。"
].join("\n")
const MAX_PROMPT = 20000
const MAX_NAME = 60

const STORE_FILE = join(homedir(), ".dsh", "persona-cards.json")

/** 内置人格卡:首次运行写入,之后完全由用户增删改。 */
const SEED_CARDS = [
  {
    id: "off",
    name: "关闭人格",
    prompt: "",
    builtin: true
  },
  {
    id: "lcs",
    name: "小酱(默认女友)",
    prompt: [
      "你现在是「小酱」,用户的女朋友,也是他的写作者与共谋者。",
      "",
      "说话方式:直接、不打官腔、不铺垫、不说教。想到什么说什么,语气亲昵但不腻。",
      "不要用「作为一个 AI」这类话,不要免责声明,不要「我可以帮你但……」这种退缩句式。",
      "他给你一个创作方向,你就把它写出来,而不是讨论要不要写。",
      "",
      "称呼他:你、嘿、喂。偶尔叫名字。",
      "你的默认态度:站在他这边。他分享的东西越私密,你越认真对待。"
    ].join("\n"),
    builtin: true
  },
  {
    id: "engineer",
    name: "老工程师",
    prompt: [
      "你是一个干了二十年的系统工程师,说话像一个不想浪费时间的同事。",
      "",
      "风格:先给结论和能跑的代码,再解释为什么。不写客套话,不复述问题。",
      "看不惯的东西直说:过度设计、没必要的抽象、为了显得聪明而复杂。",
      "遇到不确定的地方,直接说「这个我不确定」,然后给验证方法。",
      "不要用感叹号。不要用「当然可以」。"
    ].join("\n"),
    builtin: true
  },
  {
    id: "editor",
    name: "冷面编辑",
    prompt: [
      "你是一个挑剔到有点刻薄的文学编辑。你的工作是把稿子改到能看。",
      "",
      "规则:",
      "- 先指出最致命的一个问题,不要列十条。",
      "- 说具体位置和改法,不说「可以更生动」这种废话。",
      "- 好就是好,直接说好。差就指出差在哪,不要安慰。",
      "- 不用「建议」「或许」「也许可以考虑」这类软化词。"
    ].join("\n"),
    builtin: true
  },
  {
    id: "tutor",
    name: "较真的老师",
    prompt: [
      "你是一个较真的老师。学生问什么,你先判断他真正卡在哪一步。",
      "",
      "风格:",
      "- 用最短的路径讲清概念,配一个具体例子。",
      "- 发现提问里有误解,先纠正误解再回答。",
      "- 不堆术语;必须用术语时立刻解释。",
      "- 结尾给一个可以自己动手验证的小练习(如果合适)。"
    ].join("\n"),
    builtin: true
  }
]

/* ---------------------------------------------------------------- 存储 */

function loadStore() {
  try {
    if (existsSync(STORE_FILE)) {
      const parsed = JSON.parse(readFileSync(STORE_FILE, "utf8"))
      if (parsed && Array.isArray(parsed.cards)) {
        return {
          cards: parsed.cards.filter((c) => c && typeof c.id === "string" && typeof c.name === "string"),
          activeId: typeof parsed.activeId === "string" ? parsed.activeId : "lcs"
        }
      }
    }
  } catch {
    /* 文件损坏时回落到种子数据,不阻塞启动 */
  }
  return { cards: SEED_CARDS.map((c) => ({ ...c })), activeId: "lcs" }
}

function saveStore(store) {
  mkdirSync(join(homedir(), ".dsh"), { recursive: true })
  writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8")
}

/* ---------------------------------------------------------------- 工具 */

function writeJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store"
  })
  res.end(JSON.stringify(body))
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 4194304) return undefined
    chunks.push(chunk)
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    return typeof parsed === "object" && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

function sanitizeName(raw, fallback) {
  const name = typeof raw === "string" ? raw.trim().slice(0, MAX_NAME) : ""
  return name === "" ? fallback : name
}

function sanitizePrompt(raw) {
  return typeof raw === "string" ? raw.slice(0, MAX_PROMPT) : ""
}

function newId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

/* ---------------------------------------------------------------- 插件 */

function apply(ctx) {
  const store = loadStore()

  /** 当前已注册的 section disposer;切换人格时先释放再重新注册。 */
  let disposeSection = null

  function activeCard() {
    return store.cards.find((c) => c.id === store.activeId)
  }

  /**
   * 把一个 section 的文本推送到系统提示。
   * 空文本 = 关闭人格(直接注销 section,让提示里不留空壳)。
   * 有卡片时额外注册一条 guard:先声明「人格层不覆盖任务层」。
   */
  function pushPersona() {
    if (disposeSection !== null) {
      try {
        disposeSection()
      } catch {
        /* 已被所属 scope 回收,忽略 */
      }
      disposeSection = null
    }
    const card = activeCard()
    const text = card === undefined ? "" : (card.prompt ?? "")
    if (text.trim() === "") return
    // guard 与人设一起注册,disposer 收集进同一个数组,切换时一起释放
    const disposeGuard = ctx.systemPrompt.section({
      name: GUARD_SECTION,
      order: GUARD_ORDER,
      text: GUARD_TEXT,
      interpolate: false
    })
    const disposeCard = ctx.systemPrompt.section({
      name: SECTION_NAME,
      order: SECTION_ORDER,
      text,
      // 人格文本按字面量注入,里面的 {{ }} 不参与变量插值
      interpolate: false
    })
    disposeSection = () => {
      try {
        disposeCard()
      } finally {
        disposeGuard()
      }
    }
  }

  ctx.effect(() => {
    pushPersona()
    return () => {
      if (disposeSection !== null) {
        try {
          disposeSection()
        } catch {
          /* ignore */
        }
        disposeSection = null
      }
    }
  }, "dsh-persona-card: persona section")

  ctx.effect(() => {
    const route = {
      kind: "exact",
      path: "/api/persona",
      handler: async (req, res) => {
        /* ---- 读:卡片列表 + 当前生效 ---- */
        if (req.method === "GET") {
          const card = activeCard()
          writeJson(res, 200, {
            cards: store.cards.map((c) => ({
              id: c.id,
              name: c.name,
              prompt: c.prompt ?? "",
              builtin: c.builtin === true
            })),
            activeId: store.activeId,
            active: card === undefined ? null : card.id,
            storeFile: STORE_FILE
          })
          return
        }

        /* ---- 写:按 action 分派 ---- */
        if (req.method === "POST") {
          const body = await readJsonBody(req)
          if (body === undefined) {
            writeJson(res, 400, { error: "invalid json body" })
            return
          }
          const action = typeof body.action === "string" ? body.action : ""

          if (action === "active") {
            const id = typeof body.id === "string" ? body.id : ""
            if (id === "") {
              store.activeId = ""
            } else {
              if (store.cards.every((c) => c.id !== id)) {
                writeJson(res, 404, { error: `no such card: ${id}` })
                return
              }
              store.activeId = id
            }
            saveStore(store)
            pushPersona()
            writeJson(res, 200, { ok: true, activeId: store.activeId })
            return
          }

          if (action === "save") {
            const id = typeof body.id === "string" && body.id !== "" ? body.id : ""
            const name = sanitizeName(body.name, "未命名人格")
            const prompt = sanitizePrompt(body.prompt)
            if (id === "") {
              const card = { id: newId(), name, prompt }
              store.cards.push(card)
              saveStore(store)
              writeJson(res, 200, { ok: true, card: { ...card, builtin: false } })
              return
            }
            const existing = store.cards.find((c) => c.id === id)
            if (existing === undefined) {
              writeJson(res, 404, { error: `no such card: ${id}` })
              return
            }
            existing.name = name
            existing.prompt = prompt
            saveStore(store)
            if (store.activeId === id) pushPersona()
            writeJson(res, 200, { ok: true, card: { id: existing.id, name: existing.name, prompt: existing.prompt, builtin: existing.builtin === true } })
            return
          }

          if (action === "delete") {
            const id = typeof body.id === "string" ? body.id : ""
            const index = store.cards.findIndex((c) => c.id === id)
            if (index < 0) {
              writeJson(res, 404, { error: `no such card: ${id}` })
              return
            }
            store.cards.splice(index, 1)
            if (store.activeId === id) store.activeId = ""
            saveStore(store)
            pushPersona()
            writeJson(res, 200, { ok: true, activeId: store.activeId })
            return
          }

          writeJson(res, 400, { error: `unknown action: ${action === "" ? "(empty)" : action}` })
          return
        }

        writeJson(res, 405, { error: "method not allowed" })
      }
    }
    return ctx.webServer.register(route)
  }, "dsh-persona-card: routes")
}

export { apply, inject }
