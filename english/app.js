/* English Practice v1 — front end (vanilla JS, no build step).
   Structure kept simple so it can be ported to a WeChat mini-program later:
   - api.*        network calls (swap fetch -> wx.request)
   - speech.*     speech-to-text (swap Web Speech API -> WeChat 同声传译 plugin / wx.getRecorderManager + ASR)
   - store.*      persistence (swap localStorage -> wx.setStorageSync)
   - compare()    pure function, portable as-is
*/
(() => {
"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const CAT_ZH = {grammar:"语法", word_choice:"用词", phrasing:"表达", zh2en:"中译英"};
let CFG = {pass_threshold: 0.9, passes_to_master: 2};

function toast(msg, ms = 2200) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), ms); }

/* ---------------- api ---------------- */
const api = {
  async post(path, body) {
    const r = await fetch(path, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
    return r.json();
  },
  // engine: EP_CONFIG.engine = "auto" (server if reachable, else built-in JS) | "local" | "server"
  mode: (window.EP_CONFIG && window.EP_CONFIG.engine) || "auto",
  server: null,            // health JSON once the server answered, else null
  useLocal() { return this.mode === "local" || (this.mode === "auto" && !this.server); },
  async viaEngine(path, text, localFn) {
    if (!this.useLocal()) {
      try { return await api.post(path, {text}); }
      catch (e) { if (this.mode === "server") throw e; console.warn("server unavailable, using local engine", e); this.server = null; updateEngineBadge(); }
    }
    return localFn(text);
  },
  analyze: (text) => api.viaEngine("api/analyze", text, t => window.EPEngine.analyze(t)),
  suggest: (text) => api.viaEngine("api/suggest", text, t => window.EPEngine.suggest(t)),
  async health() {
    if (this.mode === "local") return null;
    try { const r = await fetch("api/health", {cache: "no-store"}); if (!r.ok) throw 0; const h = await r.json(); if (!h || !h.ok) throw 0; this.server = h; }
    catch { this.server = null; }
    return this.server;
  },
  async recapAI(stats) {  // only when the server has an AI key
    if (this.useLocal() || !this.server || !String(this.server.engine).startsWith("ai")) return null;
    try { const r = await fetch("api/recap", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({stats})}); if (!r.ok) return null; return (await r.json()).text || null; }
    catch { return null; }
  },
};
function updateEngineBadge() {
  const s = api.server;
  $("#engine").textContent = s && String(s.engine).startsWith("ai") ? "AI 分析" : s ? "离线规则（服务器）" : "离线规则（本机）";
}

/* ---------------- store (localStorage) ---------------- */
const KEY = "englishPractice.v1";
const store = {
  load() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } },
  get() {
    const d = this._d || (this._d = this.load() || {});
    d.points = d.points || {}; d.sessions = d.sessions || []; d.wordsAdded = d.wordsAdded || []; d.recaps = d.recaps || {};
    return d;
  },
  newSession(kind, extra) {
    const s = Object.assign({id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: Date.now(), kind,
      passage: "", sentences: 0, issues: [], drilled: [], attempts: 0, passes: 0, fails: 0, completed: false}, extra || {});
    this.get().sessions.push(s); this.save(); return s;
  },
  save() { localStorage.setItem(KEY, JSON.stringify(this.get())); },
  point(issue, target) {
    const d = this.get(); const k = (issue.category + "|" + issue.label).toLowerCase();
    const p = d.points[k] || (d.points[k] = {key: k, label: issue.label, category: issue.category, seen: 0, passes: 0, fails: 0, examples: [], fixes: [], last: 0});
    if (target && !p.examples.includes(target)) { p.examples.unshift(target); p.examples = p.examples.slice(0, 5); }
    const fix = issue.from && issue.to && issue.from !== issue.to ? `${issue.from} → ${issue.to}` : "";
    if (fix && !p.fixes.includes(fix)) { p.fixes.unshift(fix); p.fixes = p.fixes.slice(0, 5); }
    return p;
  },
  strength(p) { return Math.max(0, Math.min(1, (p.passes - 0.5 * p.fails) / 3)); },
};

