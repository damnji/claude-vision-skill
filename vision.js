#!/usr/bin/env node
/**
 * 独立识图脚本 — 支持单模型或双模型（主服务失败自动切换备用服务）。中英双语。
 * 提供商/模型/地址不再硬编码，全部由 .env 配置；首次使用先完成配置向导生成 .env。
 *
 * 用法:
 *   node vision.js <图片路径> [问题]
 *   node vision.js --url <图片链接> [问题]
 *
 * .env 配置项（见 .env.example）:
 *   VISION_DUAL_MODEL        是否启用双模型：true=主服务+备用服务（失败自动切换），false=仅主服务
 *   VISION_PRIMARY_PROVIDER  主服务提供商名称（展示用）
 *   VISION_PRIMARY_BASE_URL  主服务 API 请求地址
 *   VISION_PRIMARY_API_KEY   主服务 API Key
 *   VISION_PRIMARY_MODEL     主服务模型
 *   VISION_FALLBACK_PROVIDER 备用服务提供商名称（双模型时使用）
 *   VISION_FALLBACK_BASE_URL 备用服务 API 请求地址
 *   VISION_FALLBACK_API_KEY  备用服务 API Key
 *   VISION_FALLBACK_MODEL    备用服务模型
 *   VISION_LANG              语言：zh | en | auto（默认 auto，见 i18n.js）
 *
 * 依赖: Node.js（内置模块即可，无需 npm install）
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { L } = require("./i18n.js");

// ---- 常量 ----
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;          // 图片上限 20MB，超出提示压缩
const ANTHROPIC_MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Anthropic 原生接口单图约 5MB
const REQUEST_TIMEOUT_MS = 120 * 1000;             // 单次请求超时，避免永久挂起

// 颜色：仅 TTY 输出 ANSI（管道/重定向时关闭，避免日志带转义码）
const USE_COLOR = Boolean(process.stderr.isTTY) && !process.env.NO_COLOR;
const red = (s) => (USE_COLOR ? "\x1b[31m" + s + "\x1b[0m" : s);

// ---- 内置极简 .env 加载器（无需安装 dotenv）----
(function loadEnv() {
  // 技能自身的 .env（__dirname，由 AI 按 SKILL.md 向导生成）优先，避免被 cwd 下无关的 .env 覆盖
  const files = [path.resolve(__dirname, ".env"), path.resolve(process.cwd(), ".env")];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    try {
      const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
      for (const line of lines) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!m) continue;
        let val = m[2];
        const isDq = val.startsWith('"') && val.endsWith('"') && val.length >= 2;
        const isSq = val.startsWith("'") && val.endsWith("'") && val.length >= 2;
        if (isDq || isSq) {
          if (isDq) {
            try { val = JSON.parse(val); } catch { val = val.slice(1, -1); }
          } else {
            val = val.slice(1, -1);
          }
        } else {
          // 剥离开引号外的行内注释（# 前有空白才算注释，避免破坏值内的 #）
          val = val.replace(/\s+#.*$/, "");
        }
        if (!process.env[m[1]]) process.env[m[1]] = val;
      }
    } catch (e) { /* 忽略 .env 解析错误 */ }
  }
})();

// ---- 配置（来自 .env / 环境变量）----
function envBool(v, def) {
  if (v === undefined || v === "") return def;
  const s = String(v).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return def;
}

const CFG = {
  dualModel: envBool(process.env.VISION_DUAL_MODEL, false),
  primary: {
    provider: process.env.VISION_PRIMARY_PROVIDER || "",
    baseUrl: process.env.VISION_PRIMARY_BASE_URL || "",
    apiKey: process.env.VISION_PRIMARY_API_KEY || "",
    model: process.env.VISION_PRIMARY_MODEL || "",
    bmp: envBool(process.env.VISION_PRIMARY_BMP, false),
  },
  fallback: {
    provider: process.env.VISION_FALLBACK_PROVIDER || "",
    baseUrl: process.env.VISION_FALLBACK_BASE_URL || "",
    apiKey: process.env.VISION_FALLBACK_API_KEY || "",
    model: process.env.VISION_FALLBACK_MODEL || "",
    bmp: envBool(process.env.VISION_FALLBACK_BMP, false),
  },
};

