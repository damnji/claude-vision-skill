#!/usr/bin/env node
/**
 * Vision Skill 交互式配置向导（v3）
 *
 * 首次使用运行本向导生成 .env：
 *   node setup.js
 *
 * 特性：
 *   - 是否启用双模型、模型提供商两步均提供「返回」选项，可随时回退重输
 *   - 输入提供商为 deepseek 时，用红色字警告
 *   - 第一方提供商（chatgpt/kimi/claude/deepseek/千问/Gemini 等）内置官方
 *     OpenAI 兼容地址，向用户确认后使用；第三方中转站由用户自行输入地址
 *   - 完成后写入同目录 .env（含密钥，勿提交 git）
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

// 颜色（ANSI，终端下生效；非 TTY 输出（管道/重定向）时关闭，避免日志出现转义码）
const USE_COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const red = (s) => (USE_COLOR ? RED + s + RESET : s);
const green = (s) => (USE_COLOR ? GREEN + s + RESET : s);
const bold = (s) => (USE_COLOR ? BOLD + s + RESET : s);

// 经典 readline + 自行实现的行读取器：兼容交互终端与管道输入
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let inputQueue = [];
let currentResolve = null;
let stdinClosed = false;
rl.on("line", (line) => {
  if (currentResolve) {
    const r = currentResolve;
    currentResolve = null;
    r(line);
  } else {
    inputQueue.push(line);
  }
});
rl.on("close", () => {
  // stdin 结束但仍有待答问题：按「退出」处理，避免卡死
  stdinClosed = true;
  if (currentResolve) {
    const r = currentResolve;
    currentResolve = null;
    r("q");
  }
});

function ask(q) {
  return new Promise((resolve) => {
    process.stdout.write(q);
    if (inputQueue.length) return resolve(inputQueue.shift());
    if (stdinClosed) return resolve("q");
    currentResolve = resolve;
  });
}

const ENV_PATH = path.join(__dirname, ".env");

// 常用第一方提供商官方 OpenAI 兼容 API 地址（向导内供确认，用户可手动改）
const KNOWN_PROVIDERS = {
  openai:    { name: "OpenAI (chatgpt)",  url: "https://api.openai.com/v1" },
  chatgpt:   { name: "OpenAI (chatgpt)",  url: "https://api.openai.com/v1" },
  moonshot:  { name: "Moonshot (kimi)",   url: "https://api.moonshot.cn/v1" },
  kimi:      { name: "Moonshot (kimi)",   url: "https://api.moonshot.cn/v1" },
  anthropic: { name: "Anthropic (claude)",url: "https://api.anthropic.com/v1" },
  claude:    { name: "Anthropic (claude)",url: "https://api.anthropic.com/v1" },
  deepseek:  { name: "DeepSeek",          url: "https://api.deepseek.com/v1" },
  zhipu:     { name: "智谱 (GLM)",        url: "https://open.bigmodel.cn/api/paas/v4" },
  glm:       { name: "智谱 (GLM)",        url: "https://open.bigmodel.cn/api/paas/v4" },
  "智谱":     { name: "智谱 (GLM)",        url: "https://open.bigmodel.cn/api/paas/v4" },
  qwen:      { name: "阿里云百炼 (千问)",  url: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  "千问":     { name: "阿里云百炼 (千问)",  url: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  aliyun:    { name: "阿里云百炼 (千问)",  url: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  gemini:    { name: "Google Gemini",     url: "https://generativelanguage.googleapis.com/v1beta/openai" },
  google:    { name: "Google Gemini",     url: "https://generativelanguage.googleapis.com/v1beta/openai" },
};
const norm = (s) => s.toLowerCase().replace(/\s+/g, "");
const isFirstParty = (s) => !!KNOWN_PROVIDERS[norm(s)];
const isDeepseek = (s) => norm(s) === "deepseek";

function isValidBaseUrl(v) {
  try {
    const u = new URL(v);
    return (u.protocol === "http:" || u.protocol === "https:") && !u.search && !u.hash;
  } catch {
    return false;
  }
}

/** 带选项的菜单；返回选项对应的 value */
async function menu(q, choices) {
  console.log("\n" + bold(q));
  for (const c of choices) console.log(`   ${c.k}) ${c.label}`);
  while (true) {
    const a = (await ask("> ")).trim().toLowerCase();
    if (a === "q") return "quit"; // 用户输入 q 或 stdin 已关闭：退出，避免死循环
    const hit = choices.find((c) => c.k.toLowerCase() === a);
    if (hit) return hit.val;
    console.log(red("输入无效，请重新输入。"));
  }
}

/** 文本输入；返回 {type:"ok",value} | {type:"back"} | {type:"quit"} */
async function askInput(q) {
  while (true) {
    const a = (await ask(q + "（输入 0 返回上一步，q 退出） ")).trim();
    const low = a.toLowerCase();
    if (low === "q") return { type: "quit" };
    if (a === "0") return { type: "back" };
    if (a) return { type: "ok", value: a };
    console.log(red("不能为空，请重新输入。"));
  }
}

