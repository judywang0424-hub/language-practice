/* Client-side port of src/analyzer (rules.py + zh_en.py). Same output shape as POST /api/analyze and /api/suggest.
   Data (regexes, templates, word lists, dictionary) is generated from the Python source by scripts/gen_engine_data.py;
   only the lambda replacements and the pass logic are hand-ported here. Parity: tests/parity_test.js. */
(function (g) {
"use strict";
const R = typeof module !== "undefined" ? require("./rules_data.js") : g.EP_RULES;
const Z = typeof module !== "undefined" ? require("./zh_en_dict.js") : g.EP_ZH;
const DICT = Z.DICT, STOP = new Set(Z.STOP.split(""));

/* ---------- helpers mirroring rules.py ---------- */
const IRREG_PAST = R.IRREG_PAST;
const isVowelLike = (ch) => "aeiou".includes(ch);
function past_of(v) {
  const l = v.toLowerCase();
  if (l in IRREG_PAST) return IRREG_PAST[l];
  if (l.endsWith("e")) return l + "d";
  if (l.endsWith("y") && !isVowelLike(l.slice(-2, -1))) return l.slice(0, -1) + "ied";
  if (["plan", "shop", "stop"].includes(l)) return l + l.slice(-1) + "ed";
  return l + "ed";
}
function third_person(v) {
  const l = v.toLowerCase(); const sp = {have: "has", do: "does", go: "goes", be: "is"};
  if (l in sp) return sp[l];
  if (/(s|sh|ch|x|z|o)$/.test(l)) return l + "es";
  if (l.endsWith("y") && !isVowelLike(l.slice(-2, -1))) return l.slice(0, -1) + "ies";
  return l + "s";
}
function plural(n) {
  const l = n.toLowerCase();
  if (l in R.IRREG_PLURAL) return R.IRREG_PLURAL[l];
  if (/(s|sh|ch|x)$/.test(l)) return l + "es";
  if (l.endsWith("y") && !isVowelLike(l.slice(-2, -1))) return l.slice(0, -1) + "ies";
  return l + "s";
}
const REV_PAST = {}; Object.entries(IRREG_PAST).forEach(([k, v]) => { if (k !== "is" && k !== "are") REV_PAST[v] = k; });
const _base = (p) => REV_PAST[p.toLowerCase()] || p;
const _base3 = (v) => { v = v.toLowerCase(); return ({goes: "go", does: "do", has: "have"})[v] || v.slice(0, -1); };
function _ing(v) {
  v = v.toLowerCase();
  if (v.endsWith("ie")) return v.slice(0, -2) + "ying";
  if (v.endsWith("e") && v !== "be" && v !== "see") return v.slice(0, -1) + "ing";
  if (["run", "swim", "shop", "plan", "sit", "get", "stop"].includes(v)) return v + v.slice(-1) + "ing";
  return v + "ing";
}
const isUpper = (c) => !!c && c !== c.toLowerCase() && c === c.toUpperCase();
const isLower = (c) => !!c && c !== c.toUpperCase() && c === c.toLowerCase();
const _keep_case = (src, rep) => (isUpper(src[0]) && isLower(rep[0])) ? rep[0].toUpperCase() + rep.slice(1) : rep;
const startsWithAny = (w, list) => list.some(p => w.startsWith(p));

/* lambda replacements from rules.py, keyed by label. m.g(i) = group i or undefined */
const FN = {
  "make a mistake": m => ({do: "make", did: "made", does: "makes", doing: "making"})[m.g(1).toLowerCase()] + " " + (m.g(2) || "") + m.g(0).split(/\s+/).pop(),
  "do homework": m => ({make: "do", made: "did", makes: "does", making: "doing"})[m.g(1).toLowerCase()] + " " + (m.g(2) || "") + "homework",
  "suggest that sb do": m => "suggest" + (m.g(1) || "") + " that " + ({me: "I", him: "he", her: "she", us: "we", them: "they"})[m.g(2).toLowerCase()] + " " + m.g(3),
  "really + verb (no 'am')": m => "I really " + (m.g(1) !== "I was" ? m.g(3) : past_of(m.g(3))),
  "present perfect: have + past participle": m => m.g(1) + " " + (R.PARTICIPLE[m.g(2).toLowerCase()] || past_of(m.g(2))),
  "spend time doing": m => "spend" + (m.g(1) || "") + " " + (m.g(2) || "") + "time " + _ing(m.g(3)),
  "no double negatives": m => "don't have " + ({nothing: "anything", "no one": "anyone", nobody: "anybody"})[m.g(1).toLowerCase()],
  "there is/are agreement": m => "there " + (m.g(1).toLowerCase() === "is" ? "are" : "were") + ` ${m.g(2)} ${m.g(3)}`,
  "subject-verb agreement (plural)": m => m.g(1) + " " + ({is: "are", was: "were", has: "have"})[m.g(2).toLowerCase()],
  "subject-verb agreement (everyone is)": m => m.g(1) + " " + ({are: "is", were: "was", have: "has"})[m.g(2).toLowerCase()],
  "subject-verb agreement (he/she/it)": m => m.g(1) + " " + ({"don't": "doesn't", have: "has", are: "is", were: "was"})[m.g(2).toLowerCase()],
  "subject-verb agreement": m => m.g(1) + " " + ({"doesn't": "don't", has: "have", was: (m.g(1) === "I" ? "was" : "were")})[m.g(2).toLowerCase()],
  "one of + plural noun": m => `one of ${m.g(1)} ${plural(m.g(2))}`,
  "one of ... + singular verb": m => m.g(1) + " " + third_person(m.g(2)),
  "plural nouns": m => `${m.g(1)} ${plural(m.g(2))}`,
  "base verb after modal/did/to": m => m.g(1) + " " + _base(m.g(2)),
  "base verb after modal": m => m.g(1) + " " + _base3(m.g(2)),
  "articles (a/an + job)": m => m.g(1) + " " + (isVowelLike(m.g(2)[0].toLowerCase()) ? "an " : "a ") + m.g(2),
};
const expand = (tpl, m) => tpl.replace(/\\(\d)/g, (_, d) => m.g(+d) || "");
const rx = (src, flags = "gi") => new RegExp(src, flags);
const PHRASES = R.PHRASES.map(([p, rep, cat, label, en, zh]) => {
  if (rep === null && !FN[label]) throw new Error("missing JS port for rule: " + label);
  return {re: rx(p), rep: rep === null ? FN[label] : rep, cat, label, en, zh};
});
const PAST_MARKERS = rx(R.PAST_MARKERS, "i"), SV_THIRD = rx(R.SV_THIRD), PRESENT_IN_PAST = rx(R.PRESENT_IN_PAST);
const ARTICLE_A = rx(R.ARTICLE_A), ARTICLE_AN = rx(R.ARTICLE_AN), UNCOUNT_RE = rx(R.UNCOUNT_RE);
const CJK = /[\u3400-\u9fff\uf900-\ufaff]+/g;

/* replace with a Python-like match object */
function sub(re, s, fn) {
  return s.replace(re, function () {
    const a = Array.from(arguments); const groups = [];
    for (let i = 0; i < a.length && typeof a[i] !== "number"; i++) groups.push(a[i]);
    return fn({g: (i) => groups[i]});
  });
}

/* ---------- zh -> en ---------- */
const KEYS = Object.keys(DICT); const MAXLEN = Math.max(...KEYS.map(k => k.length));
const hasChinese = (t) => /[\u3400-\u9fff\uf900-\ufaff]/.test(t || "");
function segment(zh) {
  const out = []; let i = 0;
  while (i < zh.length) {
    let found = false;
    for (let L = Math.min(MAXLEN, zh.length - i); L > 0; L--) {
      const piece = zh.slice(i, i + L);
      if (piece in DICT) { out.push([piece, true]); i += L; found = true; break; }
    }
    if (!found) {
      if (out.length && !out[out.length - 1][1]) out[out.length - 1][0] += zh[i]; else out.push([zh[i], false]);
      i++;
    }
  }
  return out;
}
const entry = (zh) => ({zh, options: DICT[zh][0], example: DICT[zh][1], note: DICT[zh][2]});
const best = (zh) => DICT[zh] ? DICT[zh][0][0].split(" (")[0] : null;
const stripStop = (p) => p.split("").filter(ch => !STOP.has(ch)).join("");
function lookup(text) {
  const results = [], seen = new Set();
  for (const run of (text || "").match(CJK) || []) {
    if (run in DICT && !seen.has(run)) { seen.add(run); results.push(entry(run)); continue; }
    for (const [piece, known] of segment(run)) {
      if (seen.has(piece)) continue; seen.add(piece);
      if (known) results.push(entry(piece));
      else if (stripStop(piece)) results.push({zh: piece, options: [], example: "", note: "离线词库里没有这个词，接上 AI 后可以给出建议 / not in offline dictionary"});
    }
  }
  return results;
}

/* ---------- analyze ---------- */
function analyzeSentence(s) {
  const issues = []; let cur = s;
  const hit = (id, category, label, from, to, reason, reason_zh) => {
    if (from.trim().toLowerCase() === to.trim().toLowerCase() && from.trim() === to.trim()) return false;
    issues.push({id, category, label, from, to, reason, reason_zh}); return true;
  };
  if (hasChinese(cur)) {
    cur = cur.replace(CJK, (run) => {
      const out = [];
      for (const [piece, known] of segment(run)) {
        if (known) {
          const eng = best(piece), d = DICT[piece];
          hit("zh2en:" + piece, "zh2en", `${piece} → ${eng}`, piece, eng, `Natural English for 「${piece}」: ` + d[0].join(" / "),
            (d[2] ? d[2] + "；" : "") + "常用说法：" + d[0].join(" / "));
          out.push(eng);
        } else if (stripStop(piece)) {
          hit("zh2en:?" + piece, "zh2en", `${piece} → ?`, piece, piece, "Not in the offline dictionary; connect an AI key for open suggestions.", "离线词库没有这个词");
          out.push(piece);
        }
      }
      return " " + out.join(" ") + " ";
    });
    cur = cur.replace(/\s+/g, " ").split(" ,").join(",").split(" .").join(".").trim();
    cur = cur.replace(/[，。！？]/g, c => ({"，": ",", "。": ".", "！": "!", "？": "?"})[c]);
  }
  for (const r of PHRASES) {
    cur = sub(r.re, cur, (m) => {
      const frm = m.g(0);
      let to = typeof r.rep === "function" ? r.rep(m) : expand(r.rep, m);
      if (!frm.endsWith(" ")) to = to.replace(/\s+/g, " ").trim();
      to = _keep_case(frm, to);
      if (to !== frm) hit("rule:" + r.label, r.cat, r.label, frm, to, r.en, r.zh);
      return to;
    });
  }
  cur = sub(UNCOUNT_RE, cur, (m) => {
    const to = _keep_case(m.g(0), R.UNCOUNT[m.g(0).toLowerCase()]); const l = to.toLowerCase();
    hit("rule:uncountable " + l, "grammar", `${l} (uncountable)`, m.g(0), to, `'${l}' is uncountable — no -s.`, `${l} 不可数，不加 s`);
    return to;
  });
  const before3 = cur;
  cur = sub(SV_THIRD, cur, (m) => {
    if (PAST_MARKERS.test(before3)) return m.g(0);
    const to = `${m.g(1)} ${m.g(2) ? m.g(2) + " " : ""}${third_person(m.g(3))}`;
    hit("rule:third-person -s", "grammar", "third-person -s (he goes)", m.g(0), to, "He/she/it + verb needs -s in the present.", "第三人称单数现在时动词加 s");
    return to;
  });
  if (PAST_MARKERS.test(cur)) {
    cur = sub(PRESENT_IN_PAST, cur, (m) => {
      const v = m.g(3).toLowerCase();
      const past = (v === "am" || v === "is") ? "was" : v === "are" ? "were" : past_of(v);
      const to = `${m.g(1)} ${m.g(2) ? m.g(2) + " " : ""}${past}`;
      hit("rule:past tense", "grammar", "past tense with past-time words", m.g(0), to,
        "The sentence talks about the past (yesterday / last… / ago), so use past tense.", "有 yesterday / last… / ago 等过去时间，动词用过去式");
      return to;
    });
  }
  cur = sub(ARTICLE_A, cur, (m) => {
    const w = m.g(1); if (startsWithAny(w.toLowerCase(), R.AN_EXCEPT_CONS)) return m.g(0);
    const to = _keep_case(m.g(0), "an " + w);
    hit("rule:a/an", "grammar", "a vs an", m.g(0), to, "Use 'an' before a vowel sound.", "元音音素前用 an"); return to;
  });
  cur = sub(ARTICLE_AN, cur, (m) => {
    const w = m.g(1); if (startsWithAny(w.toLowerCase(), R.A_EXCEPT_VOWEL)) return m.g(0);
    const to = _keep_case(m.g(0), "a " + w);
    hit("rule:a/an", "grammar", "a vs an", m.g(0), to, "Use 'a' before a consonant sound.", "辅音音素前用 a"); return to;
  });
  cur = cur.trim();
  if (cur && isLower(cur[0])) cur = cur[0].toUpperCase() + cur.slice(1);
  if (cur && !".!?".includes(cur[cur.length - 1])) cur += ".";
  return [cur, issues];
}
function splitSentences(text) {
  text = (text || "").trim().replace(/\s+/g, " ");
  if (!text) return [];
  const parts = text.split(/(?<=[.!?。！？])\s+|(?<=[。！？])/).map(p => (p || "").trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    if (p.split(" ").length > 28 && !/[.!?]/.test(p.slice(0, -1))) out.push(...p.split(/\s+(?=(?:and then|but|so|because)\b)/).map(c => c.trim()).filter(Boolean));
    else out.push(p);
  }
  return out;
}
const CAT_ZH = {grammar: "语法", word_choice: "用词", phrasing: "表达", zh2en: "中译英"};
function summary(total, cats, n) {
  if (!total) return `${n} 句都没发现明显问题，很棒！可以直接跟读练流利度。`;
  return `共 ${n} 句，找到 ${total} 处可以改进：` + Object.entries(cats).map(([k, v]) => `${CAT_ZH[k] || k} ${v} 处`).join("、") + "。下面逐句看，然后跟读练到过关。";
}
function analyze(text) {
  const sentences = splitSentences(text).map((s, i) => {
    let [corrected, issues] = analyzeSentence(s);
    const tidy = ".!?。！？".includes(s.slice(-1)) ? s : s + ".";
    if (!issues.length && corrected.replace(/[.!?]+$/, "") === tidy.replace(/[.!?。！？]+$/, "")) corrected = tidy;
    return {index: i, original: s, corrected, issues, ok: issues.length === 0};
  });
  const cats = {}; let total = 0;
  sentences.forEach(s => s.issues.forEach(it => { cats[it.category] = (cats[it.category] || 0) + 1; total++; }));
  return {engine: "rules-local", sentences, issue_count: total, by_category: cats,
    corrected_passage: sentences.map(s => s.corrected).join(" "), summary_zh: summary(total, cats, sentences.length)};
}
const api = {analyze, suggest: (t) => ({engine: "dictionary-local", items: lookup(t)}), lookup, segment};
if (typeof module !== "undefined") module.exports = api; else g.EPEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
