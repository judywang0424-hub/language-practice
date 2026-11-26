'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hasKanji = s => /[\u4e00-\u9fff々]/.test(s);
const STORE = 'jpMeetingPractice.v1';
let TH = { sentence: 0.85, vocab: 0.8, passes_to_master: 2 };
let BACKEND = false, SERVER_AI = false;
const AIKEY = 'jpMeetingPractice.ai';
const phoneAi = () => { try { const c = JSON.parse(localStorage.getItem(AIKEY)); return c && c.apiKey ? c : null; } catch (_) { return null; } };
let analysis = null, session = null, queue = [], qi = 0, cur = null;

// ---------- storage ----------
function loadStore() { try { return JSON.parse(localStorage.getItem(STORE)) || { items: {}, sessions: [] }; } catch (_) { return { items: {}, sessions: [] }; } }
function saveStore(s) { localStorage.setItem(STORE, JSON.stringify(s)); }
function toast(msg, ms = 2500) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms); }

// ---------- navigation ----------
function show(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === id));
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === id || (b.dataset.v === 'vInput' && ['vResult', 'vDrill', 'vSummary'].includes(id))));
  if (id === 'vProgress') renderProgress();
  window.scrollTo(0, 0);
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  if (b.dataset.v === 'vInput' && analysis && $('#vDrill').classList.contains('active')) return show('vDrill');
  show(b.dataset.v);
});

// ---------- speech recognition ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function makeRec(lang, { continuous, onInterim, onFinal, onEnd }) {
  if (!SR) { toast('这个浏览器不支持语音识别，请用安卓 Chrome，或直接打字。', 4000); return null; }
  const r = new SR(); r.lang = lang; r.interimResults = true; r.continuous = !!continuous; r.maxAlternatives = 5;
  r.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) onFinal && onFinal([...res].map(a => a.transcript));
      else interim += res[0].transcript;
    }
    onInterim && onInterim(interim);
  };
  r.onerror = e => { if (e.error === 'not-allowed') toast('没有麦克风权限：请在 Chrome 网站设置里允许麦克风。', 5000); else if (e.error !== 'no-speech' && e.error !== 'aborted') toast('语音识别出错：' + e.error); };
  r.onend = () => onEnd && onEnd();
  return r;
}

// Chinese passage input (continuous, auto-restart while recording)
let zhRec = null, zhOn = false;
$('#zhMic').onclick = () => {
  if (zhOn) { zhOn = false; zhRec && zhRec.stop(); return; }
  zhRec = makeRec('zh-CN', {
    continuous: true,
    onInterim: t => $('#zhInterim').textContent = t,
    onFinal: alts => { const ta = $('#zhText'); let t = alts[0].trim(); if (t && !/[。！？!?，,]$/.test(t)) t += '。'; ta.value += t; $('#zhInterim').textContent = ''; },
    onEnd: () => { if (zhOn) { try { zhRec.start(); } catch (_) { zhOn = false; } } updZhBtn(); },
  });
  if (!zhRec) return;
  zhOn = true; zhRec.start(); updZhBtn();
};
function updZhBtn() { const b = $('#zhMic'); b.classList.toggle('rec', zhOn); b.textContent = zhOn ? '⏹ 正在听…说完点这里停止' : '🎤 点击开始说中文'; }
$('#btnClear').onclick = () => { $('#zhText').value = ''; };

// ---------- TTS ----------
let jaVoice = null;
function pickVoice() { const vs = speechSynthesis.getVoices(); jaVoice = vs.find(v => /ja[-_]JP/i.test(v.lang) && /google/i.test(v.name)) || vs.find(v => /^ja/i.test(v.lang)) || null; }
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function speak(text) {
  if (!('speechSynthesis' in window)) return toast('浏览器不支持朗读');
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = 'ja-JP'; if (jaVoice) u.voice = jaVoice;
  u.rate = Number($('#rate').value || 0.9);
  speechSynthesis.speak(u);
  if (!jaVoice && speechSynthesis.getVoices().length) toast('没找到日语语音包，可能读不出来：系统设置→文字转语音→安装日语。', 4000);
}