function isPlaceholderKey(k) {
  return !k || /(你的|changeme|sk-?xxx|示例|your[-_]?key)/i.test(k);
}

function isConfigured(p) {
  return !!(p.baseUrl && p.model && p.apiKey && !isPlaceholderKey(p.apiKey));
}

function parseArgs() {
  const argv = process.argv.slice(2);
  let imageSource = "", prompt = "", isUrl = false;

  for (let i = 0; i < argv.length; i++) {
    if (!imageSource && argv[i] === "--url" && argv[i + 1]) {
      isUrl = true;
      imageSource = argv[++i];
    } else if (!imageSource && !argv[i].startsWith("--")) {
      imageSource = argv[i];
    } else if (imageSource) {
      prompt = prompt ? prompt + " " + argv[i] : argv[i];
    }
  }
  if (!prompt) prompt = L({ zh: "请详细描述这张图片的内容。", en: "Please describe the content of this image in detail." });
  return { imageSource, prompt, isUrl };
}

function resolveImageUrl(source, isUrl, maxBytes = MAX_IMAGE_BYTES) {
  if (isUrl) {
    if (!isImageUrlLike(source)) {
      throw new Error(L({
        zh: `图片链接无效：${source.slice(0, 100)}（需以 http:// 或 https:// 开头，或 data: URI）`,
        en: `Invalid image URL: ${source.slice(0, 100)} (must start with http:// or https://, or be a data: URI)`,
      }));
    }
    return source;
  }
  const resolved = path.resolve(source);
  if (!fs.existsSync(resolved)) throw new Error(L({ zh: `文件不存在: ${resolved}`, en: `File not found: ${resolved}` }));
  const ext = path.extname(resolved).toLowerCase().replace(".", "");
  const mimeMap = { jpg: "jpeg", jpeg: "jpeg", png: "png", gif: "gif", webp: "webp", bmp: "bmp" };
  const mime = mimeMap[ext];
  if (!mime) throw new Error(L({ zh: `不支持的图片格式 .${ext || "?"}（支持: jpg/jpeg/png/gif/webp/bmp）`, en: `Unsupported image format .${ext || "?"} (supported: jpg/jpeg/png/gif/webp/bmp)` }));
  const size = fs.statSync(resolved).size;
  if (size > maxBytes) {
    throw new Error(L({
      zh: `图片过大（${(size / 1048576).toFixed(1)}MB），当前服务上限 ${(maxBytes / 1048576).toFixed(0)}MB，请压缩后再试`,
      en: `Image too large (${(size / 1048576).toFixed(1)}MB); current service limit ${(maxBytes / 1048576).toFixed(0)}MB — compress and retry`,
    }));
  }
  const data = fs.readFileSync(resolved);
  return `data:image/${mime};base64,${data.toString("base64")}`;
}

function isAnthropic(baseUrl) {
  try {
    const h = new URL(baseUrl).hostname;
    return h === "anthropic.com" || h.endsWith(".anthropic.com");
  } catch { return false; }
}

// HEAD 请求查 Content-Type（用于 URL 图片的 BMP 探测；5s 超时，失败按 false 处理）
function headContentType(url, redirects = 3) {
  return new Promise((resolve) => {
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(url, { method: "HEAD" }, (res) => {
      res.on("error", () => resolve(""));
      const loc = res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && loc && redirects > 0) {
        res.resume();
        try {
          const next = new URL(loc, url);
          if (next.protocol === "http:" || next.protocol === "https:") {
            return resolve(headContentType(next, redirects - 1));
          }
        } catch { /* 非法跳转地址，按无 Content-Type 处理 */ }
        return resolve("");
      }
      resolve(String(res.headers["content-type"] || ""));
      res.resume();
    });
    req.setTimeout(5000, () => { req.destroy(); resolve(""); });
    req.on("error", () => resolve(""));
    req.end();
  });
}