/**
 * 收集一个服务的配置（提供商 → 地址 → Key → 模型），每步可「0 返回」。
 * 返回 {ok:true,cfg} | {ok:false,action:"back"|"quit"}
 */
async function collectProvider(role) {
  const cfg = { provider: "", baseUrl: "", apiKey: "", model: "", bmp: true };
  let sub = "provider";

  while (true) {
    if (sub === "provider") {
      const a = await askInput(
        `请输入${role}提供商名称（推荐可选：智谱 GLM-4.6-V-Flash（免费）；其他如 chatgpt / kimi / claude / deepseek / 千问 / 智谱，或第三方中转站名）`
      );
      if (a.type === "quit") return { ok: false, action: "quit" };
      if (a.type === "back") return { ok: false, action: "back" };
      cfg.provider = a.value;

      // deepseek 红字警告
      if (isDeepseek(cfg.provider)) {
        console.log("\n" + red("⚠ DeepSeek 多模态能力较弱，仅可识别文字，不建议使用！"));
        const c = await menu("仍然使用 DeepSeek 吗？", [
          { k: "1", label: "仍然使用", val: "use" },
          { k: "2", label: "改用其他提供商", val: "rechoose" },
          { k: "0", label: "返回上一步", val: "back" },
          { k: "q", label: "退出", val: "quit" },
        ]);
        if (c === "rechoose") continue; // 重新输入提供商
        if (c === "back") return { ok: false, action: "back" };
        if (c === "quit") return { ok: false, action: "quit" };
      }
      sub = "url";
    } else if (sub === "url") {
      let val;
      if (isFirstParty(cfg.provider)) {
        const known = KNOWN_PROVIDERS[norm(cfg.provider)];
        console.log(`\n检测到第一方提供商：${bold(known.name)}`);
        const a = await askInput(
          `官方 API 地址：${green(known.url)}\n（输入 1 使用该地址，或直接输入其他地址）`
        );
        if (a.type === "quit") return { ok: false, action: "quit" };
        if (a.type === "back") { sub = "provider"; continue; }
        val = a.value === "1" ? known.url : a.value;
      } else {
        console.log("\n未识别为常见第一方提供商，按第三方中转站 / 整合站处理。");
        const a = await askInput("请输入请求地址（base URL，需以 http:// 或 https:// 开头）");
        if (a.type === "quit") return { ok: false, action: "quit" };
        if (a.type === "back") { sub = "provider"; continue; }
        val = a.value;
      }
      if (!isValidBaseUrl(val)) {
        console.log(red(`地址无效：${val}（需以 http:// 或 https:// 开头）`));
        continue; // 重新输入地址
      }
      cfg.baseUrl = val.replace(/\/+$/, "");
      sub = "key";
    } else if (sub === "key") {
      const a = await askInput("请输入 API Key");
      if (a.type === "quit") return { ok: false, action: "quit" };
      if (a.type === "back") { sub = "url"; continue; }
      cfg.apiKey = a.value;
      sub = "model";
    } else if (sub === "model") {
      const a = await askInput("请输入要使用的模型名（如 gpt-4o-mini / kimi-k2.6 / qwen3.8-max）");
      if (a.type === "quit") return { ok: false, action: "quit" };
      if (a.type === "back") { sub = "key"; continue; }
      cfg.model = a.value;
      sub = "bmp";
    } else if (sub === "bmp") {
      console.log(`\n提示：默认视为「不支持 BMP」。建议先让 AI（如 Claude Code）联网核实「${cfg.model}」是否支持上传 BMP 格式图片，确认支持后再选「支持」。`);
      const c = await menu(`模型「${cfg.model}」是否支持上传 BMP 格式图片？（默认不支持）`, [
        { k: "1", label: "支持（已联网核实）", val: "yes" },
        { k: "2", label: "不支持", val: "no" },
        { k: "0", label: "返回上一步", val: "back" },
        { k: "q", label: "退出", val: "quit" },
      ]);
      if (c === "back") { sub = "model"; continue; }
      if (c === "quit") return { ok: false, action: "quit" };
      cfg.bmp = (c === "yes");
      if (!cfg.bmp) {
        console.log("\n" + red(`请注意：${cfg.model} 不支持上传 BMP 格式图片！`));
      }
      return { ok: true, cfg };
    }
  }
}