// ---------- status & samples ----------
async function init() {
  try {
    const r = await fetch('api/status');
    const s = await r.json();
    BACKEND = true; SERVER_AI = !!s.ai; TH = s.thresholds || TH;
    $('#helpStatus').textContent = s.ai ? `服务器 AI：${s.provider} · ${s.model}` : '服务器未配置 AI 密钥。';
  } catch (_) { BACKEND = false; $('#helpStatus').textContent = '静态模式（无服务器）：练习记录只存在本机。'; }
  updPill();
  const pa = phoneAi() || {};
  $('#aiBase').value = pa.baseUrl || ''; $('#aiModel').value = pa.model || ''; $('#aiKey').value = '';
  $('#aiKey').placeholder = pa.apiKey ? '已保存（重新输入可替换）' : 'API 密钥';
  let samples = [];
  try { samples = BACKEND ? (await (await fetch('api/samples')).json()).samples : window.Engine.SAMPLES; } catch (_) { samples = window.Engine ? window.Engine.SAMPLES : []; }
  $('#samples').innerHTML = samples.map((s, i) => `<button data-i="${i}"><b>${esc(s.title)}</b><br><span class="muted">${esc(s.zh.slice(0, 38))}…</span></button>`).join('');
  $('#samples').querySelectorAll('button').forEach(b => b.onclick = () => { $('#zhText').value = samples[b.dataset.i].zh; toast('已填入示例，点“生成日语”'); });
}
function updPill() {
  const ai = SERVER_AI || !!phoneAi();
  const p = $('#aiPill'); p.textContent = ai ? 'AI 已连接' : '离线短语库'; p.className = 'pill ' + (ai ? 'ai' : 'off');
}
$('#aiSave').onclick = () => {
  const old = phoneAi() || {};
  const c = { baseUrl: ($('#aiBase').value.trim() || 'https://api.openai.com/v1').replace(/\/+$/, ''), model: $('#aiModel').value.trim() || 'gpt-4o-mini', apiKey: $('#aiKey').value.trim() || old.apiKey || '' };
  if (!c.apiKey) return toast('请填写密钥');
  localStorage.setItem(AIKEY, JSON.stringify(c)); $('#aiKey').value = ''; $('#aiKey').placeholder = '已保存（重新输入可替换）'; updPill(); toast('已保存到本机');
};
$('#aiClear').onclick = () => { localStorage.removeItem(AIKEY); $('#aiBase').value = $('#aiModel').value = ''; $('#aiKey').placeholder = 'API 密钥'; updPill(); toast('已清除'); };