// 判断图片是否为 BMP：本地看扩展名 + 魔数（只读前 2 字节，不整读文件）；
// URL 看路径扩展名，无扩展名时 HEAD 查 Content-Type
async function detectBmp(source, isUrl) {
  if (!isUrl) {
    if (/\.bmp$/i.test(source)) return true;
    try {
      const fd = fs.openSync(path.resolve(source), "r");
      try {
        const buf = Buffer.alloc(2);
        fs.readSync(fd, buf, 0, 2, 0);
        return buf.toString("ascii") === "BM";
      } finally {
        fs.closeSync(fd);
      }
    } catch { return false; }
  }
  try {
    const u = new URL(source);
    if (/\.bmp$/i.test(u.pathname)) return true;
    const ct = await headContentType(u);
    return /bmp/i.test(ct);
  } catch { return false; }
}

function isValidHttpUrl(v) {
  try {
    const u = new URL(v);
    return (u.protocol === "http:" || u.protocol === "https:") && !u.search && !u.hash;
  } catch { return false; }
}

// 图片链接校验：只要求协议正确，允许带查询参数/锚点（CDN 签名、尺寸参数等图片链接常见）
function isImageUrlLike(v) {
  if (v.startsWith("data:")) return true;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch { return false; }
}

// 实际会用到的服务里，取最小的图片上限（Anthropic 单图约 5MB，其余 20MB）
function maxImageBytesFor(providers) {
  let limit = MAX_IMAGE_BYTES;
  for (const p of providers) {
    if (p && isAnthropic(p.baseUrl)) limit = Math.min(limit, ANTHROPIC_MAX_IMAGE_BYTES);
  }
  return limit;
}

// 解析 API 错误体，提取 message/type/code（兼容 OpenAI、Anthropic、DashScope、Moonshot 等格式）
function extractError(raw) {
  const s = String(raw || "");
  try {
    const j = JSON.parse(s);
    if (!j || typeof j !== "object") return { message: s, type: "", code: "" };
    let msg = "", type = "", code = "";
    if (j.error && typeof j.error === "object") {
      msg = String(j.error.message || "");
      type = String(j.error.type || "");
      code = String(j.error.code || "");
    } else if (typeof j.error === "string") {
      // 部分中转站返回 {"error":"错误说明"}
      msg = j.error;
    }
    if (!msg) msg = String(j.message || "");
    if (!type) type = String(j.type || "");
    if (!code) code = String(j.code || "");
    return { message: msg, type, code };
  } catch {
    return { message: s, type: "", code: "" };
  }
}