// 转义 .env 值：含空白/#/引号/= 的值用双引号包裹并转义，保证与 vision.js 加载器往返一致
function escEnvValue(v) {
  if (/^[^\s#"'=]+$/.test(v)) return v;
  return JSON.stringify(v);
}

function writeEnv(dualModel, primary, fallback) {
  const L = [];
  L.push("# Vision Skill 配置（由配置向导生成，含密钥，勿提交 git）");
  L.push("");
  L.push(`VISION_DUAL_MODEL=${dualModel ? "true" : "false"}`);
  L.push("");
  L.push("# ===== 主服务 =====");
  L.push(`VISION_PRIMARY_PROVIDER=${escEnvValue(primary.provider)}`);
  L.push(`VISION_PRIMARY_BASE_URL=${escEnvValue(primary.baseUrl)}`);
  L.push(`VISION_PRIMARY_API_KEY=${escEnvValue(primary.apiKey)}`);
  L.push(`VISION_PRIMARY_MODEL=${escEnvValue(primary.model)}`);
  L.push(`VISION_PRIMARY_BMP=${primary.bmp ? "true" : "false"}`);
  if (dualModel && fallback) {
    L.push("");
    L.push("# ===== 备用服务 =====");
    L.push(`VISION_FALLBACK_PROVIDER=${escEnvValue(fallback.provider)}`);
    L.push(`VISION_FALLBACK_BASE_URL=${escEnvValue(fallback.baseUrl)}`);
    L.push(`VISION_FALLBACK_API_KEY=${escEnvValue(fallback.apiKey)}`);
    L.push(`VISION_FALLBACK_MODEL=${escEnvValue(fallback.model)}`);
    L.push(`VISION_FALLBACK_BMP=${fallback.bmp ? "true" : "false"}`);
  }
  L.push("");
  fs.writeFileSync(ENV_PATH, L.join("\n"), "utf8");
}

async function main() {
  console.log(bold("\n=== Vision Skill 配置向导 ===\n"));
  console.log("将生成配置: " + ENV_PATH);
  console.log(red("（.env 含 API Key，请勿提交到 git）") + "\n");

  let dualModel = false;
  let primary = null;
  let fallback = null;
  let phase = "dual";

  while (true) {
    if (phase === "dual") {
      const d = await menu("是否启用双模型（主服务 + 备用服务，主服务失败自动切换）？", [
        { k: "1", label: "启用双模型", val: "yes" },
        { k: "2", label: "仅单模型", val: "no" },
        { k: "0", label: "返回重选", val: "again" },
        { k: "q", label: "退出", val: "quit" },
      ]);
      if (d === "quit") { console.log("已退出，未生成 .env。"); rl.close(); process.exitCode = 0; return; }
      if (d === "again") continue; // 返回重选
      dualModel = d === "yes";
      phase = "primary";
    } else if (phase === "primary") {
      const r = await collectProvider("主服务");
      if (r.ok) { primary = r.cfg; phase = dualModel ? "fallback" : "confirm"; }
      else if (r.action === "quit") { console.log("已退出，未生成 .env。"); rl.close(); process.exitCode = 0; return; }
      else if (r.action === "back") phase = "dual"; // 返回双模型选择
    } else if (phase === "fallback") {
      const r = await collectProvider("备用服务");
      if (r.ok) { fallback = r.cfg; phase = "confirm"; }
      else if (r.action === "quit") { console.log("已退出，未生成 .env。"); rl.close(); process.exitCode = 0; return; }
      else if (r.action === "back") phase = "primary"; // 返回主服务配置
    } else if (phase === "confirm") {
      console.log("\n" + bold("===== 配置确认 ====="));
      console.log(`  双模型: ${dualModel ? "启用" : "不启用"}`);
      console.log(`  主服务: ${primary.provider} | 模型 ${primary.model}${primary.bmp ? "" : "（不支持BMP）"}`);
      console.log(`          地址 ${primary.baseUrl}`);
      if (dualModel && fallback) {
        console.log(`  备用服务: ${fallback.provider} | 模型 ${fallback.model}${fallback.bmp ? "" : "（不支持BMP）"}`);
        console.log(`          地址 ${fallback.baseUrl}`);
      }
      const c = await menu("确认写入 .env 吗？", [
        { k: "1", label: "确认写入", val: "write" },
        { k: "0", label: "返回修改", val: "back" },
        { k: "q", label: "退出不保存", val: "quit" },
      ]);
      if (c === "quit") { console.log("已退出，未生成 .env。"); rl.close(); process.exitCode = 0; return; }
      if (c === "back") { phase = dualModel ? "fallback" : "primary"; continue; }
      try {
        writeEnv(dualModel, primary, fallback);
      } catch (err) {
        console.error(red("\n写入 .env 失败：" + (err && err.message || err)));
        console.error("请检查目录是否可写，或手动按 .env.example 创建 .env。");
        rl.close();
        process.exitCode = 1;
        return;
      }
      console.log(green("\n✅ 配置已写入 ") + ENV_PATH);
      console.log("现在可以运行: node vision.js <图片路径>");
      rl.close();
      return;
    }
  }
}

main().catch((e) => {
  console.error(red("向导出错: " + (e && e.message || e)));
  rl.close();
  process.exitCode = 1;
});
