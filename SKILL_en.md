---
name: vision
description: Image recognition capability — send an image (local path or URL) to a cloud vision model and get back a text description. Use this skill instead of the Read tool whenever the user shares an image path/URL, the message contains "Saved attachments:" with images, or the user asks to analyze/describe/recognize an image (the base model has no native vision capability).
---

# Vision Skill (English)

Your base model has no native vision capability. When you see an image, **do NOT use the Read tool** — run `vision.js` from this skill directory:

```
node "./vision.js" "<image path>" "Describe this image in Chinese"
```

> `vision.js` and `SKILL.md` are in the same directory. If the relative path `./vision.js` fails with "file not found", you are not in the skill directory — use the absolute path of this skill (where `SKILL.md` lives) instead.

## First-time use: Setup wizard (important)

**On first use (no `.env` yet in the skill directory, or `.env` is not configured), you MUST run the interactive setup wizard before recognizing images:**

```
node setup.js
```

Wizard (`setup.js`) features:
- The recommended option is shown before entering the provider: **Zhipu GLM-4.6-V-Flash (free)**
- Both the **dual-model choice** and the **provider entry** offer a "back" option so you can re-enter at any time
- Entering **deepseek** as the provider shows a **red warning**: `DeepSeek's multimodal ability is weak; it can only recognize text, not recommended!` — you can still use it / choose another provider / go back
- After choosing a model, it asks whether the model **supports BMP uploads** (**default: not supported**; for dual model it asks for both primary and fallback; you, the AI, should **search online** whether the selected model supports BMP and guide the user to choose "Yes" only when confirmed); if the model does not support BMP, a red warning appears: `Note: <model name> does not support uploading BMP images!`
- **First-party providers** (chatgpt/kimi/claude/deepseek/qwen/zhipu/gemini etc.): the wizard has built-in official API endpoints (claude uses the Anthropic native API, the rest use OpenAI-compatible), shown for confirmation (editable); if you need to verify, you (the AI) can **search online for the official endpoint** and tell the user to confirm/enter it in the wizard
- **Third-party relay / aggregation stations**: the user **enters the request endpoint, API Key, and model themselves**
- After confirmation, `.env` is written automatically into the same directory (contains keys — never commit it to git)

> When a valid config already exists (`.env` present and the primary's baseUrl, API Key and model are filled in, key is not a placeholder), the wizard is skipped and images are recognized directly.
> If the user can't run the wizard in a terminal, they can fill `.env` manually from `.env.example`.

## Usage

- Local image: `node "./vision.js" "image path" "question"`
- Remote image: `node "./vision.js" --url "https://..." "question"`
- The recognition result is printed to **stdout** and can be used directly as the answer; runtime logs go to stderr (can be ignored)
- Always quote the path if it contains spaces
- On API errors, the script **automatically translates the cause and suggests the correct fix** (e.g. invalid key / insufficient balance / rate limit / model not found / image too large), printed to stderr

## Trigger scenarios

- User shares an image path (local or remote URL)
- The message contains "Saved attachments:" with images listed
- User asks to analyze, describe, or recognize image content

## BMP image handling

When the image is BMP, it is handled automatically based on each model's support (`.env`'s `VISION_PRIMARY_BMP` / `VISION_FALLBACK_BMP`; **unset defaults to not supported** — set to `true` only after verifying the model supports it):

- **Single model**: primary doesn't support BMP → red message `This model does not support uploading BMP images`
- **Dual model**: primary doesn't support, fallback does → automatically use the **fallback model** and tell the user it was used
- **Dual model**: neither supports it → red message `The models do not support uploading BMP images`

## Language

The wizard and runtime messages are **bilingual (Chinese/English)**. Set the `VISION_LANG` environment variable to `zh` / `en` / `auto` (default `auto`, detected from system locale). See `i18n.js`.

## Change / reset config

- Edit `vision-skill-v3/.env` directly, or delete `.env` and re-run `node setup.js`
- Config fields are documented in `.env.example`