// 把 API 错误翻译并总结成「原因 + 正确做法」（中英双语）
function explainApiError(statusCode, raw) {
  const { message, type, code } = extractError(raw);
  const hay = (message + " " + type + " " + code).toLowerCase();
  const has = (re) => re.test(hay);
  const src = message || String(raw || "");

  let cause = "";
  let action = "";

  if (has(/no such host|getaddrinfo|econnrefused|socket hang up|certificate|enotfound|network error|网络异常/)) {
    cause = L({ zh: "网络连接问题（地址不通 / 代理 / 证书）", en: "Network connection problem (unreachable / proxy / certificate)" });
    action = L({ zh: "检查网络与代理设置；确认 base URL 可访问、拼写正确。", en: "Check network and proxy settings; verify the base URL is reachable and spelled correctly." });
  } else if (has(/timeout|超时/)) {
    cause = L({ zh: "请求超时（服务响应过慢或不可达）", en: "Request timed out (service too slow or unreachable)" });
    action = L({ zh: "检查网络后重试；若目标服务较慢可适当调大 REQUEST_TIMEOUT_MS。", en: "Retry after checking network; if the service is slow, consider raising REQUEST_TIMEOUT_MS." });
  } else if (has(/rate.?limit|too many requests|429|请求过于频繁/)) {
    cause = L({ zh: "触发限流（请求过于频繁）", en: "Rate limited (too many requests)" });
    action = L({ zh: "稍等片刻后重试，或降低调用频率。", en: "Wait a moment and retry, or reduce call frequency." });
  } else if (has(/insufficient.{0,12}(balance|quota)|余额不足|欠费|arrearage|billing|额度|quota.{0,8}exceed|exceed.{0,8}quota/)) {
    cause = L({ zh: "账号余额不足或额度用尽", en: "Insufficient account balance or quota exhausted" });
    action = L({ zh: "前往平台控制台充值或领取免费额度，再重试。", en: "Top up or claim free quota in the platform console, then retry." });
  } else if (has(/model.{0,12}not.{0,12}found|model_not_found|does not exist|没有.{0,6}模型/)) {
    cause = L({ zh: "模型名不存在或当前 Key 无权访问该模型", en: "Model name does not exist or the key lacks access to it" });
    action = L({ zh: "核对 .env 中 VISION_PRIMARY_MODEL / VISION_FALLBACK_MODEL 的模型名；确认该模型已开通。", en: "Check VISION_PRIMARY_MODEL / VISION_FALLBACK_MODEL in .env; make sure the model is enabled." });
  } else if (has(/invalid.{0,10}(image|format)|unsupported.{0,10}(image|type|format)|invalid image|图片.*格式|格式.*(不支持|无效)/)) {
    cause = L({ zh: "图片格式不受支持", en: "Image format not supported" });
    action = L({ zh: "将图片转换为 jpg / png / webp 后再试。", en: "Convert the image to jpg / png / webp and retry." });
  } else if (has(/image.{0,8}(large|big)|file.{0,8}large|图片.{0,4}(过大|太大)|too large|exceeds.{0,8}size/)) {
    cause = L({ zh: "图片文件过大", en: "Image file too large" });
    action = L({ zh: "压缩图片或降低分辨率后再试（上限 20MB；Anthropic 约 5MB）。", en: "Compress the image or lower the resolution (limit 20MB; Anthropic ~5MB)." });
  } else if (has(/context.{0,6}(length|limit)|token.{0,8}(exceed|limit)|max_tokens|content.*too long|上下文/)) {
    cause = L({ zh: "内容过长或超出上下文限制", en: "Content too long or exceeds context limit" });
    action = L({ zh: "缩短提示词，或压缩 / 裁剪图片后再试。", en: "Shorten the prompt, or compress / crop the image and retry." });
  } else if (has(/unauthorized|authentication_error|invalid_x_api_key|invalid_api_key|invalid credentials/)) {
    cause = L({ zh: "鉴权失败（API Key 无效、过期或无权限）", en: "Authentication failed (invalid, expired, or unauthorized API key)" });
    action = L({ zh: "核对 API Key；确认账号有效且已开通该服务；必要时重新生成 Key。", en: "Verify the API key; confirm the account is valid and the service is enabled; regenerate the key if needed." });
  } else if (has(/api[ _-]?key/)) {
    cause = L({ zh: "API Key 无效或鉴权失败", en: "Invalid API key or authentication failure" });
    action = L({ zh: "检查 .env 中 VISION_PRIMARY_API_KEY / VISION_FALLBACK_API_KEY 是否正确（复制完整、无多余空格）；必要时到平台重新生成一个 Key。", en: "Check VISION_PRIMARY_API_KEY / VISION_FALLBACK_API_KEY in .env (complete copy, no stray spaces); regenerate a key on the platform if needed." });
  } else if (statusCode === 404) {
    cause = L({ zh: "请求地址（base URL）或接口路径不存在", en: "Request endpoint (base URL) or API path does not exist" });
    action = L({ zh: "检查 .env 中 VISION_PRIMARY_BASE_URL / VISION_FALLBACK_BASE_URL 是否为该提供商的官方 OpenAI 兼容地址（可让 AI 联网核实）。", en: "Check VISION_PRIMARY_BASE_URL / VISION_FALLBACK_BASE_URL in .env against the provider's official OpenAI-compatible endpoint (have AI verify online)." });
  } else if (statusCode === 401 || statusCode === 403) {
    cause = L({ zh: "鉴权失败或无访问权限", en: "Authentication failure or no access permission" });
    action = L({ zh: "检查 API Key 是否正确、是否过期，或该账号是否有权访问此服务。", en: "Check the API key is correct and not expired, and the account has access to this service." });
  } else if (statusCode === 429) {
    cause = L({ zh: "请求被限流或配额耗尽", en: "Request rate-limited or quota exhausted" });
    action = L({ zh: "稍后重试，或检查账户额度。", en: "Retry later, or check account quota." });
  } else if (statusCode >= 500) {
    cause = L({ zh: "服务端暂时出错或过载", en: "Server-side error or overload" });
    action = L({ zh: "稍后重试；若持续报错，可能是该提供商服务故障。", en: "Retry later; if it persists, the provider may be down." });
  } else {
    cause = L({ zh: "服务端返回错误（未识别具体类型）", en: "Server returned an error (unrecognized type)" });
    action = L({ zh: "根据下方原始错误排查，或让 AI 联网查询该错误码含义。", en: "Troubleshoot from the raw error below, or have AI look up the meaning of the error code." });
  }

  return { cause, action, rawMessage: src.slice(0, 250) };
}

