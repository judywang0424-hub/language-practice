// Kana helpers: katakana->hiragana, hiragana->romaji (Hepburn), fuzzy compare.
(function (g) {
  function kataToHira(s) { return s.replace(/[\u30A1-\u30F6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)); }
  const T = {
    'きゃ':'kya','きゅ':'kyu','きょ':'kyo','しゃ':'sha','しゅ':'shu','しょ':'sho','ちゃ':'cha','ちゅ':'chu','ちょ':'cho','にゃ':'nya','にゅ':'nyu','にょ':'nyo','ひゃ':'hya','ひゅ':'hyu','ひょ':'hyo','みゃ':'mya','みゅ':'myu','みょ':'myo','りゃ':'rya','りゅ':'ryu','りょ':'ryo','ぎゃ':'gya','ぎゅ':'gyu','ぎょ':'gyo','じゃ':'ja','じゅ':'ju','じょ':'jo','びゃ':'bya','びゅ':'byu','びょ':'byo','ぴゃ':'pya','ぴゅ':'pyu','ぴょ':'pyo',
    'てぃ':'ti','でぃ':'di','うぇ':'we','うぃ':'wi','ふぁ':'fa','ふぃ':'fi','ふぇ':'fe','ふぉ':'fo','しぇ':'she','じぇ':'je','ちぇ':'che','ゔぁ':'va',
    'あ':'a','い':'i','う':'u','え':'e','お':'o','か':'ka','き':'ki','く':'ku','け':'ke','こ':'ko','さ':'sa','し':'shi','す':'su','せ':'se','そ':'so','た':'ta','ち':'chi','つ':'tsu','て':'te','と':'to','な':'na','に':'ni','ぬ':'nu','ね':'ne','の':'no','は':'ha','ひ':'hi','ふ':'fu','へ':'he','ほ':'ho','ま':'ma','み':'mi','む':'mu','め':'me','も':'mo','や':'ya','ゆ':'yu','よ':'yo','ら':'ra','り':'ri','る':'ru','れ':'re','ろ':'ro','わ':'wa','を':'o','ん':'n',
    'が':'ga','ぎ':'gi','ぐ':'gu','げ':'ge','ご':'go','ざ':'za','じ':'ji','ず':'zu','ぜ':'ze','ぞ':'zo','だ':'da','ぢ':'ji','づ':'zu','で':'de','ど':'do','ば':'ba','び':'bi','ぶ':'bu','べ':'be','ぼ':'bo','ぱ':'pa','ぴ':'pi','ぷ':'pu','ぺ':'pe','ぽ':'po','ぁ':'a','ぃ':'i','ぅ':'u','ぇ':'e','ぉ':'o','ゃ':'ya','ゅ':'yu','ょ':'yo','ゔ':'vu',
    '、':', ','。':'. ','？':'? ','！':'! ','　':' '
  };
  function toRomaji(kana) {
    const s = kataToHira(kana || '');
    let out = '', i = 0;
    while (i < s.length) {
      const two = s.slice(i, i + 2), one = s[i];
      if (one === 'っ') { const nx = T[s.slice(i + 1, i + 3)] || T[s[i + 1]] || ''; out += nx ? (nx.startsWith('ch') ? 't' : nx[0]) : ''; i++; continue; }
      if (one === 'ー') { const m = out.match(/[aeiou](?=[^aeiou]*$)/); out += m ? m[0] : ''; i++; continue; }
      if (T[two]) { out += T[two]; i += 2; continue; }
      if (one === 'ん' && /[aiueoyあいうえおやゆよ]/.test(s[i + 1] || '')) { out += "n'"; i++; continue; }
      out += T[one] !== undefined ? T[one] : one; i++;
    }
    return out.replace(/\s+/g, ' ').trim();
  }
  function norm(s) {
    return (s || '').normalize('NFKC').replace(/パーセント|ぱーせんと/g, '%').replace(/[\s、。，,．.！!？?「」『』（）()・〜~:：;；"'“”]/g, '').toLowerCase();
  }
  // LCS with matched-index set on target.
  function lcs(a, b) {
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    const hit = new Set(); let i = n, j = m;
    while (i > 0 && j > 0) { if (a[i - 1] === b[j - 1]) { hit.add(j - 1); i--; j--; } else if (dp[i - 1][j] >= dp[i][j - 1]) i--; else j--; }
    return { len: dp[n][m], hit };
  }
  // Compare a user utterance against a target (ja + kana). Returns score 0..1 and diff on the best view.
  function compare(user, ja, kana) {
    const u = norm(user), t1 = norm(ja);
    const r1 = lcs(u, t1);
    // penalise lots of extra content a little, so random long speech doesn't pass
    const extra1 = Math.max(0, u.length - t1.length * 1.5) / Math.max(1, t1.length);
    const s1 = t1.length ? Math.max(0, r1.len / t1.length - extra1 * 0.3) : 0;
    let best = { score: s1, view: 'ja', target: t1, hit: r1.hit };
    if (kana) {
      const u2 = kataToHira(u), t2 = kataToHira(norm(kana));
      const r2 = lcs(u2, t2);
      const extra2 = Math.max(0, u2.length - t2.length * 1.5) / Math.max(1, t2.length);
      const s2 = t2.length ? Math.max(0, r2.len / t2.length - extra2 * 0.3) : 0;
      if (s2 > best.score + 0.02) best = { score: s2, view: 'kana', target: t2, hit: r2.hit };
    }
    best.score = Math.min(1, best.score);
    return best;
  }
  g.Kana = { kataToHira, toRomaji, norm, compare };
})(window);
