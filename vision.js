#!/usr/bin/env node
/**
 * 独立识图脚本 — 支持单模型或双模型（主服务失败自动切换备用服务）。
 * 提供商/模型/地址不再硬编码，全部由 .env 配置；首次使用由 AI 按 SKILL.md 的配置向导生成 .env。
 * 输出为中文；若用户需要英文，由调用方（AI 助手）自行翻译。
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
 *
 * 依赖: Node.js（内置模块即可，无需 npm install）
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

// ---- 常量 ----
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;          // 图片上限 20MB，超出提示压缩
const ANTHROPIC_MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Anthropic 原生接口单图约 5MB
const REQUEST_TIMEOUT_MS = 120 * 1000;             // 单次请求超时，避免永久挂起

// 颜色：仅 TTY 输出 ANSI（管道/重定向时关闭，避免日志带转义码）
const USE_COLOR = Boolean(process.stderr.isTTY) && !process.env.NO_COLOR;
const red = (s) => (USE_COLOR ? "\x1b[31m" + s + "\x1b[0m" : s);

// ---- 内置极简 .env 加载器（无需安装 dotenv）----
(function loadEnv() {
  // 技能自身的 .env（__dirname，由 AI 按 SKILL.md 向导生成）优先；
  // 仅当其不存在时才回退到 cwd 的 .env，避免无关项目 .env 的键泄漏进配置
  const skillEnv = path.resolve(__dirname, ".env");
  const files = fs.existsSync(skillEnv) ? [skillEnv] : [path.resolve(process.cwd(), ".env")];
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
  if (!prompt) prompt = "请详细描述这张图片的内容。";
  return { imageSource, prompt, isUrl };
}

function resolveImageUrl(source, isUrl, maxBytes = MAX_IMAGE_BYTES) {
  if (isUrl) {
    if (!isImageUrlLike(source)) {
      throw new Error(`图片链接无效：${source.slice(0, 100)}（需以 http:// 或 https:// 开头，或 data: URI）`);
    }
    return source;
  }
  const resolved = path.resolve(source);
  if (!fs.existsSync(resolved)) throw new Error(`文件不存在: ${resolved}`);
  const ext = path.extname(resolved).toLowerCase().replace(".", "");
  const mimeMap = { jpg: "jpeg", jpeg: "jpeg", png: "png", gif: "gif", webp: "webp", bmp: "bmp" };
  const mime = mimeMap[ext];
  if (!mime) throw new Error(`不支持的图片格式 .${ext || "?"}（支持: jpg/jpeg/png/gif/webp/bmp）`);
  const size = fs.statSync(resolved).size;
  if (size > maxBytes) {
    throw new Error(`图片过大（${(size / 1048576).toFixed(1)}MB），当前服务上限 ${(maxBytes / 1048576).toFixed(0)}MB，请压缩后再试`);
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
  if (v.startsWith("data:")) {
    // 仅接受形如 data:image/<type>[;参数...],<数据> 的合法图片 data URI，拒绝 data:garbage 之类
    return /^data:image\/[a-z0-9.+-]+(?:;[a-z0-9.+-]+)*,\S+/i.test(v);
  }
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

// 把 API 错误翻译并总结成「原因 + 正确做法」
function explainApiError(statusCode, raw) {
  const { message, type, code } = extractError(raw);
  const hay = (message + " " + type + " " + code).toLowerCase();
  const has = (re) => re.test(hay);
  const src = message || String(raw || "");

  let cause = "";
  let action = "";

  if (has(/no such host|getaddrinfo|econnrefused|socket hang up|certificate|enotfound|network error|网络异常/)) {
    cause = "网络连接问题（地址不通 / 代理 / 证书）";
    action = "检查网络与代理设置；确认 base URL 可访问、拼写正确。";
  } else if (has(/timeout|超时/)) {
    cause = "请求超时（服务响应过慢或不可达）";
    action = "检查网络后重试；若目标服务较慢可适当调大 REQUEST_TIMEOUT_MS。";
  } else if (has(/rate.?limit|too many requests|429|请求过于频繁/)) {
    cause = "触发限流（请求过于频繁）";
    action = "稍等片刻后重试，或降低调用频率。";
  } else if (has(/insufficient.{0,12}(balance|quota)|余额不足|欠费|arrearage|billing|额度|quota.{0,8}exceed|exceed.{0,8}quota/)) {
    cause = "账号余额不足或额度用尽";
    action = "前往平台控制台充值或领取免费额度，再重试。";
  } else if (has(/model.{0,12}not.{0,12}found|model_not_found|does not exist|没有.{0,6}模型/)) {
    cause = "模型名不存在或当前 Key 无权访问该模型";
    action = "核对 .env 中 VISION_PRIMARY_MODEL / VISION_FALLBACK_MODEL 的模型名；确认该模型已开通。";
  } else if (has(/invalid.{0,10}(image|format)|unsupported.{0,10}(image|type|format)|invalid image|图片.*格式|格式.*(不支持|无效)/)) {
    cause = "图片格式不受支持";
    action = "将图片转换为 jpg / png / webp 后再试。";
  } else if (has(/image.{0,8}(large|big)|file.{0,8}large|图片.{0,4}(过大|太大)|too large|exceeds.{0,8}size/)) {
    cause = "图片文件过大";
    action = "压缩图片或降低分辨率后再试（上限 20MB；Anthropic 约 5MB）。";
  } else if (has(/context.{0,6}(length|limit)|token.{0,8}(exceed|limit)|max_tokens|content.*too long|上下文/)) {
    cause = "内容过长或超出上下文限制";
    action = "缩短提示词，或压缩 / 裁剪图片后再试。";
  } else if (has(/unauthorized|authentication_error|invalid_x_api_key|invalid_api_key|invalid credentials/)) {
    cause = "鉴权失败（API Key 无效、过期或无权限）";
    action = "核对 API Key；确认账号有效且已开通该服务；必要时重新生成 Key。";
  } else if (statusCode === 404) {
    cause = "请求地址（base URL）或接口路径不存在";
    action = "检查 .env 中 VISION_PRIMARY_BASE_URL / VISION_FALLBACK_BASE_URL 是否为该提供商的官方 OpenAI 兼容地址（可让 AI 联网核实）。";
  } else if (statusCode === 401 || statusCode === 403) {
    cause = "鉴权失败或无访问权限";
    action = "检查 API Key 是否正确、是否过期，或该账号是否有权访问此服务。";
  } else if (statusCode === 429) {
    cause = "请求被限流或配额耗尽";
    action = "稍后重试，或检查账户额度。";
  } else if (statusCode >= 500) {
    cause = "服务端暂时出错或过载";
    action = "稍后重试；若持续报错，可能是该提供商服务故障。";
  } else if (has(/api[ _-]?key/)) {
    cause = "API Key 无效或鉴权失败";
    action = "检查 .env 中 VISION_PRIMARY_API_KEY / VISION_FALLBACK_API_KEY 是否正确（复制完整、无多余空格）；必要时到平台重新生成一个 Key。";
  } else {
    cause = "服务端返回错误（未识别具体类型）";
    action = "根据下方原始错误排查，或让 AI 联网查询该错误码含义。";
  }

  return { cause, action, rawMessage: src.slice(0, 250) };
}

// 拼装完整错误分析块（仅对来自 API 的错误生效；本地校验错误直接显示原文即可）
function formatErrorExplanation(err) {
  if (!err || !err.fromApi) return "";
  const exp = explainApiError(err.statusCode, err.body || err.message);
  const lines = [];
  if (exp.cause) lines.push(`  [报错原因] ${exp.cause}`);
  if (exp.action) lines.push(`  [正确做法] ${exp.action}`);
  if (exp.rawMessage) lines.push(`  [原始信息] ${exp.rawMessage}`);
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
      reject(apiError(`请求超时（${REQUEST_TIMEOUT_MS / 1000}s）`, undefined, ""));
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
    throw new Error(`API 地址无效：${provider.baseUrl || "(空)"}（需以 http:// 或 https:// 开头）`);
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
  console.error("用法: node vision.js <图片路径> [问题]");
  console.error("      node vision.js --url <图片链接> [问题]");
}

async function main() {
  const unnamed = "未命名";
  const failPrefix = "识图失败:";
  // 首次运行检测：未配置时给出引导，不直接报错退出
  if (!isConfigured(CFG.primary)) {
    console.error("未检测到有效配置。首次使用请先完成配置向导：");
    console.error("按 SKILL.md 的「首次使用：配置向导」步骤，在技能目录生成 .env 后重试。");
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
      console.error(failPrefix, `文件不存在: ${resolved}`);
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
      console.error(`[vision] 主模型(${CFG.primary.model || "?"})不支持 BMP 图片，已切换备用模型(${CFG.fallback.model || "?"})识别。`);
    } else if (CFG.dualModel && isConfigured(CFG.fallback)) {
      // 两个模型都不支持 BMP
      console.error(red("模型不支持上传BMP格式图片"));
      process.exitCode = 1;
      return;
    } else {
      // 未启用双模型（或备用未配置），主模型不支持 BMP
      console.error(red("此模型不支持上传BMP格式图片"));
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
    if (bmpSwitched) console.error("[vision] 已使用备用模型完成识图。");
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
        console.error(`[vision] 主服务(${CFG.primary.provider || unnamed}) 失败: ${err.message}`);
        console.error(`[vision] 备用模型(${CFG.fallback.model || "?"})不支持 BMP 图片，无法切换。`);
        console.error(failPrefix, err.message);
        const exp0 = explain(err);
        if (exp0) console.error(exp0);
        process.exitCode = 1;
        return;
      }
      console.error(`[vision] 主服务(${CFG.primary.provider || unnamed}) 失败: ${err.message}`);
      const pc = causeOneLine(err);
      if (pc) console.error(`[vision] 主服务报错原因：${pc}`);
      console.error(`[vision] 尝试备用服务(${CFG.fallback.provider || unnamed})...`);
      try {
        const result = await callVision(CFG.fallback, imageUrl, prompt);
        console.log(result);
        console.error(`[vision] 本次由备用服务(${CFG.fallback.provider || unnamed}) 响应。`);
        return;
      } catch (fbErr) {
        console.error(`[vision] 备用服务也失败: ${fbErr.message}`);
        console.error("[vision] 主服务错误分析：");
        console.error(explain(err) || err.message);
        console.error("[vision] 备用服务错误分析：");
        console.error(explain(fbErr) || fbErr.message);
        process.exitCode = 1;
        return;
      }
    }
    if (CFG.dualModel && !isConfigured(CFG.fallback)) {
      console.error("[vision] 已启用双模型但备用服务未配置，无法自动切换。请检查 .env 中 VISION_FALLBACK_* 配置。");
    }
    console.error(failPrefix, err.message);
    const exp = explain(err);
    if (exp) console.error(exp);
    process.exitCode = 1;
    return;
  }
}

main();
