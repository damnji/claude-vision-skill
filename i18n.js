#!/usr/bin/env node
/**
 * i18n.js — 中英双语支持（Vision Skill v3）
 *
 * 语言选择（优先级从高到低）：
 *   1. 环境变量 VISION_LANG = zh | en | auto
 *   2. 环境变量 LANG / LC_ALL / LC_MESSAGES
 *   3. 系统区域（Intl），zh → 中文，en → English
 *   默认：中文
 *
 * 用法：
 *   const { L, lang } = require("./i18n.js");
 *   console.log(L({ zh: "你好", en: "Hello" }));
 */

function detectBySystemLocale() {
  try {
    const loc = (Intl.DateTimeFormat().resolvedOptions().locale || "").toLowerCase();
    if (loc.startsWith("zh") || loc.startsWith("cn")) return "zh";
    if (loc.startsWith("en")) return "en";
  } catch { /* ignore */ }
  return "zh";
}

function detectLang(env) {
  const raw = (env.VISION_LANG || env.LANG || env.LC_ALL || env.LC_MESSAGES || "").trim().toLowerCase();
  if (!raw || raw === "auto") return detectBySystemLocale();
  // 宽松匹配：en / english / eng / en-US / en_US.UTF-8 等
  if (raw.startsWith("en")) return "en";
  // zh / chinese / china / chi / cn / zh-CN / zh_CN.UTF-8 等
  if (raw.startsWith("zh") || raw.startsWith("cn") || raw.startsWith("chi")) return "zh";
  // 其它无法识别的值 → 按系统区域自动判断
  return detectBySystemLocale();
}

let _lang = null;
function lang() {
  if (!_lang) _lang = detectLang(process.env);
  return _lang;
}

// 取当前语言的文本：L({ zh: "...", en: "..." })，缺省回落中文
function L(pair) {
  return (pair && pair[lang()]) || (pair && pair.zh) || String(pair);
}

module.exports = { L, lang, detectLang };
