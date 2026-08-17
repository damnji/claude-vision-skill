# Claude Vision Skill

> 让**没有识图能力的大模型**（如 DeepSeek 等纯文本模型）也能"看图"——把图片发给具备视觉能力的云端模型，用文字把识别结果带回来。

支持任意 **OpenAI 兼容接口** 与 **Anthropic 原生接口**，可配置**主 + 备双模型**自动切换，API 报错自动翻译。

---

## ✨ 特性

- 🖼️ **无视觉模型也能识图**：底层模型不用有 vision 能力，脚本代劳
- 🔁 **单模型 / 双模型**：启用双模型后，主服务失败自动切换备用服务
- 🧭 **AI 引导式配置**：由 AI 按 SKILL.md 的配置向导交互完成（严格顺序），无需手改配置
  - 询问是否双模型、提供商、API Key、模型名
  - 询问模型是否支持 BMP，并支持 AI 联网核实
- 🏢 **第一方 + 第三方都支持**：ChatGPT / Kimi / Claude / DeepSeek / 千问 / 智谱 GLM / Gemini 官方地址内置；第三方中转站自行填地址
- 🩹 **BMP 智能路由**：按各模型是否支持 BMP 自动处理
- 💬 **报错自动翻译**：API 错误转成中文"原因 + 正确做法"
- 🔒 **密钥安全**：API Key 只存 `.env`，不写进脚本、不打包入库

## 📦 环境要求

- **Node.js ≥ 18**（仅用内置模块，无需 `npm install`）

## 🚀 快速开始

### 方式一：npm 安装（推荐）

```bash
# 1. 全局安装（任何目录都能用 vision 命令）
npm install -g vision-skill

# 2. 让 AI 助手按 SKILL.md 的「配置向导」逐步配置
#    （严格顺序：是否双模型 → 提供商 → API Key → 模型 → BMP 支持）

# 3. 开始识图
vision "图片路径" "用中文描述这张图片"
```

### 方式二：仓库克隆

```bash
# 1. 下载并解压本仓库
git clone https://github.com/damnji/vision-skill.git
cd vision-skill

# 2. 让 AI 助手按 SKILL.md 的「配置向导」逐步配置
# 3. 开始识图
node vision.js "图片路径" "用中文描述这张图片"
```

配置完成后，把 `SKILL.md` 的内容合并进你的 AI 助手配置（如 Claude Code 的 `CLAUDE.md`），它就能自动识图了。

## ⚙️ 配置

### 方式一：AI 助手引导（推荐）

在 AI 助手（如 Claude Code）中，让它按 **SKILL.md 的「配置向导」** 操作。AI 会严格按顺序询问，并在对话中完成联网核实与确认：

1. **是否启用双模型？**（主服务 + 备用服务，主服务失败自动切换）
2. **主服务提供商？**（推荐可选：**智谱 GLM-4.6-V-Flash（免费）**）
   - **第一方提供商**（chatgpt / kimi / claude / 千问 / 智谱 / gemini）：AI 联网搜索官方地址，确认后使用
   - **第三方中转站 / 整合站**：由你自行输入请求地址
3. **API Key 与模型名**
4. **该模型是否支持 BMP 上传？**（**默认不支持**；AI 联网核实，确认支持才记 `true`）

AI 确认后自动写入技能目录下的 `.env`。

> 脚本输出为中文；英文用户由 AI 助手翻译转达。

### 方式二：手动编辑 `.env`

复制 `.env.example` 为 `.env` 并填写：

```bash
# .env
VISION_DUAL_MODEL=false
VISION_PRIMARY_PROVIDER=<你的提供商，如 kimi / 千问 / 智谱 / 中转站名>
VISION_PRIMARY_BASE_URL=<该提供商的 OpenAI 兼容地址>
VISION_PRIMARY_API_KEY=<你的 API Key>
VISION_PRIMARY_MODEL=<该提供商的模型名>
VISION_PRIMARY_BMP=<该模型是否支持 BMP：确认支持填 true，否则留空/填 false（默认不支持）>
```

> ⚠️ `.env` 含密钥，已由 `.gitignore` 忽略，**切勿提交到 git**。
>
> 以上值完全取决于你选的**提供商与模型**——不同服务的 API 地址、Key 格式（不一定以 `sk-` 开头）、模型名都各不相同，BMP 支持也因模型而异。建议让 AI 按 SKILL.md 向导自动生成；手动填写时以你的提供商官方文档为准，`.env.example` 内每项均有注释。

## 🧠 用法

```bash
# 本地图片
node vision.js "图片路径" "用中文描述这张图片"

# 网络图片
node vision.js --url "https://example.com/xx.png" "这是什么"
```

- 支持格式：`jpg / jpeg / png / gif / webp / bmp`
- 图片上限：`20MB`（Anthropic 原生接口约 `5MB`）
- 识别结果从**标准输出**返回，可直接作为 AI 的回答内容；运行信息在 stderr
- 路径含空格时务必加引号

## 🏢 支持的提供商