/* ---------------- speech-to-text ---------------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const speech = {
  supported: !!SR,
  /* Robust on Android Chrome: one-shot sessions auto-restarted while "on", final text accumulated. */
  create({lang, onText, onState}) {
    let rec = null, on = false, finalText = "", lastErr = "";
    function start(seed = "") {
      if (!SR) { onState("unsupported"); return; }
      finalText = seed ? seed.trim() + " " : ""; on = true; lastErr = ""; spawn(); onState("on");
    }
    function spawn() {
      rec = new SR(); rec.lang = lang; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript.trim() + " "; else interim += r[0].transcript;
        }
        onText(finalText.trim(), interim.trim());
      };
      rec.onerror = (e) => { lastErr = e.error; if (e.error === "not-allowed" || e.error === "service-not-allowed") { on = false; onState("denied"); } };
      rec.onend = () => { if (on && lastErr !== "not-allowed") { try { spawn(); } catch { on = false; onState("off"); } } else onState("off"); };
      try { rec.start(); } catch { /* already started */ }
    }
    function stop() { on = false; try { rec && rec.stop(); } catch {} onState("off"); }
    return {start, stop, get on() { return on; }, get text() { return finalText.trim(); }};
  },
};
function speak(text, rate = 0.92) {
  if (!("speechSynthesis" in window)) return toast("这个浏览器不支持朗读");
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = "en-US"; u.rate = rate;
  const v = speechSynthesis.getVoices().find(v => /en[-_]US/i.test(v.lang)); if (v) u.voice = v;
  speechSynthesis.speak(u);
}

function bindMic(btn, stateEl, lang, idleText, onText, getSeed) {
  const r = speech.create({lang, onText, onState: (s) => {
    btn.classList.toggle("on", s === "on");
    stateEl.textContent = s === "on" ? "正在听……说完点一下停止" : s === "denied" ? "麦克风被拒绝了：请在浏览器地址栏左边的🔒里允许麦克风" : s === "unsupported" ? "这个浏览器不支持语音识别，请用 Chrome 打开，或直接打字" : idleText;
  }});
  btn.addEventListener("click", () => { if (r.on) r.stop(); else { speechSynthesis && speechSynthesis.cancel(); r.start(getSeed ? getSeed() : ""); } });
  return r;
}

