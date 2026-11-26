/* Weekly recap (周报): pure functions over stored sessions. Works in browser (window.EPRecap) and node (tests).
   Session shape (saved by app.js):
   {id, at(ms), kind:"passage"|"review"|"word", passage, sentences, issues:[{category,label,from,to}],
    drilled:[{target, labels:[...], attempts, passes, fails, passed}], attempts, passes, fails, completed}
   wordsAdded: [{at, zh, en}] from the 求词 tab. */
(function (g) {
"use strict";
const CAT_ZH = {grammar: "语法", word_choice: "用词", phrasing: "表达", zh2en: "中译英"};
const LABEL_ZH = {
  "past tense with past-time words": "过去时（yesterday/last…）", "third-person -s (he goes)": "第三人称单数加 s",
  "subject-verb agreement (he/she/it)": "主谓一致（he/she doesn't）", "subject-verb agreement (plural)": "主谓一致（复数）",
  "subject-verb agreement (everyone is)": "everyone 用单数", "subject-verb agreement": "主谓一致",
  "there is/are agreement": "there is / there are", "plural nouns": "名词复数", "one of + plural noun": "one of + 复数",
  "one of ... + singular verb": "one of… 动词用单数", "a vs an": "a / an", "articles (a/an + job)": "职业前加 a/an",
  "base verb after modal/did/to": "情态动词/did 后用原形", "base verb after modal": "情态动词后用原形",
  "modal + base verb (no 'to')": "情态动词后不加 to", "present perfect: have + past participle": "现在完成时",
  "for + period / since + point": "for / since", "on the weekend": "on the weekend", "in the morning/afternoon/evening": "in the morning",
  "on + day": "星期几用 on", "although ... (no 'but')": "although 不配 but", "because ... (no 'so')": "because 不配 so",
  "really + verb (no 'am')": "really like（不说 am very like）", "really like (not 'very like')": "really like", "really + verb": "really + 动词",
  "listen to": "listen to", "wait for sb": "wait for", "arrive at/in": "arrive at/in", "go home (no 'to')": "go home",
  "make a mistake": "make a mistake", "do homework": "do homework", "take a photo": "take a photo", "bored vs boring": "bored / boring",
  "interested in": "interested in", "advice (uncountable)": "advice 不可数", "capital I": "I 大写", "suggest that sb do": "suggest that…",
  "discuss + object (no 'about')": "discuss 不加 about", "explain to sb": "explain to sb", "How do you say...?": "How do you say…?",
};
const zhName = (label) => LABEL_ZH[label] || label;

function isoWeek(ts) {
  const d = new Date(ts); const day = (d.getDay() + 6) % 7; // Mon=0
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  const thu = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 3);
  const y = thu.getFullYear(); const jan4 = new Date(y, 0, 4);
  const jan4Mon = new Date(y, 0, 4 - ((jan4.getDay() + 6) % 7));
  const w = 1 + Math.round((mon - jan4Mon) / (7 * 864e5));
  const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
  const f = (x) => `${x.getMonth() + 1}/${x.getDate()}`;
  return {key: `${y}-W${String(w).padStart(2, "0")}`, start: mon.getTime(), end: sun.getTime() + 864e5 - 1, range: `${f(mon)}–${f(sun)}`};
}

function weekStats(data, weekKey) {
  const all = (data.sessions || []).filter(s => s && s.at).sort((a, b) => a.at - b.at);
  const inWeek = all.filter(s => isoWeek(s.at).key === weekKey);
  const before = all.filter(s => isoWeek(s.at).key < weekKey);
  const wk = isoWeek(inWeek[0] ? inWeek[0].at : Date.now());
  const days = new Set(inWeek.map(s => new Date(s.at).toDateString())).size;
  const issues = inWeek.flatMap(s => (s.issues || []).map(i => ({...i, sid: s.id})));
  const byCat = {}; issues.forEach(i => byCat[i.category] = (byCat[i.category] || 0) + 1);
  const attempts = inWeek.reduce((n, s) => n + (s.attempts || 0), 0);
  const passes = inWeek.reduce((n, s) => n + (s.passes || 0), 0);
  const fails = inWeek.reduce((n, s) => n + (s.fails || 0), 0);
  const drilled = inWeek.flatMap(s => s.drilled || []);
  const passedItems = drilled.filter(d => d.passed).length;

  // words learned: zh2en + word_choice fixes this week + words added from 求词
  const words = new Map();
  issues.filter(i => (i.category === "zh2en" || i.category === "word_choice") && i.to && i.from !== i.to)
    .forEach(i => words.set((i.category === "zh2en" ? i.from + "→" : "") + i.to, i.category === "zh2en" ? `${i.from}→${i.to}` : i.to));
  (data.wordsAdded || []).filter(w => isoWeek(w.at).key === weekKey).forEach(w => words.set(w.zh + "→" + w.en, `${w.zh}→${w.en}`));

  // occurrences per label: count + distinct sessions
  const occ = (list) => { const m = {}; list.forEach(i => { const o = m[i.label] || (m[i.label] = {label: i.label, category: i.category, n: 0, sessions: new Set()}); o.n++; o.sessions.add(i.sid); }); return m; };
  const nonZh = issues.filter(i => i.category !== "zh2en");
  const cur = occ(nonZh);
  const grammar = Object.values(cur).filter(o => o.category === "grammar").sort((a, b) => b.n - a.n);
  const recurring = Object.values(cur).filter(o => o.sessions.size >= 2 || o.n >= 3).sort((a, b) => b.n - a.n);

  // improved: (a) seen in earlier weeks, now rate per session at most half (or gone) and still practised this week;
  //           (b) within this week: present in the first half of sessions, absent from the second half (needs >= 2 sessions)
  const passageSessions = (list) => list.filter(s => s.kind !== "word" && s.kind !== "review").length || 1;
  const prev = occ(before.flatMap(s => (s.issues || []).filter(i => i.category !== "zh2en").map(i => ({...i, sid: s.id}))));
  const improved = new Map();
  Object.values(prev).forEach(o => {
    const prevRate = o.n / passageSessions(before), nowRate = (cur[o.label] ? cur[o.label].n : 0) / passageSessions(inWeek);
    if (inWeek.length && prevRate > 0 && nowRate <= prevRate / 2) improved.set(o.label, o);
  });
  const ps = inWeek.filter(s => s.kind !== "word" && s.kind !== "review");
  if (ps.length >= 2) {
    const half = Math.floor(ps.length / 2), early = ps.slice(0, half), late = ps.slice(half);
    const lateLabels = new Set(late.flatMap(s => (s.issues || []).map(i => i.label)));
    const earlyCount = {};
    early.flatMap(s => s.issues || []).filter(i => i.category !== "zh2en" && !lateLabels.has(i.label))
      .forEach(i => { earlyCount[i.label] = (earlyCount[i.label] || 0) + 1; if (earlyCount[i.label] >= 2) improved.set(i.label, i); });
  }
  // a problem that stopped appearing counts as improved, not as recurring
  for (let k = recurring.length - 1; k >= 0; k--) if (improved.has(recurring[k].label)) recurring.splice(k, 1);

  return {
    week: weekKey, range: wk.range, sessions: inWeek.length, passageSessions: ps.length, days,
    sentences: inWeek.reduce((n, s) => n + (s.sentences || 0), 0), issues: issues.length, byCat,
    attempts, passes, fails, passRate: attempts ? Math.round(100 * passes / attempts) : 0,
    drilledItems: drilled.length, passedItems,
    words: [...words.values()], grammar: grammar.map(o => ({label: o.label, name: zhName(o.label), n: o.n})),
    recurring: recurring.map(o => ({label: o.label, name: zhName(o.label), n: o.n, sessions: o.sessions.size})),
    improved: [...improved.values()].map(o => ({label: o.label, name: zhName(o.label)})),
  };
}

const take = (arr, n) => arr.slice(0, n);
function templateRecap(st) {
  if (!st.sessions) return `${st.week}（${st.range}）这周还没有练习记录。每天说一小段，周末这里就会有你的周报～`;
  const cat = Object.entries(st.byCat).map(([k, v]) => `${CAT_ZH[k] || k}${v}`).join("、");
  const parts = [];
  parts.push(`这周练了 ${st.days} 天共 ${st.sessions} 次，说了 ${st.sentences} 句，找出 ${st.issues} 处问题${cat ? `（${cat}）` : ""}，跟读过关率 ${st.passRate}%。`);
  parts.push(st.words.length ? `新学：${take(st.words, 4).join("、")}${st.words.length > 4 ? ` 等 ${st.words.length} 个` : ""}。` : "这周没有新词，下周用「求词」把不会的词补上。");
  if (st.grammar.length) parts.push(`语法练了${take(st.grammar, 3).map(x => x.name).join("、")}。`);
  if (st.recurring.length) parts.push(`反复出现：${take(st.recurring, 2).map(x => `${x.name}（${x.n} 次）`).join("、")}，下周重点盯。`);
  else parts.push("没有反复犯的错，保持住！");
  if (st.improved.length) parts.push(`明显进步：${take(st.improved, 3).map(x => x.name).join("、")}，出错少多了 👍`);
  return parts.join("");
}

if (typeof module !== "undefined") module.exports = {isoWeek, weekStats, templateRecap, zhName};
else g.EPRecap = {isoWeek, weekStats, templateRecap, zhName};
})(typeof window !== "undefined" ? window : globalThis);