| 提供商 | 官方地址（OpenAI 兼容，claude 为 Anthropic 原生） |
|--------|--------------------------------------------------|
| OpenAI（chatgpt） | `https://api.openai.com/v1` |
| Moonshot（kimi） | `https://api.moonshot.cn/v1` |
| Anthropic（claude） | `https://api.anthropic.com/v1` |
| DeepSeek | `https://api.deepseek.com/v1` |
| 阿里云百炼（千问） | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| 智谱（GLM） | `https://open.bigmodel.cn/api/paas/v4` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` |
| 第三方中转站 | 自行填写请求地址 |

> 地址以官方文档为准，可让 AI 联网核实。

## 🩹 BMP 图片处理

识别时若图片为 BMP，按各模型是否支持（`.env` 的 `VISION_PRIMARY_BMP` / `VISION_FALLBACK_BMP`，**未配置默认视为不支持**，需联网核实确认支持后设为 `true`）自动处理：

- **单模型**：主模型不支持 BMP → 红色提示 `此模型不支持上传BMP格式图片`
- **双模型**：主模型不支持、备用支持 → 自动改用**备用模型**识别并告知
- **双模型**：两个模型都不支持 → 红色提示 `模型不支持上传BMP格式图片`

## 💬 报错自动翻译

API 返回错误时自动翻译成中文**报错原因 + 正确做法**：

```
识图失败: API 401: ...
  [报错原因] API Key 无效或鉴权失败
  [正确做法] 检查 .env 中 VISION_PRIMARY_API_KEY / VISION_FALLBACK_API_KEY 是否正确…
```

覆盖：Key 无效 / 余额不足 / 限流 / 模型不存在 / 图片格式不支持 / 图片过大 / 内容过长 / 网络 / 超时 / 服务端 5xx 等。

## 📁 文件结构

```
vision-skill/
├── vision.js        # 识图脚本（核心）
├── SKILL.md         # AI 助手使用说明（触发规则 + 配置向导）
├── README.md        # 本说明
├── .env.example     # 配置模板
└── .gitignore       # 忽略 .env
```

## 🤖 给 AI 助手使用

如果你的底层模型不具备原生识图能力，遇到图片时**不要用内置读图工具**，改为运行：

```
node "<技能目录>/vision.js" "<图片路径>" "用中文描述这张图片"
```

将 `SKILL.md` 的规则并入项目或全局配置（如 Claude Code 的 `~/.claude/CLAUDE.md`），AI 便会自动触发识图。

## 🤖 给 Agent 的自动安装说明

当用户让你（AI 助手）安装 vision 技能（或把本仓库发给你时），按以下步骤**自动安装**：

1. **获取文件**（二选一）：
   - **npm 安装**：`npm install -g vision-skill`（全局，`vision` 命令可用；或项目内 `npm install vision-skill`）。技能文件在 npm 安装目录（全局用 `npm root -g` 定位），含 `vision.js`、`SKILL.md`、`package.json`、`LICENSE`。
   - **仓库克隆**：`git clone https://github.com/damnji/vision-skill.git`，取出 `vision.js`、`SKILL.md`、`.env.example`、`.gitignore`。
2. **确定技能目录**（用于放置/指向 `SKILL.md` 与 `vision.js`，`.env` 也写在这里）：
   - **npm 全局**：`npm root -g` 下的 `vision-skill/`；**项目内**：`node_modules/vision-skill/`。
   - **全局技能位**（所有项目可用）：`~/.claude/skills/vision/`；**仅当前项目**：`.claude/skills/vision/`。
3. **写入触发规则**：把 `SKILL.md` 里的「触发场景」与调用方式并入 `~/.claude/CLAUDE.md`（全局）或项目 `CLAUDE.md`，例如：
   ```
   遇到图片时不要用内置读图工具，改为运行：
   node "技能目录/vision.js" "<图片路径>" "用中文描述这张图片"
   ```
4. **配置 `.env`**：按 `SKILL.md` 的「配置向导」**严格按顺序**询问用户：是否双模型 → 主服务提供商（第一方联网核实地址 / 第三方自填）→ API Key → 模型名 → 模型是否支持 BMP（联网核实，默认不支持）→（若双模型，备用服务重复）→ 用 Write 工具生成技能目录下的 `.env`（格式见 `.env.example`）。
5. **验证**：`node "技能目录/vision.js" "一张测试图片路径"`，确认能返回文字描述；若失败按 `[报错原因]/[正确做法]` 排查。
6. 完成，告知用户可直接发图片识图。

> 前置条件：Node.js ≥ 18；无需 `npm install`。`.env` 含密钥，勿提交 git。

## ❓ 常见问题

| 现象 | 原因与解决 |
|------|-----------|
| `未检测到有效配置` | 还没配置，让 AI 按 SKILL.md 向导配置，或手动填 `.env` |
| `模型名不存在或无权访问` | `.env` 的模型名写错或未开通，改成平台真实模型名 |
| `账号余额不足或额度用尽` | 到平台充值或领取免费额度 |
| `图片过大` | 压缩图片或降低分辨率（20MB / Anthropic 5MB） |