// 拼装完整错误分析块（仅对来自 API 的错误生效；本地校验错误直接显示原文即可）
function formatErrorExplanation(err) {
  if (!err || !err.fromApi) return "";
  const exp = explainApiError(err.statusCode, err.body || err.message);
  const lines = [];
  if (exp.cause) lines.push(L({ zh: `  [报错原因] ${exp.cause}`, en: `  [Cause] ${exp.cause}` }));
  if (exp.action) lines.push(L({ zh: `  [正确做法] ${exp.action}`, en: `  [Fix] ${exp.action}` }));
  if (exp.rawMessage) lines.push(L({ zh: `  [原始信息] ${exp.rawMessage}`, en: `  [Raw] ${exp.rawMessage}` }));
  return lines.join("\n");
}

// 构造带 fromApi 标记的错误对象，供 formatErrorExplanation 识别并输出分析
function apiError(message, statusCode, body) {
  const err = new Error(message);
  err.fromApi = true;
  err.statusCode = statusCode;
  err.body = body || "";
  return err;
}

function postJson(url, headers, body) {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method: "POST",
      headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      res.on("error", (e) => reject(apiError((e && e.message) || String(e), res.statusCode, "")));
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(apiError(`API ${res.statusCode}: ${text.slice(0, 300)}`, res.statusCode, text));
        }
        resolve(text);
      });
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(apiError(L({ zh: `请求超时（${REQUEST_TIMEOUT_MS / 1000}s）`, en: `Request timed out (${REQUEST_TIMEOUT_MS / 1000}s)` }), undefined, ""));
    });
    req.on("error", (e) => {
      const m = (e && e.message) || String(e);
      reject(apiError(m, undefined, m));
    });
    req.write(body);
    req.end();
  });
}

function request(payload, baseUrl, apiKey) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const url = new URL(base + "/chat/completions");
  return postJson(url, {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  }, JSON.stringify(payload)).then((text) => {
    try {
      const parsed = JSON.parse(text);
      const content = parsed?.choices?.[0]?.message?.content;
      if (typeof content === "string" && content) return content;
      // 部分提供商/中转返回 content 为 [{type:"text",text:"..."}] 数组
      if (Array.isArray(content)) {
        const out = content.filter((b) => b && (b.type === "text" || b.type === "output_text")).map((b) => b.text).join("");
        if (out) return out;
      }
    } catch { /* 非 JSON 响应，按原文返回 */ }
    return text;
  });
}

function callVisionAnthropic(provider, imageUrl, prompt) {
  const content = [];
  if (imageUrl.startsWith("data:")) {
    const comma = imageUrl.indexOf(",");
    const mediaType = imageUrl.slice(5, comma).split(";")[0];
    content.push({
      type: "image",
      source: { type: "base64", media_type: mediaType, data: imageUrl.slice(comma + 1) },
    });
  } else {
    content.push({ type: "image", source: { type: "url", url: imageUrl } });
  }
  content.push({ type: "text", text: prompt });

  const base = String(provider.baseUrl || "").replace(/\/+$/, "");
  const url = new URL(base + "/messages");
  return postJson(url, {
    "x-api-key": provider.apiKey,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  }, JSON.stringify({
    model: provider.model,
    messages: [{ role: "user", content }],
    max_tokens: 1024,
  })).then((text) => {
    try {
      const parsed = JSON.parse(text);
      const blocks = Array.isArray(parsed?.content) ? parsed.content : [];
      const out = blocks.filter((b) => b && (b.type === "text" || b.type === "output_text")).map((b) => b.text).join("");
      if (out) return out;
    } catch { /* 非 JSON 响应，按原文返回 */ }
    return text;
  });
}

