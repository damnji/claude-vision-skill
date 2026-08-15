---
name: vision
description: 识图能力——把图片（本地路径或 URL）发给云端视觉模型，返回文字描述。当用户分享图片路径/链接、消息出现 "Saved attachments:" 并列出图片、或要求分析/描述/识别图片内容时，调用本技能代替 Read 工具（底层模型不具备原生识图能力）。首次使用按本技能「配置向导」逐步完成配置。
---

# Vision 识图技能

你的底层模型不具备原生识图能力。遇到图片时，**不要用 Read 工具**，运行本技能目录下的 `vision.js`：

```
node "./vision.js" "<图片路径>" "用中文描述这张图片"
```

> `vision.js` 与 `SKILL.md` 位于同一目录。若相对路径 `./vision.js` 执行报"找不到文件"，说明当前工作目录不在技能目录，请改用本技能的绝对路径（即 SKILL.md 所在目录）运行。

## 首次使用：配置向导（由你交互完成，严格按顺序）

**首次使用（技能目录下还没有 `.env`，或 `.env` 未配置）时，由你（AI）按下面 1→8 的顺序与用户对话完成配置，再识图。** 这是唯一的配置方式，没有独立脚本——由你逐问、等回答、再下一步。**严格按顺序，每步问完等用户回答，不要跳步、不要合并提问。**

1. **是否启用双模型？**（主服务 + 备用服务，主服务失败自动切换）——是 / 否。
2. **主服务提供商？**（可提示推荐选项：智谱 GLM-4.6-V-Flash（免费））
   - **第一方提供商**（chatgpt / kimi / claude / deepseek / 千问 / 智谱 / Gemini 等）：你**联网搜索**该提供商的官方 OpenAI 兼容地址（base URL），展示给用户**确认后**使用；claude 走 Anthropic 原生接口（`x-api-key`），其余为 OpenAI 兼容。
   - 提供商为 **deepseek** 时：用**红色字**警告 `⚠ DeepSeek 多模态能力较弱，仅可识别文字，不建议使用！`，让用户确认是否仍使用（仍使用 / 改用其他）。
   - **第三方中转站 / 整合站**：让用户**自行输入**请求地址（base URL）。
3. **主服务 API Key？**——让用户输入（不写进脚本/仓库，只进 `.env`）。
4. **主服务模型名？**——让用户输入（如 gpt-4o-mini / kimi-k2.6 / qwen3.8-max / GLM-4.6-V-Flash）。
5. **主模型是否支持 BMP 上传？**——**默认视为不支持**；你**联网核实**该模型是否支持 BMP，**确认支持才记 `true`**；不支持则红字提示 `请注意：模型名 不支持上传 BMP 格式图片！`。
6. **若第 1 步启用了双模型**：对**备用服务**重复步骤 2–5。
7. **写入配置**：全部确认后，你**用 Write 工具**在技能目录下生成 `.env`，格式见 `.env.example`，至少包含：
   ```
   VISION_DUAL_MODEL=true|false
   VISION_PRIMARY_PROVIDER=...
   VISION_PRIMARY_BASE_URL=...
   VISION_PRIMARY_API_KEY=...
   VISION_PRIMARY_MODEL=...
   VISION_PRIMARY_BMP=true|false
   # 双模型时再加：
   VISION_FALLBACK_PROVIDER=...
   VISION_FALLBACK_BASE_URL=...
   VISION_FALLBACK_API_KEY=...
   VISION_FALLBACK_MODEL=...
   VISION_FALLBACK_BMP=true|false
   ```
   `.env` 含密钥，**不要提交到任何 git 仓库**。
8. 提示用户配置完成，可开始识图。

> 配置已存在且有效时（`.env` 存在且主服务的 baseUrl、API Key、模型均已填写、Key 非占位符），跳过向导，直接识图。

## 用法

- 本地图片：`node "./vision.js" "图片路径" "问题"`
- 网络图片：`node "./vision.js" --url "https://..." "问题"`
- 识别结果从**标准输出**返回，直接作为回答内容；服务运行信息在 stderr，可忽略
- 图片路径含空格时务必加引号
- 脚本输出为中文；若用户需要英文，由你（AI）**翻译后**转达
- API 报错时会**自动翻译报错原因并给出正确做法**（如 Key 无效 / 余额不足 / 限流 / 模型不存在 / 图片过大等），输出在 stderr

## 触发场景

- 用户分享图片路径（本地或网络 URL）
- 消息中出现 "Saved attachments:" 并列出图片
- 用户要求分析、描述、识别图片内容

## BMP 图片处理

识别时若图片为 BMP，按各模型是否支持（`.env` 的 `VISION_PRIMARY_BMP` / `VISION_FALLBACK_BMP`，**未配置默认视为不支持**）自动处理：

- **单模型**：主模型不支持 BMP → 红色提示 `此模型不支持上传BMP格式图片`
- **双模型**：主模型不支持、备用支持 → 自动改用**备用模型**识别并告知
- **双模型**：两个模型都不支持 → 红色提示 `模型不支持上传BMP格式图片`

## 改配置 / 重置

- 修改 `vision-skill-v3/.env` 即可；或删除 `.env` 后重新走上面的配置向导
- 配置项含义见 `.env.example`