async function runAnalysis(text) {
  const pa = phoneAi();
  if (BACKEND && (SERVER_AI || !pa)) {
    const r = await fetch('api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const d = await r.json(); if (!r.ok) throw new Error(d.error || r.status); return d;
  }
  let d, warning = null;
  if (pa) { try { d = await window.Engine.analyzeWithConfig(text, pa); } catch (e) { warning = 'AI 调用失败（' + e.message + '），已改用离线短语库。'; } }
  if (!d) { d = window.Engine.analyzeOffline(text); if (!warning) warning = '还没配置 AI 密钥：现在用的是离线半导体会议短语库，只能匹配常见会议句。'; }
  d.source_zh = text; d.warning = warning; return d;
}

// ---------- analyze ----------
$('#btnAnalyze').onclick = async () => {
  if (zhOn) { zhOn = false; zhRec && zhRec.stop(); }
  const text = $('#zhText').value.trim();
  if (!text) return toast('先说或输入一段中文');
  const b = $('#btnAnalyze'); b.disabled = true; b.innerHTML = '<span class="spinner"></span> 正在生成…';
  try {
    const d = await runAnalysis(text);
    if (!d.sentences.length) { toast('这段话没能匹配到会议句子。离线模式只认识常见会议内容，可以先用示例试试。', 5000); }
    analysis = d; renderResult(); show('vResult');
  } catch (e) { toast('生成失败：' + e.message, 4000); }
  finally { b.disabled = false; b.textContent = '生成日语 →'; }
};

function markup(ja, vocab, grammar) {
  const n = ja.length, vAt = new Array(n).fill(-1), gAt = new Array(n).fill(false);
  const vs = vocab.map((v, i) => ({ ...v, i })).sort((a, b) => b.ja.length - a.ja.length);
  for (const v of vs) {
    let from = 0, k;
    while (v.ja && (k = ja.indexOf(v.ja, from)) >= 0) {
      if (vAt.slice(k, k + v.ja.length).every(x => x < 0)) for (let j = k; j < k + v.ja.length; j++) vAt[j] = v.i;
      from = k + v.ja.length;
    }
  }
  for (const g of grammar) { if (!g.match) continue; let from = 0, k; while ((k = ja.indexOf(g.match, from)) >= 0) { for (let j = k; j < k + g.match.length; j++) gAt[j] = true; from = k + g.match.length; } }
  let out = '', i = 0;
  while (i < n) {
    if (vAt[i] >= 0) {
      const vi = vAt[i]; let j = i; while (j < n && vAt[j] === vi && j - i < vocab[vi].ja.length) j++;
      const t = ja.slice(i, j), v = vocab[vi], g = gAt.slice(i, j).some(Boolean) ? ' g' : '';
      out += hasKanji(t) && v.kana ? `<ruby class="v${g}">${esc(t)}<rt>${esc(v.kana)}</rt></ruby>` : `<span class="v${g}">${esc(t)}</span>`;
      i = j;
    } else {
      let j = i; const g = gAt[i]; while (j < n && vAt[j] < 0 && gAt[j] === g) j++;
      out += g ? `<span class="g">${esc(ja.slice(i, j))}</span>` : esc(ja.slice(i, j));
      i = j;
    }
  }
  return out;
}

function renderResult() {
  const d = analysis;
  $('#warn').classList.toggle('hidden', !d.warning); $('#warn').textContent = d.warning || '';
  $('#sentences').innerHTML = d.sentences.map((s, i) => `
    <div class="sent">
      <div class="zh">${esc(s.zh)}${s.confidence === 'approx' ? '<span class="tag">近似匹配</span>' : ''}</div>
      <div class="ja">${markup(s.ja, d.vocab, d.grammar)} <button class="play" data-i="${i}">🔊</button></div>
      <div class="kana">${esc(s.kana)}</div>
      <div class="romaji">${esc(Kana.toRomaji(s.kana))}</div>
    </div>`).join('') || '<p class="muted">没有生成句子。</p>';
  $('#sentences').querySelectorAll('.play').forEach(b => b.onclick = () => speak(d.sentences[b.dataset.i].ja));
  applyToggles();
  $('#unmatched').innerHTML = (d.unmatched || []).length ? `<div class="warn">这些句子离线短语库还翻译不了（需要配置 AI）：<br>${d.unmatched.map(esc).join('<br>')}</div>` : '';
  $('#tips').innerHTML = (d.tips || []).map(t => `<li>${esc(t)}</li>`).join('');
  $('#vCount').textContent = `(${d.vocab.length})`; $('#gCount').textContent = `(${d.grammar.length})`;
  $('#vocabList').innerHTML = d.vocab.map((v, i) => `<div class="item v"><div class="h"><span class="t">${esc(v.ja)}</span><button class="play" data-v="${i}">🔊</button></div>
    <div>${esc(v.kana)} · <span class="muted">${esc(Kana.toRomaji(v.kana))}</span></div><div>${esc(v.zh)}${v.note ? ' — <span class="muted">' + esc(v.note) + '</span>' : ''}</div></div>`).join('');
  $('#grammarList').innerHTML = d.grammar.map((g, i) => `<div class="item g"><div class="h"><span class="t">${esc(g.pattern)}</span>${g.example_ja ? `<button class="play" data-g="${i}">🔊</button>` : ''}</div>
    <div>${esc(g.zh)}</div>${g.example_ja ? `<div class="ex">例：${esc(g.example_ja)}<br><span class="muted">${esc(g.example_kana)}　${esc(g.example_zh)}</span></div>` : ''}</div>`).join('');
  $('#vocabList').querySelectorAll('.play').forEach(b => b.onclick = () => speak(d.vocab[b.dataset.v].ja));
  $('#grammarList').querySelectorAll('.play').forEach(b => b.onclick = () => speak(d.grammar[b.dataset.g].example_ja));
}
function applyToggles() {
  document.querySelectorAll('.sent .kana').forEach(e => e.classList.toggle('hidden', !$('#tKana').checked));
  document.querySelectorAll('.sent .romaji').forEach(e => e.classList.toggle('hidden', !$('#tRomaji').checked));
}
$('#tKana').onchange = applyToggles; $('#tRomaji').onchange = applyToggles;
$('#playAll').onclick = () => analysis && speak(analysis.sentences.map(s => s.ja).join(''));
$('#btnBack').onclick = () => show('vInput');

// ---------- drill ----------
function buildQueue(d) {
  const q = [], usedSent = new Set();
  for (const v of d.vocab) q.push({ type: 'vocab', cue: v.zh, ja: v.ja, kana: v.kana, zh: v.zh, th: TH.vocab });
  for (const g of d.grammar) {
    const si = d.sentences.findIndex(s => g.match && s.ja.includes(g.match));
    if (si >= 0 && !usedSent.has(si)) { usedSent.add(si); const s = d.sentences[si]; q.push({ type: 'grammar', cue: s.zh, pattern: g.pattern, ja: s.ja, kana: s.kana, zh: s.zh, key: 'grammar:' + g.pattern, th: TH.sentence }); }
    else if (g.example_ja) q.push({ type: 'grammar', cue: g.example_zh, pattern: g.pattern, ja: g.example_ja, kana: g.example_kana, zh: g.example_zh, key: 'grammar:' + g.pattern, th: TH.sentence });
  }
  d.sentences.forEach((s, i) => { if (!usedSent.has(i)) q.push({ type: 'sentence', cue: s.zh, ja: s.ja, kana: s.kana, zh: s.zh, th: TH.sentence }); });
  if (d.sentences.length > 1) q.push({ type: 'retell', cue: d.sentences.map(s => s.zh).join(''), ja: d.sentences.map(s => s.ja).join(''), kana: d.sentences.map(s => s.kana).join(''), zh: d.source_zh, th: 0.8 });
  return q.map(x => ({ ...x, attempts: 0, best: 0, passed: false, requeued: false }));
}
function startDrill(q, source) {
  if (!q.length) return toast('没有可练的项目');
  queue = q; qi = 0;
  session = { id: Date.now().toString(36), started: new Date().toISOString(), lang: 'ja', mode: analysis?.mode || 'review', source_zh: source || '', sentences_ja: analysis ? analysis.sentences.map(s => s.ja) : [], items: [] };
  show('vDrill'); renderItem();
}
$('#btnDrill').onclick = () => startDrill(buildQueue(analysis), analysis.source_zh);

const TYPE = { vocab: ['词汇', ''], grammar: ['语法', 'g'], sentence: ['整句', 's'], retell: ['整段复述', 'r'] };
let hintLevel = 0;
function renderItem() {
  cur = queue[qi]; hintLevel = 0;
  const [label, cls] = TYPE[cur.type];
  $('#dType').textContent = label; $('#dType').className = 'badge ' + cls;
  $('#dPos').textContent = `${qi + 1} / ${queue.length}`;
  $('#dBar').style.width = (qi / queue.length * 100) + '%';
  $('#dCue').textContent = cur.cue;
  $('#dHintPattern').textContent = cur.type === 'grammar' ? '要用到的句型：' + cur.pattern : cur.type === 'vocab' ? '说出这个词（单词即可）' : cur.type === 'retell' ? '把整段用日语说一遍' : '';
  $('#dHint').textContent = ''; $('#dTyped').value = ''; $('#dInterim').textContent = '';
  $('#dResult').classList.add('hidden'); $('#dNext').disabled = true; $('#dSkip').textContent = '跳过';
}
$('#dHintBtn').onclick = () => {
  hintLevel++;
  if (hintLevel === 1) $('#dHint').textContent = '开头：' + cur.kana.slice(0, Math.max(2, Math.ceil(cur.kana.length * 0.3))) + '…';
  else if (hintLevel === 2) $('#dHint').textContent = cur.kana;
  else $('#dHint').textContent = cur.ja + '（' + Kana.toRomaji(cur.kana) + '）';
};
$('#dListen').onclick = () => speak(cur.ja);

let jaRec = null, jaOn = false, jaBuf = [], jaKeep = false;
$('#dMic').onclick = () => {
  if (jaOn) { jaKeep = false; jaRec && jaRec.stop(); return; }
  jaBuf = [];
  const long = cur.type === 'retell' || cur.type === 'sentence' && cur.ja.length > 40;
  jaKeep = long; // long passages: keep listening across pauses until the user taps stop
  jaRec = makeRec('ja-JP', {
    continuous: long,
    onInterim: t => $('#dInterim').textContent = (long ? jaBuf.map(a => a[0]).join('') : '') + t,
    onFinal: alts => { jaBuf.push(alts); if (!long) jaRec.stop(); },
    onEnd: () => {
      if (jaKeep) { try { jaRec.start(); return; } catch (_) { jaKeep = false; } }
      jaOn = false; updJaBtn();
      if (jaBuf.length) evaluate(long ? [jaBuf.map(a => a[0]).join('')] : jaBuf.flat()); else $('#dInterim').textContent = '没听到声音，再试一次。';
    },
  });
  if (!jaRec) return;
  speechSynthesis && speechSynthesis.cancel();
  jaOn = true; jaRec.start(); updJaBtn();
};
function updJaBtn() { const b = $('#dMic'); b.classList.toggle('rec', jaOn); b.textContent = jaOn ? (jaKeep ? '⏹ 正在听…整段说完点这里' : '⏹ 正在听…') : '🎤 点击用日语说'; }
$('#dCheck').onclick = () => { const t = $('#dTyped').value.trim(); if (t) evaluate([t]); };

function evaluate(alts) {
  let best = null, said = '';
  for (const a of alts) { const r = Kana.compare(a, cur.ja, cur.kana); if (!best || r.score > best.score) { best = r; said = a; } }
  cur.attempts++; cur.best = Math.max(cur.best, best.score);
  const pass = best.score >= cur.th;
  if (pass) cur.passed = true;
  const pct = Math.round(best.score * 100);
  const diff = [...best.target].map((c, i) => `<span class="${best.hit.has(i) ? 'hit' : 'miss'}">${esc(c)}</span>`).join('');
  $('#dResult').innerHTML = `<div class="score ${pass ? 'ok' : 'bad'}">${pass ? '✅ 通过' : '❌ 还差一点'} · ${pct}%</div>
    <div class="said">你说的：${esc(said)}</div>
    <div class="diff">${diff}</div>
    <div class="muted">绿色=说对　红色=漏掉或说错${best.view === 'kana' ? '（按读音对比）' : ''}</div>
    <div style="margin-top:6px">标准：${esc(cur.ja)} <button class="play" id="dPlay2">🔊</button><br><span class="muted">${esc(cur.kana)}</span></div>
    ${pass ? '' : '<div class="muted" style="margin-top:6px">听一遍标准说法，再点麦克风重说。</div>'}`;
  $('#dResult').classList.remove('hidden');
  $('#dPlay2').onclick = () => speak(cur.ja);
  $('#dNext').disabled = !pass;
  $('#dSkip').textContent = pass ? '跳过' : (cur.attempts >= 3 ? '先跳过（稍后再练）' : '跳过');
  $('#dInterim').textContent = '';
  if (pass) toast('很好！' + (cur.attempts > 1 ? `第 ${cur.attempts} 次通过` : '一次通过'));
}

function recordItem(it) {
  const st = loadStore(), key = it.key || (it.type + ':' + it.ja);
  if (it.type === 'retell') return;
  const o = st.items[key] || { type: it.type === 'sentence' ? 'sentence' : it.type, ja: it.ja, kana: it.kana, zh: it.zh, cue: it.cue, pattern: it.pattern, attempts: 0, passes: 0, best: 0, first: new Date().toISOString() };
  o.attempts += it.attempts; o.best = Math.max(o.best, it.best); o.last = new Date().toISOString(); o.lastScore = it.best;
  if (it.passed) o.passes++; o.mastered = o.passes >= (TH.passes_to_master || 2);
  if (it.type === 'grammar' && !o.example_ja) { o.ja = it.ja; o.kana = it.kana; o.cue = it.cue; }
  st.items[key] = o; saveStore(st);
}
function advance() {
  const it = queue[qi];
  if (!it) return;
  if (it.attempts) {
    session.items.push({ type: it.type, ja: it.ja, zh: it.zh, pattern: it.pattern, attempts: it.attempts, best: +it.best.toFixed(2), passed: it.passed });
    recordItem(it);
  }
  if (!it.passed && !it.requeued && it.type !== 'retell') { queue.push({ ...it, attempts: 0, best: 0, requeued: true }); }
  qi++;
  if (qi >= queue.length) finish(); else renderItem();
}
$('#dNext').onclick = advance;
$('#dSkip').onclick = advance;
$('#dQuit').onclick = () => { if (confirm('结束本轮练习？已练的会保存。')) finish(); };

async function finish() {
  session.ended = new Date().toISOString();
  const items = session.items, passed = items.filter(i => i.passed).length;
  const st = loadStore(); st.sessions.push({ ...session }); if (st.sessions.length > 200) st.sessions = st.sessions.slice(-200); saveStore(st);
  if (BACKEND) try { await fetch('api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(session) }); } catch (_) {}
  const weak = items.filter(i => !i.passed);
  const retell = items.filter(i => i.type === 'retell').pop();
  $('#sumBody').innerHTML = `<p>练了 <b>${items.length}</b> 项，通过 <b>${passed}</b> 项。${retell ? `整段复述最好成绩 <b>${Math.round(retell.best * 100)}%</b>。` : ''}</p>
    ${weak.length ? `<p class="muted">还要加强：</p><ul>${weak.map(w => `<li>${esc(w.pattern || w.ja)} — ${esc(w.zh)}</li>`).join('')}</ul>` : '<p>全部通过，太棒了！</p>'}`;
  $('#dBar').style.width = '100%';
  show('vSummary');
}
$('#sumAgain').onclick = () => analysis ? startDrill(buildQueue(analysis), analysis.source_zh) : show('vInput');
$('#sumNew').onclick = () => { $('#zhText').value = ''; show('vInput'); };

// ---------- progress ----------
function renderProgress() {
  const st = loadStore(), items = Object.values(st.items);
  const vocab = items.filter(i => i.type === 'vocab'), gram = items.filter(i => i.type === 'grammar'), sent = items.filter(i => i.type === 'sentence');
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const wk = st.sessions.filter(s => s.started >= weekAgo);
  const m = a => a.filter(i => i.mastered).length;
  $('#stats').innerHTML = `
    <div class="stat"><b>${m(vocab)} / ${vocab.length}</b>词汇已掌握</div>
    <div class="stat"><b>${m(gram)} / ${gram.length}</b>句型已掌握</div>
    <div class="stat"><b>${m(sent)} / ${sent.length}</b>整句已掌握</div>
    <div class="stat"><b>${wk.length}</b>最近 7 天练习次数</div>`;
  const row = i => `<div class="prow"><div><span class="k">${esc(i.pattern || i.ja)}</span> <span class="muted">${esc(i.type === 'vocab' ? i.kana + ' · ' + i.zh : i.zh || '')}</span>
     <div class="bar"><i style="width:${Math.round((i.best || 0) * 100)}%"></i></div></div>
     <div style="text-align:right;min-width:64px">${i.mastered ? '<span class="m">✔ 已掌握</span>' : `<span class="muted">${i.passes || 0}/${TH.passes_to_master || 2} 次通过</span>`}</div></div>`;
  const sortI = a => a.sort((x, y) => (x.mastered - y.mastered) || ((x.best || 0) - (y.best || 0)));
  $('#pVocab').innerHTML = sortI(vocab).map(row).join('') || '<p class="muted">还没有练过</p>';
  $('#pGrammar').innerHTML = sortI(gram).map(row).join('') || '<p class="muted">还没有练过</p>';
  $('#pSessions').innerHTML = st.sessions.slice(-8).reverse().map(s => `<div class="prow"><div>${esc((s.source_zh || '复习').slice(0, 28))}…<div class="muted">${new Date(s.started).toLocaleString('zh-CN', { hour12: false })}</div></div><div>${s.items.filter(i => i.passed).length}/${s.items.length}</div></div>`).join('') || '<p class="muted">还没有练习记录</p>';
}
$('#reviewWeak').onclick = () => {
  const st = loadStore(); const weak = Object.values(st.items).filter(i => !i.mastered).sort((a, b) => (a.best || 0) - (b.best || 0)).slice(0, 12);
  if (!weak.length) return toast('没有未掌握的项目，去练新的一段吧！');
  analysis = null;
  startDrill(weak.map(i => ({ type: i.type, cue: i.type === 'vocab' ? i.zh : i.cue || i.zh, pattern: i.pattern, ja: i.ja, kana: i.kana, zh: i.zh, key: i.type === 'grammar' ? 'grammar:' + i.pattern : undefined, th: i.type === 'vocab' ? TH.vocab : TH.sentence, attempts: 0, best: 0, passed: false, requeued: false })), '复习未掌握项目');
};
$('#resetAll').onclick = () => { if (confirm('确定清除本机所有练习记录？')) { localStorage.removeItem(STORE); toast('已清除'); renderProgress(); } };

init();