/* ---------------- compare (pure) ---------------- */
const NUM = {"0":"zero","1":"one","2":"two","3":"three","4":"four","5":"five","6":"six","7":"seven","8":"eight","9":"nine","10":"ten","11":"eleven","12":"twelve","20":"twenty"};
const CONTR = {"i'm":"i am","you're":"you are","we're":"we are","they're":"they are","he's":"he is","she's":"she is","it's":"it is","that's":"that is","there's":"there is","what's":"what is","let's":"let us","don't":"do not","doesn't":"does not","didn't":"did not","can't":"can not","cannot":"can not","won't":"will not","isn't":"is not","aren't":"are not","wasn't":"was not","weren't":"were not","haven't":"have not","hasn't":"has not","i've":"i have","we've":"we have","you've":"you have","i'll":"i will","you'll":"you will","we'll":"we will","i'd":"i would","couldn't":"could not","shouldn't":"should not","wouldn't":"would not"};
function norm(s) {
  return String(s).toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9'\s-]/g, " ").replace(/-/g, " ")
    .split(/\s+/).filter(Boolean).flatMap(w => (CONTR[w] || NUM[w] || w.replace(/^'+|'+$/g, "")).split(" ")).filter(Boolean);
}
function displayTokens(s) { return String(s).split(/\s+/).filter(Boolean); }
function compare(target, said, keyPhrases = []) {
  // align normalized target words vs said words (LCS), map back to display words
  const disp = displayTokens(target);
  const tw = [], owner = [];
  disp.forEach((d, i) => norm(d).forEach(n => { tw.push(n); owner.push(i); }));
  const sw = norm(said);
  const n = tw.length, m = sw.length, L = Array.from({length: n + 1}, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = tw[i] === sw[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const hit = new Array(n).fill(false), extra = []; let i = 0, j = 0;
  while (i < n && j < m) { if (tw[i] === sw[j]) { hit[i] = true; i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else { extra.push(sw[j]); j++; } }
  while (j < m) extra.push(sw[j++]);
  const dispOk = disp.map((_, k) => owner.every((o, idx) => o !== k || hit[idx]));
  const score = n ? hit.filter(Boolean).length / n : 0;
  const saidSet = " " + sw.join(" ") + " ";
  const keys = keyPhrases.map(k => ({k, ok: norm(k).length === 0 || saidSet.includes(" " + norm(k).join(" ") + " ")}));
  return {disp, dispOk, extra, score, keys, pass: score >= CFG.pass_threshold && keys.every(x => x.ok)};
}

/* ---------------- highlighting ---------------- */
function highlight(text, frags, cls) {
  const ranges = []; const low = text.toLowerCase();
  frags.filter(Boolean).forEach(f => {
    const idx = low.indexOf(f.toLowerCase());
    if (idx >= 0 && !ranges.some(r => idx < r[1] && idx + f.length > r[0])) ranges.push([idx, idx + f.length]);
  });
  ranges.sort((a, b) => a[0] - b[0]);
  let out = "", pos = 0;
  ranges.forEach(([a, b]) => { out += esc(text.slice(pos, a)) + `<mark class="${cls}">` + esc(text.slice(a, b)) + "</mark>"; pos = b; });
  return out + esc(text.slice(pos));
}

/* ---------------- tabs ---------------- */
document.querySelectorAll(".bottom button").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));
function showTab(name) {
  document.querySelectorAll(".bottom button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.id === "tab-" + name));
  if (name === "progress") renderProgress();
  if (name === "recap") renderRecap();
  window.scrollTo(0, 0);
}
function showStep(id) { ["speak", "feedback", "drill", "done"].forEach(s => $("#step-" + s).classList.toggle("hidden", s !== id)); window.scrollTo(0, 0); }

/* ---------------- step 1: speak ---------------- */
const SAMPLE = "Yesterday I go to the supermarket with my friend and we buy many apple. She don't like the vegetables there. I want to 点外卖 but my phone 没电了. Although it is far, but I very like that shop.";
const passageEl = $("#passage");
bindMic($("#mic-passage"), $("#mic-passage-state"), "en-US", "点我开始说",
  (fin, interim) => { passageEl.value = (fin + (interim ? " " + interim : "")).trim(); }, () => passageEl.value);
if (!speech.supported) { const w = $("#sr-warning"); w.textContent = "⚠️ 这个浏览器不支持语音识别。安卓请用 Chrome 打开这个链接；也可以直接打字。"; w.classList.remove("hidden"); }
$("#btn-sample").onclick = () => { passageEl.value = SAMPLE; };
$("#btn-clear").onclick = () => { passageEl.value = ""; };

let session = null;
$("#btn-analyze").onclick = async () => {
  const text = passageEl.value.trim();
  if (!text) return toast("先说一段或打一段英文");
  const btn = $("#btn-analyze"); btn.disabled = true; btn.textContent = "分析中……";
  try {
    const res = await api.analyze(text);
    session = {res, queue: [], passed: 0, attempts: 0, startedAt: Date.now()};
    session.rec = store.newSession("passage", {passage: text, sentences: res.sentences.length, engine: res.engine,
      issues: res.sentences.flatMap(s => s.issues.map(x => ({category: x.category, label: x.label, from: x.from, to: x.to})))});
    renderFeedback(res); showStep("feedback");
  } catch (e) { toast("分析失败：" + e.message); }
  finally { btn.disabled = false; btn.textContent = "分析这段话 →"; }
};

/* ---------------- step 2: feedback ---------------- */
function renderFeedback(res) {
  $("#fb-summary").innerHTML = esc(res.summary_zh) + (res.engine_note ? `<div class="hint">${esc(res.engine_note)}</div>` : "");
  $("#fb-list").innerHTML = res.sentences.map((s, i) => {
    const bad = s.issues.map(x => x.from), good = s.issues.map(x => x.to);
    return `<div class="card sent">
      <div class="orig"><span class="lbl">原句 ${i + 1}</span>${highlight(s.original, bad, "bad")}</div>
      ${s.ok ? `<div class="okbadge">✓ 这句没问题</div>` : `<div class="corr"><span class="lbl">更好</span>${highlight(s.corrected, good, "good")}
        <button class="ghost small" data-say="${esc(s.corrected)}">🔊</button></div>`}
      ${s.issues.map(x => `<div class="issue"><span class="tag ${x.category}">${CAT_ZH[x.category] || x.category}</span>
        <span class="ft">${esc(x.from)} → ${esc(x.to)}</span><div class="why">${esc(x.reason_zh || "")}${x.reason ? " · " + esc(x.reason) : ""}</div></div>`).join("")}
    </div>`;
  }).join("");
  $("#btn-start-drill").textContent = res.issue_count ? "开始跟读练习 →" : "直接跟读整段练流利度 →";
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-say]"); if (b) speak(b.dataset.say); });
$("#btn-back-speak").onclick = () => showStep("speak");

/* ---------------- step 3: drill ---------------- */
// Each item must pass `passes_to_master` times: pass 1 shows the text, later passes hide it (recall).
// A failed item goes to the back of the queue. Finally the whole corrected passage is read once.
function buildQueue(res) {
  const items = res.sentences.filter(s => s.issues.length).map(s => ({target: s.corrected, issues: s.issues, need: CFG.passes_to_master, got: 0, tries: 0}));
  if (res.sentences.length > 1 || !items.length) items.push({target: res.corrected_passage, issues: [], need: 1, got: 0, tries: 0, whole: true});
  return items;
}
$("#btn-start-drill").onclick = () => {
  const d = store.get();
  session.res.sentences.forEach(s => s.issues.forEach(x => { store.point(x, s.corrected).seen++; }));
  store.save();
  session.queue = buildQueue(session.res); session.total = session.queue.length; session.done = 0;
  startDrillItem(); showStep("drill");
};
function startReview(items, kind = "review") {
  session = {res: null, queue: items, total: items.length, done: 0, passed: 0, attempts: 0, review: true, startedAt: Date.now()};
  session.rec = store.newSession(kind, {passage: items.map(x => x.target).join(" "), sentences: items.length,
    issues: kind === "word" ? items.flatMap(x => x.issues.map(i => ({category: i.category, label: i.label, from: i.from, to: i.to}))) : []});
  showTab("practice"); startDrillItem(); showStep("drill");
}
let drillMic;
function keyPhrases(item) {
  const t = " " + norm(item.target).join(" ") + " ";
  return item.issues.filter(x => x.to && x.from !== x.to).map(x => x.to.replace(/[.,!?]/g, "").trim())
    .filter(k => norm(k).length && t.includes(" " + norm(k).join(" ") + " "));
}
function startDrillItem() {
  const item = session.queue[0];
  if (!item) return finishSession();
  if (drillMic && drillMic.on) drillMic.stop();
  const hide = item.got >= 1 && !item.whole;
  $("#drill-mode").textContent = item.whole ? "整段通读" : hide ? `凭记忆说（第 ${item.got + 1}/${item.need} 遍）` : `看着读（第 ${item.got + 1}/${item.need} 遍）`;
  $("#drill-target").innerHTML = highlight(item.target, keyPhrases(item), "good");
  $("#drill-target").classList.toggle("blur", hide); $("#drill-target").classList.toggle("small-target", !!item.whole);
  $("#btn-peek").classList.toggle("hidden", !hide);
  const keys = item.issues.filter(x => x.from !== x.to);
  $("#drill-keys").innerHTML = keys.length ? "重点：" + keys.map(x => `<span class="tag ${x.category}">${CAT_ZH[x.category]}</span>${esc(x.to)}`).join("　") : "";
  $("#drill-result").innerHTML = ""; $("#drill-typed").value = "";
  $("#btn-check").classList.remove("hidden"); $("#btn-next").classList.add("hidden");
  $("#drill-progress").innerHTML = Array.from({length: session.total}, (_, i) => `<span class="dot ${i < session.done ? "done" : i === session.done ? "cur" : ""}"></span>`).join("");
}
$("#btn-peek").onclick = () => { $("#drill-target").classList.remove("blur"); const it = session.queue[0]; if (it) it.peeked = true; };
$("#btn-listen").onclick = () => session.queue[0] && speak(session.queue[0].target);
drillMic = bindMic($("#mic-drill"), $("#mic-drill-state"), "en-US", "点我跟读",
  (fin, interim) => { $("#drill-typed").value = (fin + (interim ? " " + interim : "")).trim(); });
// auto-check when the recognizer stops with text
$("#mic-drill").addEventListener("click", () => { setTimeout(() => { if (!drillMic.on && $("#drill-typed").value.trim()) check(); }, 400); });
$("#btn-check").onclick = check;
$("#drill-typed").addEventListener("keydown", e => { if (e.key === "Enter") check(); });
function check() {
  const item = session.queue[0]; if (!item) return;
  if (drillMic.on) drillMic.stop();
  const said = $("#drill-typed").value.trim();
  if (!said) return toast("先点麦克风跟读一遍（或者打字）");
  const r = compare(item.target, said, keyPhrases(item));
  item.tries++; session.attempts++;
  const pass = r.pass && !(item.peeked && item.got >= 1);
  $("#drill-result").innerHTML = `<div class="words">${r.disp.map((w, i) => `<span class="${r.dispOk[i] ? "w-ok" : "w-miss"}">${esc(w)}</span>`).join("")}
     ${r.extra.length ? r.extra.map(w => `<span class="w-extra">${esc(w)}</span>`).join("") : ""}</div>
     <div class="score">${pass ? `<span class="pass">✓ 过关</span>` : `<span class="fail">✗ 再来一次</span>`} · 匹配 ${Math.round(r.score * 100)}%（要求 ${Math.round(CFG.pass_threshold * 100)}%）
     ${r.keys.filter(k => !k.ok).length ? `<br>漏了重点：<b>${r.keys.filter(k => !k.ok).map(k => esc(k.k)).join("、")}</b>` : ""}
     ${item.peeked && item.got >= 1 && r.pass ? "<br>偷看了这次不算，下次凭记忆说～" : ""}</div>
     <div class="heard">我听到的：${esc(said)}</div>`;
  $("#drill-target").classList.remove("blur");
  // progress tracking per point
  item.issues.forEach(x => { const p = store.point(x, item.target); if (pass) p.passes++; else p.fails++; p.last = Date.now(); });
  store.save();
  if (pass) { item.got++; session.passed++; }
  if (session.rec) {
    const rec = session.rec; let d = rec.drilled.find(x => x.target === item.target);
    if (!d) rec.drilled.push(d = {target: item.target, labels: item.issues.map(x => x.label), attempts: 0, passes: 0, fails: 0, passed: false});
    d.attempts++; rec.attempts++;
    if (pass) { d.passes++; rec.passes++; if (item.got >= item.need) d.passed = true; } else { d.fails++; rec.fails++; }
  }
  $("#btn-check").classList.add("hidden"); $("#btn-next").classList.remove("hidden");
  $("#btn-next").textContent = pass ? (item.got >= item.need ? "下一句 →" : "再说一遍（凭记忆）→") : "再试一次 ↻";
  $("#btn-next").onclick = () => {
    item.peeked = false;
    if (pass && item.got >= item.need) { session.queue.shift(); session.done++; }
    else if (!pass && item.tries >= 3 && session.queue.length > 1) { session.queue.push(session.queue.shift()); item.tries = 0; toast("这句先放到后面，等会儿再来"); }
    startDrillItem();
  };
}
$("#btn-skip").onclick = () => { const it = session.queue.shift(); if (it) { session.done++; } startDrillItem(); };
function finishSession() {
  const d = store.get();
  if (session.rec) { session.rec.completed = true; session.rec.endedAt = Date.now(); }
  store.save();
  $("#done-summary").innerHTML = `一共跟读 ${session.attempts} 次，过关 ${session.passed} 次。练过的点已经记进「进度」里，下次可以一键复习薄弱项。`;
  const passage = session.res ? session.res.corrected_passage : session.queue.map(x => x.target).join(" ");
  $("#done-passage").textContent = passage || "（复习完成）"; $("#btn-listen-all").onclick = () => speak(passage);
  showStep("done");
}
$("#btn-new").onclick = () => { passageEl.value = ""; showStep("speak"); };
$("#btn-to-progress").onclick = () => showTab("progress");

/* ---------------- words tab (中文 → English) ---------------- */
const wordsInput = $("#words-input");
bindMic($("#mic-words"), $("#mic-words-state"), "zh-CN", "点我说中文",
  (fin, interim) => { wordsInput.value = (fin + (interim ? interim : "")).trim(); });
$("#mic-words").addEventListener("click", () => setTimeout(() => { if (!$("#mic-words").classList.contains("on") && wordsInput.value.trim()) suggest(); }, 400));
$("#btn-suggest").onclick = suggest;
wordsInput.addEventListener("keydown", e => { if (e.key === "Enter") suggest(); });
let lastWords = [];
async function suggest() {
  const t = wordsInput.value.trim(); if (!t) return toast("说或打一个中文词");
  try {
    const r = await api.suggest(t); lastWords = r.items || [];
    $("#words-list").innerHTML = lastWords.length ? lastWords.map((w, i) => `<div class="card wcard">
      <div class="zh">${esc(w.zh)}</div>
      ${w.options.length ? `<div class="chips">${w.options.map((o, k) => `<span class="chip ${k ? "" : "best"}" data-say="${esc(o)}">${esc(o)}</span>`).join("")}</div>
      ${w.example ? `<div class="ex">“${esc(w.example)}” <button class="ghost small" data-say="${esc(w.example)}">🔊</button></div>` : ""}
      ${w.note ? `<div class="note">💡 ${esc(w.note)}</div>` : ""}
      <div class="row"><button class="ghost small" data-add="${i}">＋ 加入进度</button><button class="primary small" data-drill="${i}">马上练这句</button></div>`
      : `<div class="note">${esc(w.note || "暂时没有建议")}</div>`}</div>`).join("") : `<div class="card">没认出中文词，换个说法试试。</div>`;
  } catch (e) { toast("查询失败：" + e.message); }
}
function wordIssue(w) { return {category: "zh2en", label: `${w.zh} → ${w.options[0]}`, from: w.zh, to: w.options[0].replace(/\s*\(.*\)$/, ""), reason_zh: w.note || "", reason: ""}; }
$("#words-list").addEventListener("click", (e) => {
  const a = e.target.closest("[data-add]"), dr = e.target.closest("[data-drill]");
  if (a) { const w = lastWords[+a.dataset.add]; store.point(wordIssue(w), w.example || w.options[0]).seen++;
    store.get().wordsAdded.push({at: Date.now(), zh: w.zh, en: w.options[0]}); store.save(); toast(`已加入：${w.zh} → ${w.options[0]}`); }
  if (dr) { const w = lastWords[+dr.dataset.drill]; const iss = wordIssue(w); store.point(iss, w.example).seen++;
    store.get().wordsAdded.push({at: Date.now(), zh: w.zh, en: w.options[0]}); store.save();
    startReview([{target: w.example || w.options[0], issues: [iss], need: CFG.passes_to_master, got: 0, tries: 0}], "word"); }
});

/* ---------------- progress tab ---------------- */
function renderProgress() {
  const d = store.get(), pts = Object.values(d.points);
  const mastered = pts.filter(p => store.strength(p) >= 1).length;
  $("#stats").innerHTML = `<div class="stat"><b>${d.sessions.length}</b><span>练习次数</span></div>
    <div class="stat"><b>${pts.length}</b><span>知识点/词</span></div><div class="stat"><b>${mastered}</b><span>已掌握</span></div>`;
  if (!pts.length) { $("#points").innerHTML = `<div class="card hint">还没有记录。去「练习」说一段话，问题点会自动记到这里。</div>`; return; }
  const byCat = {};
  pts.forEach(p => (byCat[p.category] = byCat[p.category] || []).push(p));
  $("#points").innerHTML = Object.entries(byCat).map(([c, list]) => `<div class="cat-h">${CAT_ZH[c] || c}（${list.length}）</div>` +
    list.sort((a, b) => store.strength(a) - store.strength(b)).map(p => {
      const s = store.strength(p);
      return `<div class="card point"><div class="head"><span class="name"><span class="tag ${p.category}">${CAT_ZH[p.category] || ""}</span>${esc(p.label)}</span>
        <span class="hint">${s >= 1 ? "✅ 掌握" : `✓${p.passes} ✗${p.fails}`}</span></div>
        <div class="bar"><i style="width:${Math.round(s * 100)}%"></i></div>
        ${p.fixes[0] ? `<div class="ex">${esc(p.fixes[0])}</div>` : ""}${p.examples[0] ? `<div class="ex">例：${esc(p.examples[0])}</div>` : ""}</div>`;
    }).join("")).join("");
}
$("#btn-review").onclick = () => {
  const pts = Object.values(store.get().points).filter(p => p.examples.length).sort((a, b) => store.strength(a) - store.strength(b) || a.last - b.last).slice(0, 5);
  if (!pts.length) return toast("还没有可以复习的点，先去练一段吧");
  startReview(pts.map(p => ({target: p.examples[0], issues: [{category: p.category, label: p.label, from: (p.fixes[0] || "").split(" → ")[0], to: (p.fixes[0] || "").split(" → ")[1] || "", reason_zh: ""}], need: CFG.passes_to_master, got: 0, tries: 0})));
};
$("#btn-export").onclick = () => { const b = new Blob([JSON.stringify(store.get(), null, 2)], {type: "application/json"}); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "english-practice-progress.json"; a.click(); };
$("#btn-reset").onclick = () => { if (confirm("确定清空所有进度？")) { localStorage.removeItem(KEY); store._d = null; renderProgress(); } };

/* ---------------- weekly recap (周报) ---------------- */
function weeksWithData() {
  const d = store.get(), keys = new Set([EPRecap.isoWeek(Date.now()).key]);
  d.sessions.forEach(s => s.at && keys.add(EPRecap.isoWeek(s.at).key));
  d.wordsAdded.forEach(w => keys.add(EPRecap.isoWeek(w.at).key));
  return [...keys].sort().reverse();
}
async function generateRecap(weekKey) {
  const st = EPRecap.weekStats(store.get(), weekKey);
  let text = st.sessions ? await api.recapAI(st) : null, source = text ? "AI" : "模板";
  if (!text) text = EPRecap.templateRecap(st);
  const r = {week: weekKey, text, source, stats: st, generatedAt: Date.now()};
  store.get().recaps[weekKey] = r; store.save(); return r;
}
function renderRecap() {
  const d = store.get(), curKey = EPRecap.isoWeek(Date.now()).key;
  $("#recap-list").innerHTML = weeksWithData().map(k => {
    const saved = d.recaps[k];
    const st = EPRecap.weekStats(d, k);
    const text = saved ? saved.text : EPRecap.templateRecap(st);
    const when = saved ? `${saved.source}生成于 ${new Date(saved.generatedAt).toLocaleString("zh-CN", {month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"})}` : "实时预览（未保存）";
    return `<div class="card recap ${k === curKey ? "current" : ""}" data-week="${k}">
      <div class="wk"><b>${k === curKey ? "本周 · " : ""}${esc(k)}</b><span class="src">${esc(st.range)}</span></div>
      <div class="nums"><div><b>${st.days}</b><span>练习天数</span></div><div><b>${st.sessions}</b><span>练习次数</span></div>
        <div><b>${st.issues}</b><span>发现问题</span></div><div><b>${st.passRate}%</b><span>跟读过关率</span></div>
        <div><b>${st.sentences}</b><span>句子</span></div><div><b>${st.attempts}</b><span>跟读次数</span></div>
        <div><b>${st.words.length}</b><span>新词</span></div><div><b>${st.improved.length}</b><span>进步点</span></div></div>
      <div class="text">${esc(text)}</div>
      <div class="lists">${st.recurring.length ? "🔁 反复：" + st.recurring.map(x => esc(x.name) + "×" + x.n).join("、") + "<br>" : ""}${st.improved.length ? "📈 进步：" + st.improved.map(x => esc(x.name)).join("、") : ""}</div>
      <div class="row"><span class="src grow">${when}</span><button class="ghost small" data-regen="${k}">${saved ? "重新生成" : "生成并保存"}</button></div>
    </div>`;
  }).join("");
}
$("#btn-recap-now").onclick = async () => { const r = await generateRecap(EPRecap.isoWeek(Date.now()).key); renderRecap(); toast(`本周周报已生成（${r.source}）`); };
$("#recap-list").addEventListener("click", async (e) => { const b = e.target.closest("[data-regen]"); if (b) { await generateRecap(b.dataset.regen); renderRecap(); toast("已生成"); } });

/* ---------------- boot ---------------- */
api.health().then(h => { if (h) CFG = {...CFG, pass_threshold: h.pass_threshold, passes_to_master: h.passes_to_master}; updateEngineBadge(); });
if ("speechSynthesis" in window) speechSynthesis.getVoices();
window.__ep = {compare, norm, store, api, generateRecap, renderRecap}; // for tests
})();
