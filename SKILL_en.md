---
name: vision
description: Image recognition capability — send an image (local path or URL) to a cloud vision model and get back a text description. Use this skill instead of the Read tool whenever the user shares an image path/URL, the message contains "Saved attachments:" with images, or the user asks to analyze/describe/recognize an image (the base model has no native vision capability). On first use, walk through the "Setup wizard" in this skill to configure it.
---

# Vision Skill (English)

Your base model has no native vision capability. When you see an image, **do NOT use the Read tool** — run `vision.js` from this skill directory:

```
node "./vision.js" "<image path>" "Describe this image in Chinese"
```

> `vision.js` and `SKILL.md` are in the same directory. If the relative path `./vision.js` fails with "file not found", you are not in the skill directory — use the absolute path of this skill (where `SKILL.md` lives) instead.

## First-time use: Setup wizard (done by you, strictly in order)

**On first use (no `.env` yet in the skill directory, or `.env` is not configured), you, the AI, walk through the steps below in conversation with the user, then recognize images.** This is the only way to configure it — there is no standalone script. Ask one question at a time, wait for the answer, then proceed. **Follow the order strictly — don't skip steps or merge questions.**

1. **Enable dual model?** (primary + fallback; auto-switch when the primary fails) — yes / no.
2. **Primary provider?** (you may suggest the recommended option: Zhipu GLM-4.6-V-Flash (free))
   - **First-party providers** (chatgpt / kimi / claude / deepseek / qwen / zhipu / gemini etc.): you **search online** for the provider's official OpenAI-compatible endpoint (base URL), show it to the user, and **use it after confirmation**; claude uses the Anthropic native API (`x-api-key`), the rest are OpenAI-compatible.
   - If the provider is **deepseek**: show a **red warning** `⚠ DeepSeek's multimodal ability is weak; it can only recognize text, not recommended!` and have the user confirm whether to still use it (still use / choose another).
   - **Third-party relay / aggregation stations**: have the user **enter the request endpoint (base URL) themselves**.
3. **Primary API key?** — have the user enter it (never write it into scripts or the repo — only into `.env`).
4. **Primary model name?** — have the user enter it (e.g. gpt-4o-mini / kimi-k2.6 / qwen3.8-max / GLM-4.6-V-Flash).
5. **Does the primary model support BMP uploads?** — **default: not supported**; you **verify online** whether the model supports BMP, and only record `true` when confirmed; if not supported, show a red warning `Note: <model name> does not support uploading BMP images!`.
6. **If dual model was enabled in step 1**: repeat steps 2–5 for the **fallback service**.
7. **Write the config**: once everything is confirmed, use the **Write tool** to create `.env` in the skill directory (format per `.env.example`), at least containing:
   ```
   VISION_DUAL_MODEL=true|false
   VISION_LANG=zh|en          (match the language of this conversation)
   VISION_PRIMARY_PROVIDER=...
   VISION_PRIMARY_BASE_URL=...
   VISION_PRIMARY_API_KEY=...
   VISION_PRIMARY_MODEL=...
   VISION_PRIMARY_BMP=true|false
   # for dual model, also add:
   VISION_FALLBACK_PROVIDER=...
   VISION_FALLBACK_BASE_URL=...
   VISION_FALLBACK_API_KEY=...
   VISION_FALLBACK_MODEL=...
   VISION_FALLBACK_BMP=true|false
   ```
   `.env` contains keys — **never commit it to any git repository**.
8. Tell the user configuration is done and they can start recognizing images.

> When a valid config already exists (`.env` present and the primary's baseUrl, API Key and model are filled in, key is not a placeholder), skip the wizard and recognize images directly.

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

When the image is BMP, it is handled automatically based on each model's support (`.env`'s `VISION_PRIMARY_BMP` / `VISION_FALLBACK_BMP`; **unset defaults to not supported**):

- **Single model**: primary doesn't support BMP → red message `This model does not support uploading BMP images`
- **Dual model**: primary doesn't support, fallback does → automatically use the **fallback model** and tell the user it was used
- **Dual model**: neither supports it → red message `The models do not support uploading BMP images`

## Change / reset config

- Edit `vision-skill-v3/.env` directly, or delete `.env` and re-run the setup wizard above
- Config fields are documented in `.env.example`
