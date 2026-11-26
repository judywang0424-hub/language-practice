/* Dialogue mode helpers (💬 对话): pure functions, browser (window.EPDialogue) + node (tests).
   - fallbackReply(text, history): built-in reply library used when no AI key is configured.
     Keyword/intent matching -> one short friendly sentence that usually ends with a follow-up question.
   - pickClosest(alternatives, target): choose the ASR alternative closest to an expected sentence
     (word-level edit distance on normalized words). Used by the drill/repeat mic.
   - wordDistance(a, b), normWords(s): exported for tests. */
(function (g) {
"use strict";
const CONTR = {"i'm":"i am","you're":"you are","it's":"it is","that's":"that is","don't":"do not","doesn't":"does not","didn't":"did not",
  "can't":"can not","cannot":"can not","won't":"will not","isn't":"is not","aren't":"are not","wasn't":"was not","i've":"i have","i'll":"i will","i'd":"i would","let's":"let us","what's":"what is"};
function normWords(s) {
  return String(s || "").toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9'\s-]/g, " ").replace(/-/g, " ")
    .split(/\s+/).filter(Boolean).flatMap(w => (CONTR[w] || w.replace(/^'+|'+$/g, "")).split(" ")).filter(Boolean);
}
function wordDistance(a, b) {
  const x = Array.isArray(a) ? a : normWords(a), y = Array.isArray(b) ? b : normWords(b);
  let prev = Array.from({length: y.length + 1}, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[y.length];
}
/* alternatives: array of strings (or {transcript, confidence}). Returns the best string.
   Without a target, the first (highest-confidence) alternative wins. Ties keep the earlier (more confident) one. */
function pickClosest(alternatives, target) {
  const alts = (alternatives || []).map(a => typeof a === "string" ? a : (a && a.transcript) || "").filter(s => s.trim());
  if (!alts.length) return "";
  if (!target || !normWords(target).length) return alts[0];
  const t = normWords(target);
  let best = alts[0], bestD = Infinity;
  alts.forEach(a => { const d = wordDistance(normWords(a), t); if (d < bestD) { bestD = d; best = a; } });
  return best;
}

/* ---------------- built-in reply library (no AI key) ---------------- */
// Order matters: first matching intent wins. Each intent has several replies; we rotate so it doesn't repeat.
const INTENTS = [
  {id: "bye", re: /\b(bye|goodbye|see you|good night|talk (to you )?later|gotta go|i have to go)\b/, replies: [
    "It was nice talking with you, see you next time!",
    "Great chat today, have a lovely evening!",
    "Bye for now, you did really well today!"]},
  {id: "thanks", re: /\b(thank you|thanks|thx|appreciate)\b/, replies: [
    "You're welcome, what else would you like to talk about?",
    "No problem at all, shall we keep chatting?"]},
  {id: "greeting", re: /\b(hello|hi|hey|good (morning|afternoon|evening)|how are you|how's it going|nice to meet you)\b/, replies: [
    "Hi there, I'm doing great, how was your day?",
    "Hello, nice to hear from you, what have you been up to today?",
    "Hey, good to see you, how are you feeling today?"]},
  {id: "name", re: /\b(my name is|i am called|call me)\b/, replies: [
    "Nice to meet you, what do you do for work?",
    "That's a nice name, where are you from?"]},
  {id: "meeting", re: /\b(meeting|presentation|customer|client|report|deadline|project|boss|colleague|team)\b/, replies: [
    "That sounds busy, how did the meeting go?",
    "I see, what was the most important point for your team?",
    "Interesting, was the customer happy with the result?",
    "Got it, what is the next step for the project?"]},
  {id: "work", re: /\b(work|job|office|company|overtime|engineer|factory|semiconductor|wafer|chip|busy)\b/, replies: [
    "Work can be tiring, what do you like most about your job?",
    "That sounds interesting, how long have you worked there?",
    "Wow, what does a normal workday look like for you?",
    "I hope it's not too stressful, do you often work late?"]},
  {id: "weekend", re: /\b(weekend|saturday|sunday|holiday|day off|vacation|free time)\b/, replies: [
    "Nice, what are your plans for the weekend?",
    "That sounds relaxing, did you do anything fun?",
    "Lovely, do you prefer staying home or going out on weekends?"]},
  {id: "food", re: /\b(eat|ate|food|lunch|dinner|breakfast|restaurant|cook|cooking|delicious|hungry|coffee|tea|hot ?pot|noodles|rice|takeout)\b/, replies: [
    "Yum, what's your favorite dish?",
    "That sounds delicious, do you like cooking at home?",
    "Nice, is there a restaurant you'd recommend?",
    "Good choice, did you eat it with friends?"]},
  {id: "travel", re: /\b(travel|trip|flight|fly|hotel|visit|visited|country|city|japan|korea|europe|beach|tour)\b/, replies: [
    "How exciting, where would you like to go next?",
    "That sounds amazing, what was your favorite part of the trip?",
    "Cool, do you prefer traveling alone or with friends?"]},
  {id: "hobby", re: /\b(hobby|hobbies|music|movie|movies|film|book|books|read|reading|game|games|sport|sports|gym|run|running|swim|dance|photo|photos)\b/, replies: [
    "That's a great hobby, how often do you do it?",
    "Nice, when did you start getting into that?",
    "Sounds fun, what do you enjoy most about it?"]},
  {id: "family", re: /\b(family|mom|mother|dad|father|parents|son|daughter|kids|children|husband|wife|friend|friends|sister|brother)\b/, replies: [
    "That's sweet, do you spend a lot of time together?",
    "Nice, what do you usually do together?"]},
  {id: "weather", re: /\b(weather|rain|raining|rainy|sunny|hot|cold|snow|windy)\b/, replies: [
    "Oh really, what kind of weather do you like best?",
    "I see, does the weather change your plans today?"]},
  {id: "learning", re: /\b(english|learn|learning|study|practice|speak|speaking|japanese|korean|language)\b/, replies: [
    "You're doing well, why do you want to improve your English?",
    "Practice makes perfect, how often do you speak English at work?"]},
  {id: "tired", re: /\b(tired|sleepy|exhausted|stressed|stress|sad|upset|bad day|not good|sick|worried|angry)\b/, replies: [
    "Oh no, I'm sorry to hear that, what happened?",
    "That sounds hard, what helps you relax?",
    "Take it easy, do you want to talk about it?"]},
  {id: "question", re: /(\?$|^(what|where|when|why|how|who|which|do you|did you|are you|can you|could you|would you|have you)\b)/, replies: [
    "Good question, I'd love to hear what you think first?",
    "Hmm, I think it depends, what about you?",
    "That's interesting to think about, what's your opinion?"]},
  {id: "happy", re: /\b(happy|great|good|awesome|excited|fun|nice|wonderful|fine|well|love|like)\b/, replies: [
    "That's great to hear, what made it so good?",
    "Awesome, tell me a little more about it?",
    "I'm glad, what are you looking forward to next?"]},
  {id: "yes", re: /^(yes|yeah|yep|sure|of course|ok|okay|right|exactly)\b/, replies: [
    "Great, can you tell me a bit more?",
    "Cool, and then what happened?"]},
  {id: "no", re: /^(no|nope|not really|i don't think so)\b/, replies: [
    "That's okay, what would you rather talk about?",
    "No problem, so what did you do instead?"]},
];
const DEFAULTS = [
  "Interesting, can you tell me more about that?",
  "I see, how did that make you feel?",
  "Really, why do you think so?",
  "That sounds nice, what happened next?",
  "Got it, can you give me an example?",
  "Oh cool, when did that happen?",
];
const OPENERS = ["Hi, let's chat in English, how was your day today?", "Hello, what did you do today?", "Hi, tell me something about your work today?"];

function detectIntent(text) {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return null;
  for (const it of INTENTS) if (it.re.test(t)) return it;
  return null;
}
/* history: [{role:"user"|"ai", text}] (previous turns, optional). Rotates through replies not yet used. */
function fallbackReply(text, history) {
  const used = new Set((history || []).filter(h => h && h.role !== "user").map(h => h.text));
  const it = detectIntent(text);
  const pool = it ? it.replies : DEFAULTS;
  const fresh = pool.filter(r => !used.has(r));
  const list = fresh.length ? fresh : (it ? DEFAULTS.filter(r => !used.has(r)) : []);
  const pick = (list.length ? list : pool);
  const n = (history || []).length;
  return {reply: pick[n % pick.length], intent: it ? it.id : "default"};
}
function libraryStats() { return {intents: INTENTS.length, replies: INTENTS.reduce((s, i) => s + i.replies.length, 0) + DEFAULTS.length}; }
function opener(i) { return OPENERS[(i || 0) % OPENERS.length]; }

const API = {normWords, wordDistance, pickClosest, detectIntent, fallbackReply, libraryStats, opener};
if (typeof module !== "undefined") module.exports = API; else g.EPDialogue = API;
})(typeof window !== "undefined" ? window : globalThis);
