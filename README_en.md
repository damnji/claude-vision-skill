# Claude Vision Skill

> Let **models without image recognition capability** (such as DeepSeek and other text-only models) "see" images — send the image to a cloud vision-capable model and bring back the recognition result as text.

Supports any **OpenAI-compatible API** and the **Anthropic native API**, with configurable **primary + fallback dual models** that auto-switch, and automatic error translation.

---

## ✨ Features

- 🖼️ **Image recognition without a vision model**: your base model doesn't need vision capability; the script does the work
- 🔁 **Single / dual model**: with dual model enabled, the fallback service is used automatically when the primary fails
- 🧭 **Interactive configuration wizard** (`node setup.js`): every step can be re-selected with "back", no manual config editing
  - Choose dual model on/off, provider, API Key, and model name
  - Asks whether the model supports BMP, with optional AI-assisted online verification
- 🏢 **First-party + third-party providers**: built-in official endpoints for ChatGPT / Kimi / Claude / DeepSeek / Qwen / Zhipu GLM / Gemini; third-party relay stations enter their own endpoint
- 🩹 **Smart BMP routing**: handled automatically based on each model's BMP support
- 💬 **Automatic error translation**: API errors are turned into a Chinese "cause + correct action" hint
- 🔒 **Key security**: API keys live only in `.env`, never written into scripts or packaged into the repo
- 🌐 **Bilingual (Chinese/English)**: the setup wizard and runtime messages support both languages (`VISION_LANG=zh|en|auto`)

## 📦 Requirements

- **Node.js ≥ 18** (uses only built-in modules, no `npm install` needed)

## 🚀 Quick Start

```bash
# 1. Download and extract this repo (or the zip in Releases)

# 2. Enter the skill directory
cd vision-skill-v3

# 3. Have your AI assistant configure it via the SKILL.md setup wizard
#    (strict order: dual model → provider → API key → model → BMP support)

# 4. Start recognizing images
node vision.js "image.png" "Describe this image in Chinese"
```

After configuring, merge the contents of `SKILL.md` into your AI assistant's config (e.g. Claude Code's `CLAUDE.md`), and it will recognize images automatically.

## ⚙️ Configuration

### Option 1: AI-assisted (recommended)

In an AI assistant (e.g. Claude Code), have it follow the **SKILL.md setup wizard**. The AI asks strictly in order, verifying online and confirming within the conversation:

1. **Enable dual model?** (primary + fallback; auto-switch when the primary fails)
2. **Primary provider?** (recommended option: **Zhipu GLM-4.6-V-Flash (free)**)
   - **First-party providers** (chatgpt / kimi / claude / deepseek / qwen / zhipu / gemini): the AI searches online for the official endpoint and uses it after confirmation
   - **Third-party relay / aggregation stations**: you enter the request endpoint yourself
3. **API Key and model name**
4. **Does this model support BMP uploads?** (**default: no**; the AI verifies online and records `true` only when confirmed)

After confirmation, the AI writes `.env` in the skill directory automatically.

### Option 2: Edit `.env` manually

Copy `.env.example` to `.env` and fill it in:

```bash
# .env
VISION_DUAL_MODEL=false
VISION_LANG=auto
VISION_PRIMARY_PROVIDER=<your provider, e.g. kimi / qwen / zhipu / relay name>
VISION_PRIMARY_BASE_URL=<the provider's OpenAI-compatible endpoint>
VISION_PRIMARY_API_KEY=<your API key>
VISION_PRIMARY_MODEL=<the provider's model name>
VISION_PRIMARY_BMP=<does the model support BMP: fill true if confirmed, otherwise leave empty or false (default: not supported)>
```

> ⚠️ `.env` contains keys and is ignored by `.gitignore` — **never commit it to git**.
>
> The values above depend entirely on the **provider and model** you choose — API endpoints, key formats (not always `sk-`-prefixed), and model names differ between services, and BMP support varies by model. Prefer having AI generate it via the SKILL.md wizard; when filling manually, follow your provider's official docs. Each field in `.env.example` has a comment.

## 🧠 Usage

```bash
# Local image
node vision.js "image.png" "Describe this image in Chinese"

# Remote image
node vision.js --url "https://example.com/xx.png" "What is this?"
```

- Supported formats: `jpg / jpeg / png / gif / webp / bmp`
- Image size limit: `20MB` (Anthropic native API: ~`5MB`)
- The recognition result is printed to **stdout**, ready to be used as your AI's reply; runtime logs go to stderr
- Quote the path if it contains spaces

## 🏢 Supported Providers

| Provider | Official endpoint (OpenAI-compatible; Claude uses the Anthropic native API) |
|----------|---------------------------------------------------------------------------|
| OpenAI (chatgpt) | `https://api.openai.com/v1` |
| Moonshot (kimi) | `https://api.moonshot.cn/v1` |
| Anthropic (claude) | `https://api.anthropic.com/v1` |
| DeepSeek | `https://api.deepseek.com/v1` |
| Alibaba Cloud Bailian (Qwen) | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| Zhipu (GLM) | `https://open.bigmodel.cn/api/paas/v4` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` |
| Third-party relay | fill in the endpoint yourself |

> Endpoints follow official docs; you can have AI verify them online.

## 🩹 BMP Image Handling

When the image is BMP, it is handled automatically based on each model's support (`.env`'s `VISION_PRIMARY_BMP` / `VISION_FALLBACK_BMP`; **unset defaults to not supported** — set to `true` only after verifying the model supports it):

- **Single model**: primary doesn't support BMP → red message `此模型不支持上传BMP格式图片`
- **Dual model**: primary doesn't support, fallback does → automatically use the **fallback model** and inform the user
- **Dual model**: neither supports it → red message `模型不支持上传BMP格式图片`

## 💬 Automatic Error Translation

API errors are automatically translated into a Chinese **cause + correct action** hint:

```
识图失败: API 401: ...
  [报错原因] API Key 无效或鉴权失败
  [正确做法] 检查 .env 中 VISION_PRIMARY_API_KEY / VISION_FALLBACK_API_KEY 是否正确…
```

Covers: invalid key / insufficient balance / rate limit / model not found / unsupported image format / image too large / content too long / network / timeout / server 5xx, etc.

## 📁 File Structure

```
vision-skill-v3/
├── vision.js        # recognition script (core)
├── i18n.js          # bilingual support (language detection)
├── SKILL.md         # AI assistant usage instructions (Chinese)
├── SKILL_en.md      # AI assistant usage instructions (English)
├── README.md        # documentation (Chinese)
├── README_en.md     # documentation (English)
├── .env.example     # config template
└── .gitignore       # ignores .env
```

## 🤖 For AI Assistants

If your base model lacks native image recognition, don't use its built-in image reader when you see an image — run instead:

```
node "<skill-dir>/vision.js" "<image path>" "Describe this image in Chinese"
```

Merge the rules from `SKILL.md` into your project or global config (e.g. Claude Code's `~/.claude/CLAUDE.md`), and the AI will trigger image recognition automatically.

## ❓ FAQ

| Symptom | Cause & fix |
|---------|-------------|
| `未检测到有效配置` | Not configured yet — have AI configure via the SKILL.md wizard, or fill `.env` manually |
| `模型名不存在或无权访问` | The model name in `.env` is wrong or not enabled; use the real model name on the platform |
| `账号余额不足或额度用尽` | Top up or claim free quota on the platform |
| `图片过大` | Compress the image or lower the resolution (20MB / Anthropic 5MB) |
