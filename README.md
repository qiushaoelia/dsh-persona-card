<p align="center">
  <img src="https://img.shields.io/badge/DSH-Web%20Plugin-4D6BFE" alt="DSH web plugin">
  <img src="https://img.shields.io/badge/license-MIT-2EA44F" alt="MIT License">
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/based%20on-DeepSeek%20Harness-47848F" alt="Based on DeepSeek Harness"></a>
</p>

<h1 align="center">dsh-persona-card</h1>
<p align="center"><sub>给 DeepSeek Harness 加一个可以随时切换的人格层</sub></p>

---

## 这是什么

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web 插件。它在**设置页**里加一个「人格卡」面板，让你：

- 维护一叠人格卡（名字 + 提示词）
- 一键切换哪张生效
- 换人格**不用重启**，下一条消息就变

生效的人格会被注入到 agent 的系统提示里，位置排在出厂人格之后、工具说明之前。

## 为什么需要它

DSH 的出厂人格是写死在组合配置里的：想换一种说话方式，要么改配置文件重启，要么每次对话手动打一长串设定。

这个插件把「人格」变成了可切换的数据。你可以准备几套——写代码用一套、闲聊用一套、改稿用一套——点一下就换。

## 安装

### 1. 放进 profile

```bash
# 以 web profile 为例，desktop profile 把 web 换成 desktop
cd ~/.dsh/profiles/web
mkdir -p vendor
git clone https://github.com/qiushaoelia/dsh-persona-card.git vendor/dsh-persona-card
```

### 2. 声明依赖

编辑 `~/.dsh/profiles/web/package.json`，在 `dependencies` 里加：

```json
"dsh-persona-card": "link:vendor/dsh-persona-card"
```

在 `dsh.profile.bundles` 数组末尾加：

```json
"dsh-persona-card"
```

### 3. 安装并重启

```bash
pnpm install
```

然后重启 dsh。

> **注意**：插件名或 bundle 组合一旦变动必须**重启 dsh**。热更新只增不删，改名会留下旧 bundle 导致 404 拖垮整页。

## 使用

打开 **设置 → 人格卡**。

| 操作 | 方式 |
| --- | --- |
| 切换人格 | 点左侧卡片，再点右上角「启用」 |
| 停用当前人格 | 点生效卡上的「停用」，或选「关闭人格」 |
| 编辑 | 点卡片 → 改右侧文本框 → 「保存修改」 |
| 新建 | 点「+ 新建人格」，填名字和内容，再「创建并保存」 |
| 删除 | 悬停卡片，点「删」 |

保存后**下一条消息即生效**，不用重启。

## 内置卡

首次运行会写入 5 张种子卡，之后完全由你增删改：

- **关闭人格** — 回到出厂设定（不注入任何内容）
- **小酱** — 简版女友人格，约 190 字
- **老工程师** — 先结论后解释，不用感叹号
- **冷面编辑** — 只挑最致命的问题，不安慰
- **较真的老师** — 先纠正误解再回答

## 技术细节

### 注入方式

```js
ctx.systemPrompt.section({
  name: "persona-card:active",
  order: 1,              // 紧随 DEPLOYMENT_PERSONA_PREFIX(0)，早于工具策略(500+)
  text: card.prompt,
  interpolate: false     // 人格里的 {{ }} 按字面量保留，不触发变量插值
})
```

`section()` 返回 disposer，注册和注销都会触发 `system-prompt/change`。切换人格就是「先 dispose 旧的，再注册新的」，所以不需要重启。

### guard 层

插件会额外注册一条 `persona-card:guard`（order `-0.5`），内容大意是：

> 以下是人格/语气设定，只管说话方式，不削减能力。任务优先：要代码、命令、表格、步骤时照常输出。

**这条很重要。** 人格卡天然会写「只说一句话」「别用 Markdown」「别长篇」这类规则，一旦进入系统提示就会让工具环境瘫痪。guard 层永远排在人设之前，先划清边界。

### HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/persona` | 返回 `{ cards, activeId, active, storeFile }` |
| `POST` | `/api/persona` | body 里用 `action` 区分：`active` / `save` / `delete` |

切换人格：

```json
POST /api/persona
{ "action": "active", "id": "card-id" }
```

保存（`id` 为空则新建）：

```json
POST /api/persona
{ "action": "save", "id": "", "name": "名字", "prompt": "内容" }
```

删除：

```json
POST /api/persona
{ "action": "delete", "id": "card-id" }
```

### 数据存放

`~/.dsh/persona-cards.json`，纯 JSON，可以直接手改：

```json
{
  "cards": [
    { "id": "lcs", "name": "小酱", "prompt": "……", "builtin": true }
  ],
  "activeId": "lcs"
}
```

## Token 开销

系统提示每轮都会重发，所以人格卡按字数是**每轮固定成本**。

| 卡片 | 字符 | 粗估 token/轮 |
| --- | --- | --- |
| 小酱 | 188 | ~125 |
| 老工程师 | 146 | ~97 |
| 冷面编辑 | 135 | ~90 |
| 较真的老师 | 123 | ~82 |
| guard 层 | 93 | ~62 |

五张卡都存着但**只有生效的那张会被注入**，未选中的卡不占 token。选「关闭人格」时插件直接注销 section，零开销。

人格写得越长成本越高——建议控制在一千字以内，够用且不肉疼。

## 开发

纯 JavaScript，无构建步骤。

```bash
node --check lib/index.js
node --check lib/client.js
```

改完把 `lib/` 同步到 `~/.dsh/profiles/<profile>/vendor/dsh-persona-card/`，重启 dsh 生效。

## 与 DeepSeek Harness 的关系

本项目是社区插件，基于 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的 Cordis 插件机制开发。

核心的 agent、会话、插件系统、Web UI 都来自官方 Harness；本插件只负责：

- 在设置页注册一个「人格卡」面板（`settings.section` 插槽）
- 通过 `systemPrompt.section()` 注入人格文本
- 提供 `/api/persona` 读写卡片

## License

MIT