function callVision(provider, imageUrl, prompt) {
  if (!isValidHttpUrl(provider.baseUrl)) {
    throw new Error(L({
      zh: `API 地址无效：${provider.baseUrl || "(空)"}（需以 http:// 或 https:// 开头）`,
      en: `Invalid API endpoint: ${provider.baseUrl || "(empty)"} (must start with http:// or https://)`,
    }));
  }
  if (isAnthropic(provider.baseUrl)) {
    return callVisionAnthropic(provider, imageUrl, prompt);
  }
  return request({
    model: provider.model,
    messages: [{ role: "user", content: [
      { type: "image_url", image_url: { url: imageUrl } },
      { type: "text", text: prompt },
    ]}],
    stream: false,
    max_tokens: 1024,
  }, provider.baseUrl, provider.apiKey);
}

function usage() {
  console.error(L({ zh: "用法: node vision.js <图片路径> [问题]", en: "Usage: node vision.js <image path> [question]" }));
  console.error(L({ zh: "      node vision.js --url <图片链接> [问题]", en: "      node vision.js --url <image URL> [question]" }));
}

async function main() {
  const unnamed = L({ zh: "未命名", en: "unnamed" });
  const failPrefix = L({ zh: "识图失败:", en: "Recognition failed:" });
  // 首次运行检测：未配置时给出引导，不直接报错退出
  if (!isConfigured(CFG.primary)) {
    console.error(L({ zh: "未检测到有效配置。首次使用请先完成配置向导：", en: "No valid configuration found. Run the setup wizard first:" }));
    console.error(L({ zh: "按 SKILL.md 的「首次使用：配置向导」步骤，在技能目录生成 .env 后重试。", en: "Follow the setup wizard in SKILL.md to generate .env in the skill directory, then retry." }));
    usage();
    process.exitCode = 1;
    return;
  }
  const { imageSource, prompt, isUrl } = parseArgs();
  if (!imageSource) {
    usage();
    process.exitCode = 1;
    return;
  }

  // 本地文件先做存在性检查（保持原报错优先级，避免 BMP 判断盖过「文件不存在」）
  if (!isUrl) {
    const resolved = path.resolve(imageSource);
    if (!fs.existsSync(resolved)) {
      console.error(failPrefix, L({ zh: `文件不存在: ${resolved}`, en: `File not found: ${resolved}` }));
      process.exitCode = 1;
      return;
    }
  }

  // 提前判断 BMP（不整读文件），先完成模型路由再读图。
  // 仅当「主模型不支持 BMP」或「备用模型不支持 BMP（主失败可能切备用）」时检测结果才有意义，其余场景跳过省一次 HEAD。
  const needBmpDetect = !CFG.primary.bmp || (CFG.dualModel && isConfigured(CFG.fallback) && !CFG.fallback.bmp);
  const isBmp = needBmpDetect ? await detectBmp(imageSource, isUrl) : false;
  let chosen = CFG.primary;
  let bmpSwitched = false;
  if (isBmp && !CFG.primary.bmp) {
    if (CFG.dualModel && isConfigured(CFG.fallback) && CFG.fallback.bmp) {
      // 主模型不支持 BMP，备用支持 → 用备用模型识图并告知
      chosen = CFG.fallback;
      bmpSwitched = true;
      console.error(L({
        zh: `[vision] 主模型(${CFG.primary.model || "?"})不支持 BMP 图片，已切换备用模型(${CFG.fallback.model || "?"})识别。`,
        en: `[vision] Primary model (${CFG.primary.model || "?"}) doesn't support BMP; switched to fallback model (${CFG.fallback.model || "?"}).`,
      }));
    } else if (CFG.dualModel && isConfigured(CFG.fallback)) {
      // 两个模型都不支持 BMP
      console.error(red(L({ zh: "模型不支持上传BMP格式图片", en: "The models do not support uploading BMP images" })));
      process.exitCode = 1;
      return;
    } else {
      // 未启用双模型（或备用未配置），主模型不支持 BMP
      console.error(red(L({ zh: "此模型不支持上传BMP格式图片", en: "This model does not support uploading BMP images" })));
      process.exitCode = 1;
      return;
    }
  }

  let imageUrl;
  try {
    // 按实际会用到的服务取图片上限（BMP 已切换时仅备用服务，否则主服务 + 已配置的备用服务）
    const providers = bmpSwitched ? [chosen] : [CFG.primary];
    if (!bmpSwitched && CFG.dualModel && isConfigured(CFG.fallback)) providers.push(CFG.fallback);
    imageUrl = resolveImageUrl(imageSource, isUrl, maxImageBytesFor(providers));
  } catch (err) {
    console.error(failPrefix, err.message);
    process.exitCode = 1;
    return;
  }

  // 识图（BMP 场景可能已切到备用模型）
  try {
    const result = await callVision(chosen, imageUrl, prompt);
    console.log(result);
    if (bmpSwitched) console.error(L({ zh: "[vision] 已使用备用模型完成识图。", en: "[vision] Recognition done via the fallback model." }));
    return;
  } catch (err) {
    const explain = (e) => formatErrorExplanation(e);
    const causeOneLine = (e) => {
      if (!e || !e.fromApi) return "";
      return explainApiError(e.statusCode, e.body || e.message).cause || "";
    };
    // 双模型且未因 BMP 切换：主服务失败自动切换备用服务
    if (!bmpSwitched && CFG.dualModel && isConfigured(CFG.fallback)) {
      if (isBmp && !CFG.fallback.bmp) {
        // 备用模型不支持 BMP，切换必败：跳过切换并给出针对性提示
        console.error(L({ zh: `[vision] 主服务(${CFG.primary.provider || unnamed}) 失败: ${err.message}`, en: `[vision] Primary (${CFG.primary.provider || unnamed}) failed: ${err.message}` }));
        console.error(L({ zh: `[vision] 备用模型(${CFG.fallback.model || "?"})不支持 BMP 图片，无法切换。`, en: `[vision] Fallback model (${CFG.fallback.model || "?"}) doesn't support BMP; cannot switch.` }));
        console.error(failPrefix, err.message);
        const exp0 = explain(err);
        if (exp0) console.error(exp0);
        process.exitCode = 1;
        return;
      }
      console.error(L({ zh: `[vision] 主服务(${CFG.primary.provider || unnamed}) 失败: ${err.message}`, en: `[vision] Primary (${CFG.primary.provider || unnamed}) failed: ${err.message}` }));
      const pc = causeOneLine(err);
      if (pc) console.error(L({ zh: `[vision] 主服务报错原因：${pc}`, en: `[vision] Primary error cause: ${pc}` }));
      console.error(L({ zh: `[vision] 尝试备用服务(${CFG.fallback.provider || unnamed})...`, en: `[vision] Trying fallback (${CFG.fallback.provider || unnamed})...` }));
      try {
        const result = await callVision(CFG.fallback, imageUrl, prompt);
        console.log(result);
        console.error(L({ zh: `[vision] 本次由备用服务(${CFG.fallback.provider || unnamed}) 响应。`, en: `[vision] Served by fallback (${CFG.fallback.provider || unnamed}) this time.` }));
        return;
      } catch (fbErr) {
        console.error(L({ zh: `[vision] 备用服务也失败: ${fbErr.message}`, en: `[vision] Fallback also failed: ${fbErr.message}` }));
        console.error(L({ zh: "[vision] 主服务错误分析：", en: "[vision] Primary error analysis:" }));
        console.error(explain(err) || err.message);
        console.error(L({ zh: "[vision] 备用服务错误分析：", en: "[vision] Fallback error analysis:" }));
        console.error(explain(fbErr) || fbErr.message);
        process.exitCode = 1;
        return;
      }
    }
    if (CFG.dualModel && !isConfigured(CFG.fallback)) {
      console.error(L({ zh: "[vision] 已启用双模型但备用服务未配置，无法自动切换。请检查 .env 中 VISION_FALLBACK_* 配置。", en: "[vision] Dual model is enabled but the fallback isn't configured; cannot auto-switch. Check VISION_FALLBACK_* in .env." }));
    }
    console.error(failPrefix, err.message);
    const exp = explain(err);
    if (exp) console.error(exp);
    process.exitCode = 1;
    return;
  }
}

main();
