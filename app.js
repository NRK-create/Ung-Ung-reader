/* อุ๋งอุ๋งอ่านนิทาน — ตัวเกม
   ไฟล์นี้รวม: ตรวจเสียงอ่าน, ระบบสมาชิก/คะแนน/หมวด/อันดับ, เพิ่มนิทานเอง */
(function(){
'use strict';

/* ============ ตัวช่วยทั่วไป ============ */
var $ = function(id){ return document.getElementById(id); };
var SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
var synth = window.speechSynthesis || null;
var RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
var B = window.UU_BACKEND;
var LS = {
  get: function(k, d){ try{ var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set: function(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} },
  del: function(k){ try{ localStorage.removeItem(k); }catch(e){} }
};

// เทียบเสียงแบบไม่สนวรรณยุกต์ ช่องว่าง และเครื่องหมาย (ตัวรู้จำเสียงมักแยกวรรณยุกต์ไม่ได้)
var TONES = /[่-๋]/g;
function norm(s){
  return String(s).toLowerCase().replace(TONES,'').replace(/[\s​.,!?'"“”‘’()\-–—…ๆ]/g,'');
}
function el(tag, cls, text){
  var e = document.createElement(tag);
  if(cls) e.className = cls;
  if(text != null) e.textContent = text;
  return e;
}

/* ============ ตรรกะเทียบเสียงกับเนื้อเรื่อง ============ */
function lev(a, b){
  var m = a.length, n = b.length;
  if(!m) return n;
  if(!n) return m;
  var prev = new Array(n+1), cur = new Array(n+1), i, j, t;
  for(j=0;j<=n;j++) prev[j] = j;
  for(i=1;i<=m;i++){
    cur[0] = i;
    for(j=1;j<=n;j++){
      cur[j] = Math.min(prev[j]+1, cur[j-1]+1, prev[j-1] + (a[i-1]===b[j-1] ? 0 : 1));
    }
    t = prev; prev = cur; cur = t;
  }
  return prev[n];
}
function maxDist(n){ return n <= 2 ? 0 : (n <= 5 ? 1 : 2); }

// words: คำที่ปรับรูปแล้ว, text: ข้อความที่ได้ยิน (ปรับรูปแล้ว)
// คืนจำนวนคำที่อ่านได้ตรงตามลำดับ (k) และตำแหน่งตัวอักษรที่ใช้ไป (c)
function align(words, text){
  var c = 0, k = 0;
  for(; k < words.length; k++){
    var w = words[k], md = maxDist(w.length), best = null;
    for(var s = c; s <= Math.min(c+2, text.length); s++){
      for(var L = w.length-1; L <= w.length+1; L++){
        if(L < 1 || s+L > text.length) continue;
        var d = lev(w, text.substr(s, L));
        if(d <= md && (!best || d < best.d || (d === best.d && s < best.s))) best = {d:d, s:s, e:s+L};
      }
    }
    if(!best) break;
    c = best.e;
  }
  return {k:k, c:c};
}
window.__align = align; window.__norm = norm;

/* ============ ระดับการอ่าน ============ */
var LEVELS = {
  1:{name:'ง่าย', desc:'คำสั้นๆ ประโยคสั้น เหมาะกับการเริ่มอ่าน'},
  2:{name:'ท้าทาย', desc:'ประโยคยาวขึ้น และมีคำที่ต้องสะกดมากขึ้น'},
  3:{name:'ศัพท์ยาก', desc:'คำศัพท์ใหม่ๆ คำยาว และตัวสะกดที่ซับซ้อน'}
};

// ประเมินระดับจากความยาวคำ จำนวนคำต่อประโยค และสัดส่วนคำยาก/ตัวสะกดซับซ้อน
function levelOf(sentences){
  var n = 0, len = 0, hard = 0, sw = 0;
  sentences.forEach(function(s){
    sw += s.length;
    s.forEach(function(w){
      var L = norm(w).length; n++; len += L;
      if(/[ศษฬฤฦ์ฑฒณธภฐฆฌญ]/.test(w) || L >= 7) hard++;
    });
  });
  if(!n) return 1;
  var avg = len / n, hr = hard / n, wps = sw / sentences.length;
  if(hr >= 0.12 || avg >= 3.8) return 3;
  if(wps <= 6.5 && hr < 0.03 && avg <= 3.3) return 1;
  return 2;
}


/* ============ ตั้งค่าในเครื่อง (ไม่ขึ้นระบบ): เวลารอ, นิทานที่เพิ่มเอง, ครั้งที่พลาด ============ */
var KEY = 'ung-ung-reader-v1';
var save = {custom:[], slow:3, strikes:{}};   // slow = วินาทีที่รอก่อนช่วยอ่าน (ค่าเริ่มต้น 3)
(function(){
  var o = LS.get(KEY, null);
  if(o && typeof o === 'object'){ if(Array.isArray(o.custom)) save.custom = o.custom; if(o.slowS) save.slow = Number(o.slowS) || 3; if(o.strikes && typeof o.strikes === 'object') save.strikes = o.strikes; }
})();
function persist(){ var o = Object.assign({}, save); o.slowS = save.slow; delete o.slow; LS.set(KEY, o); }
function allCustom(){
  return save.custom.map(function(c){
    return {id:c.id, title:c.title, level:c.level || levelOf(c.sentences), custom:true, sentences:c.sentences};
  });
}

var SEG = (window.Intl && Intl.Segmenter) ? new Intl.Segmenter('th', {granularity:'word'}) : null;
function segmentLine(line){
  if(line.indexOf('|') >= 0) return line.split('|').map(function(s){ return s.trim(); }).filter(Boolean);
  if(SEG) return Array.from(SEG.segment(line)).filter(function(x){ return x.isWordLike; }).map(function(x){ return x.segment; });
  return line.split(/\s+/).filter(Boolean);
}

/* ============ แบ่งประโยคจากข้อความที่วางหรือถอดจากรูป ============ */
var THAI_CH = /[\u0E00-\u0E7F]/;
function joinChunks(a){            // ต่อชิ้นข้อความ ไม่ใส่ช่องว่างระหว่างอักษรไทยกับอักษรไทย
  var s = '';
  a.forEach(function(c){
    if(s && !(THAI_CH.test(s.slice(-1)) && THAI_CH.test(c.charAt(0)))) s += ' ';
    s += c;
  });
  return s;
}
function wordsOf(line){ return segmentLine(line).filter(function(w){ return norm(w).length > 0; }); }
function capLen(ws){               // ประโยคยาวเกิน 12 คำ แบ่งเป็นท่อนละประมาณ 9 คำ
  if(ws.length <= 12) return [ws];
  var n = Math.ceil(ws.length / 9), size = Math.ceil(ws.length / n), out = [];
  for(var i = 0; i < ws.length; i += size) out.push(ws.slice(i, i + size));
  return out;
}
function parseText(text){
  var out = [];
  String(text || '').replace(/\r/g, '').split(/\n+/).forEach(function(line){
    line = line.trim();
    if(!line) return;
    if(line.indexOf('|') >= 0){ var w = wordsOf(line); if(w.length) out.push(w); return; }
    var acc = [], cur = [], start = out.length;
    function flush(last){
      if(cur.length < 2 && last && out.length > start) out[out.length - 1] = out[out.length - 1].concat(cur);
      else if(cur.length) capLen(cur).forEach(function(p){ out.push(p); });
      acc = []; cur = [];
    }
    line.split(/[.!?…]+|\s+/).forEach(function(c){
      if(norm(c).length === 0) return;
      acc.push(c); cur = wordsOf(joinChunks(acc));
      if(cur.length >= 3) flush(false);
    });
    flush(true);
  });
  return out;
}

/* ============ มาสคอต ============ */
var SEAL = '<svg class="mascot" viewBox="0 0 120 128" role="img" aria-label="อุ๋งอุ๋ง แมวน้ำผู้ช่วยอ่าน" data-mood="idle"><g class="body"><ellipse cx="46" cy="123" rx="12" ry="5" fill="#6F83C4"/><ellipse cx="74" cy="123" rx="12" ry="5" fill="#6F83C4"/><ellipse cx="60" cy="100" rx="36" ry="26" fill="#8C9FDB"/><ellipse cx="60" cy="106" rx="22" ry="18" fill="#F4F6FF"/><ellipse cx="25" cy="102" rx="8" ry="14" fill="#6F83C4" transform="rotate(32 25 102)"/><ellipse cx="95" cy="102" rx="8" ry="14" fill="#6F83C4" transform="rotate(-32 95 102)"/><ellipse cx="60" cy="56" rx="42" ry="38" fill="#8C9FDB"/><ellipse cx="60" cy="40" rx="22" ry="9" fill="#A6B6E8" opacity=".7"/><ellipse cx="33" cy="63" rx="7" ry="4.5" fill="#FFB3C1" opacity=".85"/><ellipse cx="87" cy="63" rx="7" ry="4.5" fill="#FFB3C1" opacity=".85"/><g stroke="#6F83C4" stroke-width="1.6" stroke-linecap="round" fill="none"><path d="M43 66 L29 62"/><path d="M43 71 L29 73"/><path d="M77 66 L91 62"/><path d="M77 71 L91 73"/></g><ellipse cx="52" cy="67" rx="10" ry="8" fill="#fff"/><ellipse cx="68" cy="67" rx="10" ry="8" fill="#fff"/><ellipse cx="60" cy="61" rx="6" ry="4" fill="#1B2260"/><path d="M60 65 V68 M60 68 Q55 73 51 69 M60 68 Q65 73 69 69" stroke="#1B2260" stroke-width="1.8" stroke-linecap="round" fill="none"/><g class="eyes"><circle class="pupil" cx="44" cy="50" r="6.5" fill="#1B2260"/><circle class="pupil" cx="76" cy="50" r="6.5" fill="#1B2260"/><circle cx="46.3" cy="47.6" r="2.3" fill="#fff"/><circle cx="78.3" cy="47.6" r="2.3" fill="#fff"/></g><g class="happy-eyes" fill="none" stroke="#1B2260" stroke-width="4" stroke-linecap="round"><path d="M37 53 Q44 43 51 53"/><path d="M69 53 Q76 43 83 53"/></g><path class="drop" d="M100 34 Q106 44 100 49 Q94 44 100 34 Z" fill="#7FC8FF"/></g></svg>';
document.querySelectorAll('.mascot-slot').forEach(function(s){ s.innerHTML = SEAL; });
var moodTimer = null;
function setMood(m, revertMs){
  clearTimeout(moodTimer);
  document.querySelectorAll('.mascot').forEach(function(o){ o.setAttribute('data-mood', m); });
  if(revertMs) moodTimer = setTimeout(function(){ setMood(listening ? 'listen' : 'idle'); }, revertMs);
}
function bubble(t){ $('bubble').textContent = t; }

/* ============ เสียงเอฟเฟกต์และเสียงพูด ============ */
var ac = null;
function ensureAudio(){
  try{
    if(!ac){ var C = window.AudioContext || window.webkitAudioContext; if(C) ac = new C(); }
    if(ac && ac.state === 'suspended') ac.resume();
  }catch(e){}
  if(synth && !ttsUnlocked){        // มือถือบางเครื่องต้องมีการแตะก่อน เสียงพูดถึงจะดัง
    ttsUnlocked = true;
    try{ var u0 = new SpeechSynthesisUtterance(' '); u0.volume = 0; synth.speak(u0); }catch(e){}
  }
}
var ttsUnlocked = false, ttsPaused = false;
function tone(f, t0, d, type, g){
  if(!ac) return;
  var o = ac.createOscillator(), v = ac.createGain(), t = ac.currentTime + t0;
  o.type = type || 'sine'; o.frequency.value = f;
  v.gain.setValueAtTime(0.0001, t);
  v.gain.exponentialRampToValueAtTime(g || 0.1, t + 0.02);
  v.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(v); v.connect(ac.destination); o.start(t); o.stop(t + d + 0.05);
}
var sfx = {
  win: function(){ [659,784,988].forEach(function(f,i){ tone(f, i*0.11, 0.22, 'triangle', 0.1); }); },
  oops: function(){ tone(220, 0, 0.22, 'sawtooth', 0.05); tone(180, 0.14, 0.26, 'sawtooth', 0.05); }
};

var voice = null;
function pickVoice(){
  if(!synth) return;
  var vs = synth.getVoices() || [];
  voice = null;
  for(var i=0;i<vs.length;i++){ if(/^th/i.test(String(vs[i].lang).replace('_','-'))){ voice = vs[i]; break; } }
}
if(synth){ pickVoice(); synth.onvoiceschanged = pickVoice; }

var speaking = false, quietUntil = 0;
function say(text, rate){
  return new Promise(function(res){
    if(!synth){ res(); return; }
    try{ synth.cancel(); }catch(e){}
    var u;
    try{ u = new SpeechSynthesisUtterance(text); }catch(e){ res(); return; }
    u.lang = 'th-TH'; u.rate = rate || 0.85; u.pitch = 1.1; u.volume = 1;
    if(voice) u.voice = voice;
    speaking = true;
    pauseRec();          // มือถือหลายเครื่องจะไม่ส่งเสียงพูดออกลำโพงถ้าไมค์กำลังฟังอยู่ จึงพักไมค์ระหว่างพูด
    var done = false, tm = null, wd = null;
    function fin(){
      if(done) return; done = true; clearTimeout(tm); clearTimeout(wd);
      speaking = false;
      quietUntil = Date.now() + 700;              // รอให้เสียงสะท้อนจางก่อนฟังต่อ
      setTimeout(function(){ resetRecog(); lastActive = Date.now(); resumeRec(); }, 720);
      res();
    }
    u.onend = fin; u.onerror = fin;
    u.onstart = function(){ clearTimeout(wd); };
    tm = setTimeout(fin, Math.min(12000, 2500 + text.length * 260));
    wd = setTimeout(function(){ try{ synth.cancel(); }catch(e){} fin(); }, 3500);   // ถ้าเครื่องไม่เริ่มพูดเลย ไม่ให้เกมค้าง
    setTimeout(function(){                       // เว้นช่วงสั้นๆ หลัง cancel เพราะ Chrome บน Android มักทิ้งเสียงที่สั่งพูดทันที
      if(done) return;
      try{ if(synth.paused) synth.resume(); synth.speak(u); }catch(e){ fin(); }
    }, 90);
  });
}

/* ============ สถานะการอ่าน ============ */
var story = null, sIdx = 0, words = [], nwords = [], status = [], pos = 0, flashWrong = -1;
var stats = null, wrongCnt = {};
var listening = false, busy = false, rec = null, lastActive = 0;
var ignoreIdx = -1, skipChars = 0, segIdx = -1, base = 0, latest = {idx:-1, text:''};
var wrongTimer = null;

var cur = null, sentGen = 0, snap = null;

function loadSentence(){
  sentGen++;
  snap = {ok:stats.ok, help:stats.help, wrong:stats.wrong, clean:stats.clean, pr:Array.from(stats.practice)};
  words = story.sentences[sIdx];
  nwords = words.map(norm);
  status = words.map(function(){ return null; });
  pos = 0; flashWrong = -1; busy = false;
  clearTimeout(wrongTimer);
  renderSentence(); renderDots(false);
  $('rCount').textContent = 'ประโยค ' + (sIdx+1) + ' จาก ' + story.sentences.length;
  $('heard').textContent = '';
  resetRecog();
  lastActive = Date.now() + 1500;
  bubble(listening ? 'อ่านประโยคนี้ได้เลย อุ๋งอุ๋งฟังอยู่' : (SR ? 'กดปุ่มไมค์ แล้วอ่านออกเสียงตามได้เลย' : 'แตะคำเพื่อฟังเสียง แล้วกดปุ่มเมื่ออ่านได้'));
}

// เริ่มประโยคนี้ใหม่: คืนค่าสถิติของประโยคนี้กลับไปเหมือนก่อนเริ่มอ่านประโยคนี้
function restartSentence(){
  if(!story || !snap || $('reader').hidden) return;
  stats.ok = snap.ok; stats.help = snap.help; stats.wrong = snap.wrong; stats.clean = snap.clean;
  stats.practice = new Set(snap.pr);
  Object.keys(wrongCnt).forEach(function(k){ if(k.indexOf(sIdx + ':') === 0) delete wrongCnt[k]; });
  if(synth){ try{ synth.cancel(); }catch(e){} }
  speaking = false;
  loadSentence();
  setMood(listening ? 'listen' : 'idle');
  bubble(listening ? 'เริ่มประโยคนี้ใหม่นะ อ่านได้เลย' : 'เริ่มประโยคนี้ใหม่นะ');
}

function beginReading(st){
  story = st; sIdx = 0; wrongCnt = {};
  stats = {total: st.sentences.reduce(function(a, s){ return a + s.length; }, 0), ok:0, help:0, wrong:0, clean:0, practice:new Set()};
  go('reader');
  loadSentence();
  updateMic();
}

function renderSentence(){
  var box = $('sentence'); box.textContent = '';
  words.forEach(function(w, i){
    var b = el('button', 'w', w); b.type = 'button';
    b.setAttribute('aria-label', 'ฟังเสียงคำว่า ' + w);
    b.addEventListener('click', function(){ ensureAudio(); if(!busy) say(w, 0.7); });
    box.appendChild(b);
  });
  paintWords();
}
function paintWords(){
  var kids = $('sentence').children;
  for(var i=0;i<kids.length;i++){
    var c = 'w';
    if(status[i] === 'ok') c += ' ok';
    else if(status[i] === 'help') c += ' help';
    else if(i === pos) c += ' cur' + (flashWrong === i ? ' bad' : '');
    kids[i].className = c;
  }
}
function shake(i){
  var b = $('sentence').children[i];
  if(b && b.animate && !RM){
    b.animate([{transform:'translateX(0)'},{transform:'translateX(-8px)'},{transform:'translateX(8px)'},{transform:'translateX(-5px)'},{transform:'translateX(0)'}], {duration:380});
  }
}
function renderDots(doneCur){
  var d = $('dots'); d.textContent = '';
  for(var i=0;i<story.sentences.length;i++){
    var s = el('span');
    if(i < sIdx || (i === sIdx && doneCur)) s.className = 'done';
    else if(i === sIdx) s.className = 'cur';
    d.appendChild(s);
  }
}

function resetRecog(){
  ignoreIdx = latest.idx; skipChars = latest.text.length; segIdx = latest.idx; base = pos;
  clearTimeout(wrongTimer);
}


function markOk(i){
  status[i] = 'ok'; stats.ok++;
  if(!(wrongCnt[sIdx + ':' + i] > 0)) stats.clean++;
}

var PRAISE = ['เก่งมาก!','อ่านได้ถูกต้องเลย','ยอดเยี่ยม!','อ่านคล่องจัง','เยี่ยมไปเลย!'];
function sentenceDone(){
  if(busy) return;
  busy = true; clearTimeout(wrongTimer); flashWrong = -1; paintWords();
  setMood('happy', 1600);
  bubble(PRAISE[Math.floor(Math.random() * PRAISE.length)]);
  ensureAudio(); sfx.win(); renderDots(true);
  var g = sentGen;
  setTimeout(function(){
    if($('reader').hidden || g !== sentGen) return;
    sIdx++;
    if(sIdx >= story.sentences.length) finishStory(); else loadSentence();
  }, 1600);
}

async function helpWord(i, reason){
  if(i >= words.length || busy) return;
  busy = true; clearTimeout(wrongTimer);
  status[i] = 'help'; stats.help++; stats.practice.add(words[i]);
  pos = i + 1; flashWrong = -1; paintWords();
  bubble(reason === 'slow' ? 'ช้าไปหน่อยนะ อุ๋งอุ๋งช่วยอ่านให้ แล้วอ่านคำต่อไปเลย'
       : reason === 'wrong' ? 'คำนี้ยากนิดนึง อุ๋งอุ๋งอ่านให้ แล้วไปคำต่อไปกัน'
       : 'อุ๋งอุ๋งอ่านให้นะ ตามมาเลย');
  await say(words[i], 0.7);
  busy = false;
  setMood(listening ? 'listen' : 'idle');
  if(pos >= words.length) sentenceDone();
}

async function wrongAt(i){
  if(busy || i !== pos || i >= words.length) return;
  busy = true;
  var key = sIdx + ':' + i;
  wrongCnt[key] = (wrongCnt[key] || 0) + 1;
  stats.wrong++; stats.practice.add(words[i]);
  flashWrong = i; paintWords(); shake(i);
  ensureAudio(); sfx.oops(); setMood('oops', 2200);
  if(wrongCnt[key] >= 3){ busy = false; return helpWord(i, 'wrong'); }
  bubble('อ่านผิดนะ ลองอีกครั้ง คำนี้อ่านว่า “' + words[i] + '”');
  await say('ยังไม่ถูกนะ คำนี้อ่านว่า ' + words[i], 0.8);
  busy = false;
}

/* ============ ฟังเสียง ============ */
function onResult(ev){
  var n = ev.results.length, idx = n - 1, r = ev.results[idx];
  var rawText = r[0].transcript, text = norm(rawText);
  latest = {idx: idx, text: text};
  if(speaking || busy || Date.now() < quietUntil || $('reader').hidden) return;
  if(idx < ignoreIdx) return;
  var t = (idx === ignoreIdx) ? text.slice(skipChars) : text;
  if(idx !== segIdx){ segIdx = idx; base = pos; }
  $('heard').textContent = t ? 'อุ๋งอุ๋งได้ยินว่า “' + rawText.trim() + '”' : '';
  if(t.length > 0) lastActive = Date.now();
  if(pos >= words.length) return;

  var res = align(nwords.slice(base), t);
  var np = base + res.k;
  if(np > pos){
    for(var i = pos; i < np; i++) markOk(i);
    pos = np; flashWrong = -1; clearTimeout(wrongTimer); lastActive = Date.now();
    paintWords(); setMood('listen');
    if(pos >= words.length){ sentenceDone(); return; }
    bubble('เก่งมาก อ่านต่อเลย');
  }
  clearTimeout(wrongTimer);
  var w = nwords[pos], tail = t.slice(res.c);
  if(tail.length >= Math.max(2, w.length - 1) && w.indexOf(tail) !== 0){
    var at = pos;
    wrongTimer = setTimeout(function(){
      if(!speaking && !busy && listening && pos === at) wrongAt(at);
    }, r.isFinal ? 200 : 1000);
  }
}
function onError(e){
  var code = e && e.error;
  if(code === 'no-speech' || code === 'aborted') return;
  var hint = $('micHint');
  hint.classList.add('warn');
  if(code === 'not-allowed' || code === 'service-not-allowed'){
    listening = false; updateMic();
    hint.textContent = 'อุ๋งอุ๋งยังใช้ไมโครโฟนไม่ได้ กรุณาอนุญาตการใช้ไมค์ในเบราว์เซอร์'
      + (location.protocol === 'file:' ? ' (ถ้าเปิดไฟล์จากเครื่องแล้วยังไม่ได้ ให้เปิดผ่านเว็บแบบ https หรือ localhost)' : '');
  }else if(code === 'network'){
    hint.textContent = 'การฟังเสียงต้องต่ออินเทอร์เน็ต กรุณาตรวจสอบการเชื่อมต่อ';
  }else if(code === 'audio-capture'){
    listening = false; updateMic();
    hint.textContent = 'ไม่พบไมโครโฟนในเครื่องนี้';
  }else if(code === 'language-not-supported'){
    listening = false; updateMic();
    hint.textContent = 'เครื่องนี้ยังไม่รองรับการฟังภาษาไทย';
  }
}
function onEnd(){
  if(!listening || !rec || ttsPaused) return;
  latest = {idx:-1, text:''}; ignoreIdx = -1; skipChars = 0; segIdx = -1; base = pos;
  try{ rec.start(); }
  catch(e){ setTimeout(function(){ if(listening){ try{ rec.start(); }catch(_){} } }, 400); }
}
function openRec(){
  rec = new SR();
  rec.lang = 'th-TH'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
  rec.onresult = onResult; rec.onerror = onError; rec.onend = onEnd;
  latest = {idx:-1, text:''}; ignoreIdx = -1; skipChars = 0; segIdx = -1; base = pos;
  try{ rec.start(); }catch(e){}
}
function pauseRec(){
  if(!listening || !rec || ttsPaused) return;
  ttsPaused = true;
  rec.onend = null; rec.onresult = null;
  try{ rec.abort(); }catch(e){}
  rec = null;
}
function resumeRec(){
  if(!ttsPaused || speaking) return;
  ttsPaused = false;
  if(listening && SR && !rec) openRec();
}
function startListening(){
  if(!SR || listening) return;
  $('micHint').classList.remove('warn'); $('micHint').textContent = '';
  listening = true; lastActive = Date.now() + 2000; ttsPaused = false;
  openRec();
  updateMic();
}
function stopListening(){
  listening = false; ttsPaused = false; clearTimeout(wrongTimer);
  if(rec){ rec.onend = null; try{ rec.abort(); }catch(e){} }
  rec = null; updateMic();
}
function updateMic(){
  var b = $('micBtn');
  b.classList.toggle('on', listening);
  b.setAttribute('aria-pressed', String(listening));
  $('icoMic').hidden = !SR; $('icoOk').hidden = !!SR;
  var label = !SR ? 'อ่านถูกแล้ว' : (listening ? 'หยุดฟัง' : 'เริ่มอ่าน');
  $('micLabel').textContent = label; b.setAttribute('aria-label', label);
  $('waves').hidden = !listening;
  setMood(listening ? 'listen' : 'idle');
}

// ตรวจความช้าทุก 0.3 วินาที
setInterval(function(){
  if(!listening || speaking || busy || $('reader').hidden || pos >= words.length) return;
  if(Date.now() - lastActive > save.slow * 1000) helpWord(pos, 'slow');
}, 300);


/* ======================================================================
   เกม: หมวด คะแนน เช็กอินรายวัน โควตา อันดับ
   ====================================================================== */
var CATS = [
  {k:'e', n:'ง่าย',     lv:1, max:10, pf:'pe', bf:'be', sf:'s1', tf:'te', desc:'คำสั้นๆ ประโยคสั้น เหมาะกับการเริ่มอ่าน'},
  {k:'c', n:'ท้าทาย',   lv:2, max:15, pf:'pc', bf:'bc', sf:'s2', tf:'tc', desc:'ประโยคยาวขึ้น และมีคำที่ต้องสะกดมากขึ้น'},
  {k:'h', n:'ศัพท์ยาก', lv:3, max:20, pf:'ph', bf:'bh', sf:'s3', tf:'th', desc:'คำศัพท์ใหม่ๆ คำยาว และตัวสะกดที่ซับซ้อน'}
];
var CAT = {}; CATS.forEach(function(c){ CAT[c.k] = c; });
var LOGIN_PTS = [5, 5, 10, 10, 30, 5, 5, 10, 10, 50];   // วันที่ 1..10 แล้ววนกลับมาวันที่ 1
var NEW_PER_DAY = 5;       // เรื่องใหม่ต่อวัน (นับแยกแต่ละหมวด)
var STRIKE_LIMIT = 3;      // อ่านไม่ผ่านติดกันกี่ครั้งจึงพักถึงพรุ่งนี้
var PASS_ACC = 0.4;        // ต้องอ่านถูกตั้งแต่ครั้งแรกอย่างน้อยกี่ส่วนจึงถือว่าผ่าน

function list(c){ return (window.UU_STORIES && window.UU_STORIES[c]) || []; }
var parsed = {};
function getStory(c, i){
  var k = c + i;
  if(!parsed[k]){
    var r = list(c)[i];
    parsed[k] = {id:k, cat:c, idx:i, title:r[0], level:CAT[c].lv,
      sentences:r[1].split('/').map(function(s){ return s.split('|'); })};
  }
  return parsed[k];
}

/* ---------- วันที่ ---------- */
function pad2(n){ return (n < 10 ? '0' : '') + n; }
function deviceDate(){
  if(window.__today) return window.__today;
  var d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
// วันนี้ = วันที่มากสุดระหว่างนาฬิกาเครื่องกับวันที่เคยบันทึกไว้ (กันการย้อนนาฬิกา)
function today(){
  var t = deviceDate();
  if(P){ if(P.lastLogin > t) t = P.lastLogin; if(P.td > t) t = P.td; }
  return t;
}

/* ---------- ข้อมูลผู้เล่น ---------- */
var P = null, ACC = null, dirty = false;
function blank(name){
  return {name:name || 'น้อง', login:0, loginDay:0, lastLogin:'', pe:0, pc:0, ph:0, be:'', bc:'', bh:'',
          td:'', te:0, tc:0, th:0, lk:'', s1:0, s2:0, s3:0, total:0, upd:0};
}
var PKEYS = Object.keys(blank(''));
function clean(p){
  var o = blank(p && p.name);
  PKEYS.forEach(function(k){
    if(p && p[k] !== undefined && p[k] !== null) o[k] = (typeof o[k] === 'number') ? (Math.max(0, Math.round(Number(p[k]))) || 0) : String(p[k]);
  });
  o.name = String(o.name).slice(0, 20) || 'น้อง';
  o.total = o.login + o.s1 + o.s2 + o.s3;
  return o;
}
function mergeStr(a, b){
  var n = Math.max(a.length, b.length), s = '', i, x, y;
  for(i = 0; i < n; i++){
    x = a.charAt(i) || '0'; y = b.charAt(i) || '0';
    s += (parseInt(x, 36) >= parseInt(y, 36)) ? x : y;
  }
  return s;
}
function merge(a, b){        // a = ข้อมูลบนระบบ, b = ข้อมูลในเครื่อง → เก็บค่าที่ดีกว่า ไม่ให้คะแนนหาย
  var o = clean(a); b = clean(b);
  ['login','pe','pc','ph','s1','s2','s3','upd'].forEach(function(k){ o[k] = Math.max(o[k], b[k]); });
  ['be','bc','bh'].forEach(function(k){ o[k] = mergeStr(o[k], b[k]); });
  if(b.lastLogin > o.lastLogin || (b.lastLogin === o.lastLogin && b.loginDay > o.loginDay)){ o.lastLogin = b.lastLogin; o.loginDay = b.loginDay; }
  if(b.td > o.td){ o.td = b.td; o.te = b.te; o.tc = b.tc; o.th = b.th; o.lk = b.lk; }
  else if(b.td === o.td){
    o.te = Math.max(o.te, b.te); o.tc = Math.max(o.tc, b.tc); o.th = Math.max(o.th, b.th);
    b.lk.split('').forEach(function(ch){ if(o.lk.indexOf(ch) < 0) o.lk += ch; });
  }
  o.total = o.login + o.s1 + o.s2 + o.s3;
  return o;
}
function getBest(c, i){ return parseInt(P[CAT[c].bf].charAt(i), 36) || 0; }
function setBest(c, i, v){
  var f = CAT[c].bf, s = P[f];
  while(s.length < i) s += '0';
  P[f] = s.slice(0, i) + v.toString(36) + s.slice(i + 1);
}

/* ---------- เก็บในเครื่อง + ซิงก์ขึ้นระบบ ---------- */
function pkey(){ return 'uu-prof-' + ACC.uid; }
function saveLocal(){ if(ACC && P) LS.set(pkey(), {p:P, dirty:dirty}); }
var syncTimer = null, syncing = null, syncMsg = '', retryTimer = null;
function setSync(m){ syncMsg = m; var e = $('syncInfo'); if(e) e.textContent = m; }
function commit(){
  P.total = P.login + P.s1 + P.s2 + P.s3;
  P.upd = Date.now(); dirty = true; saveLocal(); renderMe();
  clearTimeout(syncTimer); syncTimer = setTimeout(doSync, 1500);
}
function doSync(){
  if(!ACC || !dirty) return Promise.resolve();
  if(syncing) return syncing;
  var sent = P.upd, snapP = clean(P);
  syncing = B.saveProfile(ACC.uid, snapP).then(function(){
    syncing = null;
    if(P && P.upd === sent) dirty = false;
    saveLocal();
    setSync(B.mode === 'demo' ? 'โหมดทดลอง: เก็บคะแนนไว้ในเครื่องนี้' : 'บันทึกคะแนนขึ้นระบบแล้ว');
    refreshRank();
    if(dirty) setTimeout(doSync, 300);
  }, function(e){
    syncing = null;
    setSync('ยังบันทึกคะแนนขึ้นระบบไม่ได้ (' + B.errorText(e) + ') แอปจะลองใหม่เอง');
    clearTimeout(retryTimer); retryTimer = setTimeout(doSync, 20000);
  });
  return syncing;
}
function syncNow(){ clearTimeout(syncTimer); return doSync(); }

/* ---------- วันใหม่ และคะแนนเข้าสู่ระบบ ---------- */
function rollover(){
  var t = today();
  if(P.td === t) return false;
  P.td = t; P.te = P.tc = P.th = 0; P.lk = '';
  save.strikes = {}; persist();
  return true;
}
function dailyLogin(){
  var t = today();
  if(P.lastLogin === t) return null;
  var day = (P.loginDay % 10) + 1, pts = LOGIN_PTS[day - 1];
  P.login += pts; P.loginDay = day; P.lastLogin = t;
  return {day:day, pts:pts};
}
function dayTick(){          // เรียกตอนเปิดหน้าหลัก: เปลี่ยนวัน + แจกคะแนนเช็กอิน
  if(!P) return null;
  var a = rollover(), award = dailyLogin();
  if(a || award) commit();
  return award;
}

function strikesOf(c){ var s = save.strikes[c]; return s ? (s.n || 0) : 0; }
function setStrikes(c, n){ save.strikes[c] = {n:n}; persist(); }

function catState(c){
  var m = CAT[c], total = list(c).length, passed = Math.min(P[m.pf], total), used = P[m.tf];
  var st = {m:m, total:total, passed:passed, used:used, left:Math.max(0, NEW_PER_DAY - used)};
  if(passed >= total) st.state = 'done';
  else if(P.lk.indexOf(c) >= 0) st.state = 'locked';
  else if(used >= NEW_PER_DAY) st.state = 'quota';
  else st.state = 'open';
  return st;
}

/* ---------- เปลี่ยนหน้าจอ ---------- */
var SCREENS = ['boot','auth','home','board','lib','mine','settings','reader','result'];
var hs = 'home';
function show(name){
  SCREENS.forEach(function(n){ $(n).hidden = (n !== name); });
  window.scrollTo(0, 0);
}
function go(name){
  var flow = function(n){ return n === 'reader' || n === 'result'; };
  var replace = (name === hs) || (flow(hs) && flow(name));
  try{ if(replace) history.replaceState({s:name}, ''); else history.pushState({s:name}, ''); }catch(e){}
  hs = name;
  show(name);
  if(name === 'board') renderBoard();
  else if(name === 'lib') renderLib();
  else if(name === 'mine') renderMine();
  else if(name === 'settings') renderSettings();
}
function leaveReader(){
  stopListening(); busy = false;
  if(synth){ try{ synth.cancel(); }catch(e){} }
  setMood('idle');
}
function toHome(){
  leaveReader();
  try{ history.replaceState({s:'home'}, ''); }catch(e){}
  hs = 'home';
  show('home'); renderHome();
}
window.addEventListener('popstate', function(e){
  if(!ACC || !P) return;
  var s = (e.state && e.state.s) || 'home';
  leaveReader();
  if(s === 'board' || s === 'lib' || s === 'mine' || s === 'settings'){ hs = s; show(s); go_render(s); }
  else { hs = 'home'; show('home'); renderHome(); }
});
function go_render(s){
  if(s === 'board') renderBoard(); else if(s === 'lib') renderLib(); else if(s === 'mine') renderMine(); else if(s === 'settings') renderSettings();
}
document.querySelectorAll('[data-back]').forEach(function(b){ b.addEventListener('click', toHome); });

/* ---------- หน้าหลัก ---------- */
var rankTxt = null;
function renderMe(){
  if(!P) return;
  $('meName').textContent = P.name;
  $('meTotal').textContent = P.total;
  $('meRank').textContent = 'อันดับ ' + (rankTxt ? '#' + rankTxt : '—');
  $('meLogin').textContent = 'เช็กอินวันที่ ' + (P.loginDay || 1) + '/10';
}
function refreshRank(){
  if(!ACC || !P) return;
  var sc = P.total;
  B.rankOf('total', sc).then(function(r){ rankTxt = r; renderMe(); }, function(){});
}
function starsFor(ratio){ return ratio >= 0.85 ? 3 : (ratio >= 0.55 ? 2 : (ratio > 0 ? 1 : 0)); }
function renderHome(){
  var award = dayTick();
  renderMe();
  var box = $('cats'); box.textContent = '';
  CATS.forEach(function(m){
    var st = catState(m.k);
    var d = el('div', 'cat l' + m.lv + (st.state === 'open' ? '' : ' closed'));
    var head = el('div', 'cat-head');
    head.appendChild(el('span', 'cat-name', m.n));
    head.appendChild(el('span', 'pill', P[m.sf] + ' คะแนน'));
    d.appendChild(head);
    d.appendChild(el('div', 'cat-desc', m.desc));
    var meter = el('div', 'meter'); meter.setAttribute('role', 'img');
    meter.setAttribute('aria-label', 'อ่านผ่านแล้ว ' + st.passed + ' จาก ' + st.total + ' เรื่อง');
    var bar = el('i'); bar.style.width = (st.total ? Math.round(st.passed * 100 / st.total) : 0) + '%'; meter.appendChild(bar);
    d.appendChild(meter);
    var foot = el('div', 'cat-foot');
    foot.appendChild(el('span', '', 'ผ่านแล้ว ' + st.passed + '/' + st.total + ' เรื่อง'));
    foot.appendChild(el('span', '', 'เรื่องใหม่วันนี้ ' + Math.min(st.used, NEW_PER_DAY) + '/' + NEW_PER_DAY));
    d.appendChild(foot);
    var note = '';
    if(st.state === 'open') note = 'เรื่องต่อไป: เรื่องที่ ' + (st.passed + 1);
    else if(st.state === 'locked') note = 'อ่านไม่ผ่านติดกัน ' + STRIKE_LIMIT + ' ครั้งแล้ว พักก่อนนะ พรุ่งนี้มาลองใหม่ (อ่านซ้ำเรื่องเก่าได้)';
    else if(st.state === 'quota') note = 'วันนี้อ่านเรื่องใหม่ครบ ' + NEW_PER_DAY + ' เรื่องแล้ว พรุ่งนี้มาอ่านต่อ (อ่านซ้ำเรื่องเก่าเพื่อเก็บคะแนนได้)';
    else note = 'อ่านครบทุกเรื่องในหมวดนี้แล้ว เก่งมาก! อ่านซ้ำเพื่อเก็บคะแนนให้เต็มได้';
    d.appendChild(el('div', 'cat-note', note));
    var row = el('div', 'row');
    var go1 = el('button', 'btn cat-go', st.state === 'open' ? 'เล่นเลย' : 'อ่านซ้ำเรื่องเก่า'); go1.type = 'button';
    go1.setAttribute('aria-label', (st.state === 'open' ? 'เล่นหมวด' : 'อ่านซ้ำเรื่องเก่าในหมวด') + m.n);
    go1.addEventListener('click', function(){ ensureAudio(); if(st.state === 'open') startNew(m.k); else openLib(m.k); });
    row.appendChild(go1);
    if(st.state === 'open' && st.passed > 0){
      var go2 = el('button', 'btn alt small', 'เรื่องที่อ่านแล้ว'); go2.type = 'button';
      go2.addEventListener('click', function(){ openLib(m.k); });
      row.appendChild(go2);
    }
    d.appendChild(row);
    box.appendChild(d);
  });
  renderNotices();
  refreshRank();
  if(award) showLoginModal(award);
}
function renderNotices(){
  var box = $('notices'); box.textContent = '';
  if(!SR){
    box.appendChild(el('div', 'notice', 'เบราว์เซอร์นี้ยังฟังเสียงพูดไม่ได้ จึงเป็นโหมดฝึก: อ่านได้ แต่ไม่มีคะแนนและไม่นับความคืบหน้า ถ้าอยากเล่นเก็บคะแนน ให้เปิดด้วย Chrome หรือ Edge (Android และคอมพิวเตอร์) หรือ Safari บน iPhone และ iPad'));
  }
}
setTimeout(function(){
  if(synth && synth.getVoices().length > 0 && !voice){
    $('notices').appendChild(el('div', 'notice', 'เครื่องนี้ยังไม่มีเสียงอ่านภาษาไทย อุ๋งอุ๋งอาจอ่านออกเสียงให้ไม่ได้ ลองเพิ่มเสียงภาษาไทยในการตั้งค่าการอ่านออกเสียงของเครื่อง'));
  }
}, 1500);

$('meRank').addEventListener('click', function(){ go('board'); });
$('meLogin').addEventListener('click', function(){ showLoginModal(null); });
$('goBoard').addEventListener('click', function(){ go('board'); });
$('goMine').addEventListener('click', function(){ go('mine'); });
$('goSet').addEventListener('click', function(){ go('settings'); });

/* ---------- หน้าต่างป๊อปอัป และปฏิทินเช็กอิน ---------- */
function closeModal(){ $('modalRoot').textContent = ''; }
function openModal(build){
  var root = $('modalRoot'); root.textContent = '';
  var ov = el('div', 'overlay'), sh = el('div', 'sheet');
  ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
  build(sh);
  ov.appendChild(sh); root.appendChild(ov);
  var f = sh.querySelector('button'); if(f) f.focus({preventScroll:true});
}
function showLoginModal(award){
  openModal(function(sh){
    var slot = el('div', 'mascot-slot'); slot.innerHTML = SEAL; sh.appendChild(slot);
    var day = P.loginDay || 1;
    if(award){
      sh.appendChild(el('h2', '', 'ยินดีต้อนรับ ' + P.name + '!'));
      sh.appendChild(el('div', 'big-plus', '+' + award.pts));
      sh.appendChild(el('p', 'res-note', 'คะแนนเช็กอินวันที่ ' + award.day + ' จาก 10'));
      ensureAudio(); sfx.win();
    }else{
      sh.appendChild(el('h2', '', 'ปฏิทินคะแนนเช็กอิน'));
      sh.appendChild(el('p', 'res-note', 'วันนี้เป็นวันที่ ' + day + ' จาก 10 (ได้รับคะแนนของวันนี้แล้ว)'));
    }
    var cal = el('div', 'cal');
    LOGIN_PTS.forEach(function(p, i){
      var d = el('div', 'day' + (i + 1 < day ? ' done' : '') + (i + 1 === day ? ' cur' : '') + (p >= 30 ? ' big' : ''));
      d.appendChild(el('span', '', 'วันที่ ' + (i + 1)));
      d.appendChild(el('b', '', '+' + p));
      cal.appendChild(d);
    });
    sh.appendChild(cal);
    sh.appendChild(el('p', 'res-note', 'พรุ่งนี้เช็กอินได้ +' + LOGIN_PTS[day % 10] + ' คะแนน ครบ 10 วันแล้วเริ่มวนวันที่ 1 ใหม่ ไม่มีวันหมด'));
    var ok = el('button', 'btn', award ? 'เริ่มเล่น' : 'ปิด'); ok.type = 'button';
    ok.addEventListener('click', closeModal);
    sh.appendChild(ok);
  });
}

/* ---------- เริ่มอ่าน ---------- */
function startNew(c){
  var st = catState(c);
  if(st.state !== 'open'){ openLib(c); return; }
  beginAttempt(c, st.passed, true);
}
function beginAttempt(c, i, isNew){
  var s = getStory(c, i);
  cur = {cat:c, idx:i, isNew:isNew, custom:false, scored:!!SR};
  $('rTitle').textContent = (isNew ? 'เรื่องที่ ' + (i + 1) : s.title);
  beginReading(s);
  renderSub();
}
function beginPractice(s){
  cur = {cat:null, idx:-1, isNew:false, custom:true, scored:false};
  $('rTitle').textContent = s.title;
  beginReading(s);
  renderSub();
}
var HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.4-9.2C1.3 8.6 3.2 5 6.6 5c2 0 3.6 1.1 5.4 3.2C13.800 6.100 15.400 5 17.400 5c3.400 0 5.300 3.600 4 6.800C19.500 16.400 12 21 12 21z" fill="FILL" stroke="STROKE" stroke-width="1.6" stroke-linejoin="round"/></svg>';
function renderSub(){
  var e = $('rSub'); e.textContent = '';
  if(cur.custom){ e.textContent = 'ฝึกอ่าน ไม่มีคะแนน'; return; }
  if(!SR){ e.textContent = 'โหมดฝึก ไม่มีคะแนน'; return; }
  if(!cur.isNew){ e.textContent = 'อ่านซ้ำเก็บคะแนน'; return; }
  var left = STRIKE_LIMIT - strikesOf(cur.cat), html = 'โอกาส ';
  for(var i = 0; i < STRIKE_LIMIT; i++) html += HEART.replace('FILL', i < left ? '#E8505B' : '#fff').replace('STROKE', i < left ? '#C23A44' : '#C3CAEC');
  e.innerHTML = html;
  e.setAttribute('aria-label', 'เหลือโอกาส ' + left + ' ครั้ง');
}

/* ---------- จบเรื่อง ให้คะแนน ---------- */
function starSVG(on){
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8L12 2.5z" fill="' + (on ? '#FFC63B' : '#D6DCF6') + '" stroke="' + (on ? '#D9A21A' : '#C3CAEC') + '" stroke-width="1.2" stroke-linejoin="round"/></svg>';
}
function starsHTML(n){ var s = ''; for(var i = 1; i <= 3; i++) s += starSVG(i <= n); return s; }
function btn(label, cls, fn){ var b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', fn); return b; }

function finishStory(){
  stopListening(); busy = false;
  var acc = stats.total ? stats.clean / stats.total : 0;
  var pass = acc >= PASS_ACC, stars = pass ? Math.max(1, starsFor(acc)) : 0;
  var title, pts = 0, gain = 0, note = '', max = 0, btns = [], mood = 'happy';
  if(!cur.scored){
    title = pass ? 'อ่านจบแล้ว เก่งมาก' : 'อ่านจบแล้ว ลองอีกครั้งนะ';
    note = cur.custom ? 'นิทานของเราใช้ฝึกอ่าน ไม่มีคะแนน' : 'โหมดฝึก (เบราว์เซอร์นี้ฟังเสียงไม่ได้) ไม่มีคะแนน';
    btns.push(btn('อ่านเรื่องนี้อีกครั้ง', 'btn', function(){ if(cur.custom) beginPractice(story); else beginAttempt(cur.cat, cur.idx, false); }));
    btns.push(btn('กลับ', 'btn alt', function(){ cur.custom ? go('mine') : toHome(); }));
  }else{
    var m = CAT[cur.cat]; max = m.max;
    pts = pass ? Math.max(1, Math.round(m.max * acc)) : 0;
    var old = getBest(cur.cat, cur.idx);
    gain = Math.max(0, pts - old);
    if(gain > 0){ setBest(cur.cat, cur.idx, pts); P[m.sf] += gain; }
    if(cur.isNew){
      if(pass){
        if(cur.idx >= P[m.pf]){ P[m.tf]++; P[m.pf] = cur.idx + 1; }
        setStrikes(cur.cat, 0);
      }else{
        var n = strikesOf(cur.cat) + 1; setStrikes(cur.cat, n);
        if(n >= STRIKE_LIMIT && P.lk.indexOf(cur.cat) < 0) P.lk += cur.cat;
      }
    }
    commit();
    var st = catState(cur.cat);
    if(pass){
      title = acc >= 0.85 ? 'อ่านเก่งมาก!' : (acc >= 0.55 ? 'อ่านได้ดีมาก' : 'ผ่านแล้ว เก่งมาก');
      if(cur.isNew){
        if(st.state === 'open'){
          note = 'ผ่านแล้ว! ไปเรื่องต่อไปกันเลย';
          btns.push(btn('เรื่องต่อไป', 'btn', function(){ ensureAudio(); startNew(cur.cat); }));
        }else if(st.state === 'quota'){
          note = 'วันนี้อ่านเรื่องใหม่ครบ ' + NEW_PER_DAY + ' เรื่องแล้ว พรุ่งนี้มาอ่านเรื่องต่อไปนะ';
        }else if(st.state === 'done'){
          note = 'อ่านครบทุกเรื่องในหมวด' + m.n + 'แล้ว เก่งที่สุดเลย!';
        }
      }else{
        note = gain > 0 ? 'คะแนนเรื่องนี้สูงขึ้นแล้ว!' : (pts >= m.max ? 'ได้คะแนนเต็มเรื่องนี้แล้ว' : 'ยังไม่สูงกว่าคะแนนเดิม ลองอ่านให้ถูกตั้งแต่ครั้งแรกดูนะ');
      }
    }else{
      title = 'ยังไม่ผ่าน ลองอีกครั้งนะ'; mood = 'oops';
      if(cur.isNew){
        if(st.state === 'locked') note = 'ไม่ผ่านติดกัน ' + STRIKE_LIMIT + ' ครั้งแล้ว พักก่อนนะ พรุ่งนี้มาลองเรื่องนี้ใหม่';
        else note = 'ต้องอ่านถูกตั้งแต่ครั้งแรกอย่างน้อย ' + Math.round(PASS_ACC * 100) + '% จึงจะผ่าน (เหลือโอกาสอีก ' + (STRIKE_LIMIT - strikesOf(cur.cat)) + ' ครั้ง)';
        if(st.state !== 'locked') btns.push(btn('ลองอีกครั้ง', 'btn', function(){ ensureAudio(); beginAttempt(cur.cat, cur.idx, true); }));
      }else note = 'ต้องอ่านถูกตั้งแต่ครั้งแรกอย่างน้อย ' + Math.round(PASS_ACC * 100) + '% จึงจะได้คะแนน';
    }
    if(!cur.isNew){
      btns.push(btn('อ่านเรื่องนี้อีกครั้ง', 'btn', function(){ ensureAudio(); beginAttempt(cur.cat, cur.idx, false); }));
      btns.push(btn('เลือกเรื่องอื่น', 'btn alt', function(){ openLib(cur.cat); }));
    }
    btns.push(btn('กลับหน้าหลัก', 'btn alt', toHome));
  }
  $('resTitle').textContent = title;
  $('resStars').innerHTML = starsHTML(stars);
  $('resStars').setAttribute('aria-label', stars + ' ดาว จาก 3 ดาว');
  var pe = $('resPts');
  if(cur.scored){
    pe.hidden = false;
    pe.className = 'pts-big' + (gain > 0 ? '' : ' zero');
    pe.textContent = gain > 0 ? '+' + gain + ' คะแนน' : (pass ? 'ได้ ' + pts + '/' + max + ' คะแนน' : 'ไม่ได้คะแนน');
  }else pe.hidden = true;
  $('resNote').textContent = note;
  $('stOk').textContent = stats.ok; $('stHelp').textContent = stats.help; $('stWrong').textContent = stats.wrong;
  var pr = $('practice'); pr.textContent = '';
  stats.practice.forEach(function(w){
    var c = el('button', 'chip', w); c.type = 'button';
    c.addEventListener('click', function(){ ensureAudio(); say(w, 0.7); });
    pr.appendChild(c);
  });
  $('practiceBox').hidden = stats.practice.size === 0;
  var rb = $('resBtns'); rb.textContent = '';
  btns.forEach(function(b){ rb.appendChild(b); });
  go('result');
  setMood(mood, 0); if(pass) sfx.win(); else sfx.oops();
}

/* ---------- เรื่องที่อ่านแล้ว (เล่นซ้ำเก็บคะแนน) ---------- */
var lib = {cat:'e', q:'', page:0}, PAGE = 20, hay = {};
function openLib(c){ lib.cat = c; lib.q = ''; lib.page = 0; $('q').value = ''; go('lib'); }
function hayOf(c, i){
  var k = c + i;
  if(hay[k] === undefined){ var r = list(c)[i]; hay[k] = norm(r[0] + r[1].replace(/[|\/]/g, '')); }
  return hay[k];
}
function renderTabs(boxId, items, curKey, onPick){
  var box = $(boxId); box.textContent = '';
  items.forEach(function(it){
    var b = el('button', 'tab', it[1]); b.type = 'button'; b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(curKey === it[0]));
    b.addEventListener('click', function(){ onPick(it[0]); });
    box.appendChild(b);
  });
}
function renderLib(){
  renderTabs('libTabs', CATS.map(function(m){ return [m.k, m.n]; }), lib.cat, function(k){ lib.cat = k; lib.page = 0; renderLib(); });
  var m = CAT[lib.cat], passed = Math.min(P[m.pf], list(lib.cat).length), q = norm(lib.q), idxs = [], i;
  for(i = 0; i < passed; i++){ if(!q || hayOf(lib.cat, i).indexOf(q) >= 0) idxs.push(i); }
  var pages = Math.max(1, Math.ceil(idxs.length / PAGE));
  if(lib.page >= pages) lib.page = pages - 1;
  $('libInfo').textContent = passed ? ('อ่านผ่านแล้ว ' + passed + ' เรื่อง' + (q ? ' · พบ ' + idxs.length + ' เรื่อง' : '') + ' · แตะเรื่องที่ต้องการเพื่ออ่านซ้ำและเก็บคะแนนให้สูงขึ้น') : '';
  $('qClr').hidden = !lib.q;
  var ul = $('libList'); ul.textContent = '';
  idxs.slice(lib.page * PAGE, lib.page * PAGE + PAGE).forEach(function(i){
    var r = list(lib.cat)[i], best = getBest(lib.cat, i);
    var li = el('li'), b = el('button', 'story'); b.type = 'button';
    b.appendChild(el('span', 's-title', (i + 1) + '. ' + r[0]));
    var meta = el('span', 's-meta');
    meta.appendChild(el('span', '', 'คะแนนสูงสุด ' + best + '/' + m.max));
    var stars = el('span', 'stars'); stars.innerHTML = starsHTML(starsFor(best / m.max));
    meta.appendChild(stars); b.appendChild(meta);
    b.addEventListener('click', function(){ ensureAudio(); beginAttempt(lib.cat, i, false); });
    li.appendChild(b); ul.appendChild(li);
  });
  if(!idxs.length){
    var e = el('li', 'empty');
    e.appendChild(el('p', '', q ? 'ไม่พบนิทานที่ตรงกับ “' + lib.q.trim() + '”' : 'ยังไม่มีเรื่องที่อ่านผ่านในหมวด' + m.n + ' กลับไปเล่นเรื่องแรกก่อนนะ'));
    ul.appendChild(e);
  }
  $('pager').hidden = pages <= 1;
  $('pgInfo').textContent = 'หน้า ' + (lib.page + 1) + '/' + pages;
  $('pgPrev').disabled = lib.page <= 0; $('pgNext').disabled = lib.page >= pages - 1;
}
$('pgPrev').addEventListener('click', function(){ if(lib.page > 0){ lib.page--; renderLib(); window.scrollTo(0, 0); } });
$('pgNext').addEventListener('click', function(){ lib.page++; renderLib(); window.scrollTo(0, 0); });
$('q').addEventListener('input', function(){ lib.q = this.value; lib.page = 0; renderLib(); });
$('qClr').addEventListener('click', function(){ lib.q = ''; $('q').value = ''; lib.page = 0; renderLib(); $('q').focus(); });

/* ---------- ตารางอันดับ ---------- */
var BOARDS = [['total', 'รวม'], ['s1', 'ง่าย'], ['s2', 'ท้าทาย'], ['s3', 'ศัพท์ยาก']];
var boardField = 'total', boardSeq = 0;
function renderBoard(){
  renderTabs('boardTabs', BOARDS, boardField, function(k){ boardField = k; renderBoard(); });
  var box = $('boardList'), seq = ++boardSeq, f = boardField;
  box.textContent = ''; box.appendChild(el('p', 'hint', 'กำลังโหลดอันดับ…'));
  $('boardNote').textContent = B.mode === 'demo' ? 'โหมดทดลอง: อันดับนี้มีผู้เล่นตัวอย่างและตัวเองเท่านั้น' : (f === 'total' ? 'คะแนนรวม = คะแนนอ่านทุกหมวด + คะแนนเช็กอิน' : 'คะแนนการอ่านเฉพาะหมวดนี้ (ไม่รวมคะแนนเช็กอิน)');
  syncNow().then(function(){ return B.leaderboard(f, 50); }).then(function(rows){
    if(seq !== boardSeq) return;
    box.textContent = '';
    var mine = false;
    rows.forEach(function(r, i){
      var isMe = ACC && r.uid === ACC.uid; if(isMe) mine = true;
      box.appendChild(boardRow(i + 1, r.name, r.score, isMe, r.sample));
    });
    if(!rows.length) box.appendChild(el('p', 'hint', 'ยังไม่มีใครในอันดับ'));
    if(!mine){
      var myScore = f === 'total' ? P.total : P[f];
      B.rankOf(f, myScore).then(function(rk){
        if(seq !== boardSeq) return;
        box.appendChild(el('p', 'hint', '· · ·'));
        box.appendChild(boardRow(rk || '—', P.name, myScore, true, false));
      }, function(){});
    }
  }, function(e){
    if(seq !== boardSeq) return;
    box.textContent = '';
    box.appendChild(el('p', 'hint warn', 'โหลดอันดับไม่ได้: ' + B.errorText(e)));
    box.appendChild(btn('ลองใหม่', 'btn alt small', renderBoard));
  });
}
function boardRow(rank, name, score, isMe, sample){
  var r = el('div', 'rrow' + (isMe ? ' me' : ''));
  r.appendChild(el('span', 'rk' + (rank <= 3 ? ' r' + rank : ''), String(rank)));
  var n = el('span', 'rn', name); if(sample) n.appendChild(el('small', '', ' (ตัวอย่าง)')); if(isMe) n.appendChild(el('small', '', ' (เรา)'));
  r.appendChild(n);
  r.appendChild(el('span', 'rs', String(score)));
  return r;
}

/* ---------- ตั้งค่า ---------- */
function renderSettings(){
  $('slowSel').value = String(save.slow);
  $('setAcct').textContent = 'ชื่อน้อง: ' + P.name + ' · อีเมล: ' + ((ACC && ACC.email) || '-');
  $('nameEdit').value = P.name; $('nameMsg').textContent = '';
  $('syncInfo').textContent = syncMsg || (B.mode === 'demo' ? 'โหมดทดลอง: เก็บคะแนนไว้ในเครื่องนี้' : '');
}
$('slowSel').addEventListener('change', function(){ save.slow = Number(this.value) || 3; persist(); });
$('nameSave').addEventListener('click', function(){
  var n = $('nameEdit').value.replace(/\s+/g, ' ').trim().slice(0, 20), m = $('nameMsg');
  if(!n){ m.className = 'msg err'; m.textContent = 'กรุณาใส่ชื่อ'; return; }
  P.name = n; commit(); m.className = 'msg good'; m.textContent = 'บันทึกแล้ว';
  $('setAcct').textContent = 'ชื่อน้อง: ' + P.name + ' · อีเมล: ' + ((ACC && ACC.email) || '-');
});
$('logoutBtn').addEventListener('click', function(){
  if(!window.confirm('ออกจากระบบใช่ไหม?')) return;
  var b = this; b.disabled = true;
  syncNow().then(function(){ return B.signOut(); }).then(function(){ b.disabled = false; toAuth(); });
});
$('delBtn').addEventListener('click', function(){
  if(!window.confirm('ลบบัญชีและคะแนนทั้งหมดถาวร กู้คืนไม่ได้ ต้องการลบใช่ไหม?')) return;
  var b = this, m = $('nameMsg'); b.disabled = true;
  B.deleteAccount(ACC.uid).then(function(){
    LS.del(pkey()); b.disabled = false; ACC = null; P = null; dirty = false; toAuth();
  }, function(e){
    b.disabled = false; m.className = 'msg err';
    m.textContent = 'ลบบัญชีไม่สำเร็จ: ' + B.errorText(e) + ' (ลองออกจากระบบ เข้าสู่ระบบใหม่ แล้วลบอีกครั้ง)';
  });
});

/* ---------- สมัคร / เข้าสู่ระบบ / ลืมรหัสผ่าน ---------- */
function authTab(which){
  $('loginForm').hidden = which !== 'login'; $('regForm').hidden = which !== 'reg'; $('forgotForm').hidden = which !== 'forgot';
  $('tabLogin').setAttribute('aria-selected', String(which === 'login'));
  $('tabReg').setAttribute('aria-selected', String(which === 'reg'));
  ['lMsg', 'rMsg', 'fMsg'].forEach(function(id){ $(id).textContent = ''; $(id).className = 'msg'; });
}
function amsg(id, t, good){ var e = $(id); e.textContent = t; e.className = 'msg ' + (good ? 'good' : 'err'); }
function toAuth(){
  P = null; ACC = null; rankTxt = null; syncMsg = '';
  $('demoBanner').hidden = B.mode !== 'demo';
  $('lPass').value = ''; $('rPass').value = '';
  authTab('login');
  try{ history.replaceState({s:'home'}, ''); }catch(e){}
  hs = 'home';
  show('auth');
}
$('tabLogin').addEventListener('click', function(){ authTab('login'); });
$('tabReg').addEventListener('click', function(){ authTab('reg'); });
$('forgotLink').addEventListener('click', function(){ authTab('forgot'); $('fEmail').value = $('lEmail').value; });
$('forgotBack').addEventListener('click', function(){ authTab('login'); });
$('lShow').addEventListener('change', function(){ $('lPass').type = this.checked ? 'text' : 'password'; });
$('rShow').addEventListener('change', function(){ $('rPass').type = this.checked ? 'text' : 'password'; });

function busyBtn(id, on, label){ var b = $(id); b.disabled = on; if(label) b.textContent = label; }
$('loginForm').addEventListener('submit', function(e){
  e.preventDefault();
  var email = $('lEmail').value.trim(), pw = $('lPass').value;
  if(!email || !pw){ amsg('lMsg', 'กรุณาใส่อีเมลและรหัสผ่าน'); return; }
  busyBtn('lBtn', true, 'กำลังเข้าสู่ระบบ…'); amsg('lMsg', '', true);
  B.signIn({email:email, password:pw}).then(function(s){
    busyBtn('lBtn', false, 'เข้าสู่ระบบ'); return enter(s, null);
  }, function(er){ busyBtn('lBtn', false, 'เข้าสู่ระบบ'); amsg('lMsg', B.errorText(er)); });
});
$('regForm').addEventListener('submit', function(e){
  e.preventDefault();
  var name = $('rName').value.replace(/\s+/g, ' ').trim().slice(0, 20), email = $('rEmail').value.trim(), pw = $('rPass').value;
  if(!name){ amsg('rMsg', 'กรุณาใส่ชื่อน้อง'); return; }
  if(!email){ amsg('rMsg', 'กรุณาใส่อีเมลของผู้ปกครอง'); return; }
  if(pw.length < 6){ amsg('rMsg', 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'); return; }
  if(!$('rOk').checked){ amsg('rMsg', 'กรุณาติ๊กยืนยันว่าสมัครโดยผู้ปกครอง หรือมีผู้ปกครองอยู่ด้วย'); return; }
  busyBtn('rBtn', true, 'กำลังสมัคร…'); amsg('rMsg', '', true);
  B.signUp({email:email, password:pw}).then(function(s){
    busyBtn('rBtn', false, 'สมัครและเริ่มเล่น'); return enter(s, name);
  }, function(er){ busyBtn('rBtn', false, 'สมัครและเริ่มเล่น'); amsg('rMsg', B.errorText(er)); });
});
$('forgotForm').addEventListener('submit', function(e){
  e.preventDefault();
  var email = $('fEmail').value.trim();
  if(!email){ amsg('fMsg', 'กรุณาใส่อีเมล'); return; }
  busyBtn('fBtn', true, 'กำลังส่ง…'); amsg('fMsg', '', true);
  B.resetPassword(email).then(function(){
    busyBtn('fBtn', false, 'ส่งอีเมลตั้งรหัสผ่านใหม่');
    amsg('fMsg', B.mode === 'demo' ? 'โหมดทดลอง: ยังไม่ได้ส่งอีเมลจริง (เมื่อตั้งค่า Firebase แล้วจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้)' : 'ส่งอีเมลแล้ว ตรวจกล่องจดหมาย (และกล่องจดหมายขยะ) แล้วกดลิงก์เพื่อตั้งรหัสผ่านใหม่', true);
  }, function(er){
    busyBtn('fBtn', false, 'ส่งอีเมลตั้งรหัสผ่านใหม่');
    amsg('fMsg', er && er.code === 'EMAIL_NOT_FOUND' ? 'ไม่พบอีเมลนี้ในระบบ' : B.errorText(er));
  });
});

// เข้าระบบแล้ว: รวมข้อมูลบนระบบกับในเครื่อง แล้วเปิดหน้าหลัก
function enter(s, newName){
  ACC = s;
  var loc = LS.get(pkey(), null), localP = loc && loc.p ? clean(loc.p) : null;
  $('bootMsg').textContent = 'กำลังโหลดคะแนน…'; show('boot');
  return B.loadProfile(s.uid).then(function(cloud){
    if(cloud && localP){ P = merge(cloud, localP); dirty = true; }
    else if(cloud){ P = clean(cloud); dirty = false; }
    else if(localP){ P = localP; dirty = true; }
    else { P = blank(newName || 'น้อง'); dirty = true; }
    P.upd = Math.max(P.upd, 1);
    start();
  }, function(er){
    if(localP){ P = localP; dirty = true; start(); setSync('ต่อระบบไม่ได้ ใช้ข้อมูลในเครื่องไปก่อน แล้วจะซิงก์ให้ภายหลัง'); }
    else {
      ACC = null; toAuth();
      amsg('lMsg', 'เข้าสู่ระบบแล้ว แต่โหลดข้อมูลไม่ได้ (' + B.errorText(er) + ') ลองใหม่อีกครั้ง');
    }
  });
}
function start(){
  saveLocal();
  try{ history.replaceState({s:'home'}, ''); }catch(e){}
  hs = 'home';
  show('home');
  renderHome();       // เช็กอินรายวัน + แสดงหมวด
  if(dirty) syncNow();
}

/* ---------- ปุ่มในหน้าอ่าน ---------- */
$('micBtn').addEventListener('click', function(){
  ensureAudio();
  if(!SR){
    if(pos < words.length && !busy){
      markOk(pos); pos++; flashWrong = -1; paintWords();
      if(pos >= words.length) sentenceDone();
    }
    return;
  }
  if(listening){ stopListening(); bubble('พักก่อนนะ กดไมค์เมื่ออยากอ่านต่อ'); }
  else { startListening(); bubble('อุ๋งอุ๋งฟังอยู่นะ อ่านออกเสียงได้เลย'); }
});
$('helpBtn').addEventListener('click', function(){ ensureAudio(); helpWord(pos, 'tap'); });
$('hearBtn').addEventListener('click', async function(){
  ensureAudio();
  if(busy || !words.length) return;
  busy = true; bubble('ฟังอุ๋งอุ๋งอ่านก่อนนะ');
  await say(words.join(' '), 0.75);
  busy = false;
  bubble(listening ? 'ถึงตาหนูแล้ว อ่านเลย' : 'ถึงตาหนูแล้ว กดไมค์เพื่ออ่านตาม');
});
$('restartBtn').addEventListener('click', function(){ ensureAudio(); restartSentence(); });
$('backBtn').addEventListener('click', function(){
  var c = cur && cur.custom ? 'mine' : 'home';
  leaveReader();
  if(c === 'mine') go('mine'); else toHome();
});


/* ---- เพิ่มนิทาน: ตัวอย่างการตัดประโยค ---- */
var prevTimer = null;
function updatePreview(){
  var s = parseText($('cText').value), box = $('prevBox');
  if(!s.length){ box.hidden = true; return; }
  var nw = s.reduce(function(a, x){ return a + x.length; }, 0);
  $('prevInfo').textContent = s.length + ' ประโยค · ' + nw + ' คำ · แนะนำระดับ ' + LEVELS[levelOf(s)].name;
  var ol = $('prevList'); ol.textContent = '';
  s.slice(0, 6).forEach(function(a){ ol.appendChild(el('li', '', a.join(' · '))); });
  if(s.length > 6) ol.appendChild(el('li', 'more', '… และอีก ' + (s.length - 6) + ' ประโยค'));
  box.hidden = false;
}
$('cText').addEventListener('input', function(){ clearTimeout(prevTimer); prevTimer = setTimeout(updatePreview, 250); });
$('noSeg').hidden = !!SEG;

/* ---- เพิ่มนิทานจากรูป: ถอดตัวหนังสือด้วย Tesseract.js (ภาษาไทย) ---- */
var TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
var tessLoading = null;
function loadTesseract(){
  if(window.Tesseract) return Promise.resolve(window.Tesseract);
  if(tessLoading) return tessLoading;
  tessLoading = new Promise(function(res, rej){
    var s = document.createElement('script');
    s.src = TESS_URL; s.async = true;
    s.onload = function(){ window.Tesseract ? res(window.Tesseract) : (tessLoading = null, rej(new Error('load'))); };
    s.onerror = function(){ tessLoading = null; rej(new Error('offline')); };
    document.head.appendChild(s);
  });
  return tessLoading;
}
function prepImage(file){          // ย่อรูป ทำเป็นขาวดำ และเพิ่มความคมชัดให้ตัวหนังสืออ่านง่ายขึ้น
  return new Promise(function(res, rej){
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function(){
      try{
        var sc = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
        var w = Math.max(1, Math.round(img.naturalWidth * sc)), h = Math.max(1, Math.round(img.naturalHeight * sc));
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        var x = c.getContext('2d'); x.drawImage(img, 0, 0, w, h);
        var tc = document.createElement('canvas'), ts = Math.min(1, 128 / Math.max(w, h));
        tc.width = Math.max(1, Math.round(w * ts)); tc.height = Math.max(1, Math.round(h * ts));
        tc.getContext('2d').drawImage(c, 0, 0, tc.width, tc.height);
        var d = x.getImageData(0, 0, w, h), p = d.data, lo = 255, hi = 0, i, g;
        for(i = 0; i < p.length; i += 4){
          g = (p[i] * 0.299 + p[i+1] * 0.587 + p[i+2] * 0.114) | 0;
          p[i] = p[i+1] = p[i+2] = g;
          if(g < lo) lo = g; if(g > hi) hi = g;
        }
        var rng = Math.max(1, hi - lo);
        for(i = 0; i < p.length; i += 4){ g = ((p[i] - lo) * 255 / rng) | 0; p[i] = p[i+1] = p[i+2] = g; }
        x.putImageData(d, 0, 0);
        URL.revokeObjectURL(url);
        res({canvas:c, thumb:tc.toDataURL('image/jpeg', 0.6)});
      }catch(e){ URL.revokeObjectURL(url); rej(e); }
    };
    img.onerror = function(){ URL.revokeObjectURL(url); rej(new Error('img')); };
    img.src = url;
  });
}
function cleanOcr(t){            // ตัวอ่านภาษาไทยมักใส่ช่องว่างแทรกกลางคำ จึงเอาช่องว่างระหว่างอักษรไทยออก และเก็บการขึ้นบรรทัดใหม่ตามหนังสือ
  t = String(t || '').replace(/\r/g, '').normalize('NFC')
    .replace(/[|_~`^<>{}\[\]\\]/g, ' ');
  var lines = t.split('\n').map(function(s){
    s = s.replace(/[ \t]+/g, ' ').trim();
    var prev;
    do{ prev = s; s = s.replace(/([\u0E00-\u0E7F]) ([\u0E00-\u0E7F])/g, '$1$2'); }while(s !== prev);
    return s;
  }).filter(function(s){ return norm(s).length >= 2 && !/^\d{1,3}$/.test(s); });
  return lines.join('\n');
}
function scanMsg(t, warn){ var m = $('scanMsg'); m.textContent = t; m.classList.toggle('warn', !!warn); }
function scanBusy(b){ $('camBtn').disabled = b; $('galBtn').disabled = b; }
function onTessLog(m){
  var pr = $('scanProg');
  if(m && m.status === 'recognizing text'){
    var pct = Math.round((m.progress || 0) * 100);
    pr.value = pct; scanMsg('กำลังอ่านตัวหนังสือ ' + pct + '%');
  }else if(m && /loading|initializ/.test(m.status || '')){
    pr.removeAttribute('value'); scanMsg('กำลังโหลดตัวอ่านภาษาไทย ครั้งแรกอาจใช้เวลาสักครู่');
  }
}
async function scanFile(file){
  if(!file) return;
  scanBusy(true);
  $('scanBox').hidden = false; $('scanProg').hidden = false; $('scanProg').value = 0;
  scanMsg('กำลังเตรียมรูป…');
  var pre, T, worker = null;
  try{
    try{ pre = await prepImage(file); }
    catch(e){ scanMsg('เปิดรูปนี้ไม่ได้ ลองถ่ายหรือเลือกรูปใหม่', true); $('scanProg').hidden = true; return; }
    $('scanThumb').src = pre.thumb;
    try{ $('scanProg').removeAttribute('value'); scanMsg('กำลังโหลดตัวอ่านภาษาไทย…'); T = await loadTesseract(); }
    catch(e){ scanMsg('ต้องต่ออินเทอร์เน็ตเพื่ออ่านตัวหนังสือจากรูป ถ้าไม่มีเน็ตให้พิมพ์หรือวางข้อความแทน', true); $('scanProg').hidden = true; return; }
    worker = await T.createWorker('tha', 1, {logger: onTessLog});
    var r = await worker.recognize(pre.canvas);
    var text = cleanOcr(r && r.data && r.data.text);
    $('scanProg').hidden = true;
    if(!text){ scanMsg('ไม่พบตัวหนังสือในรูป ลองถ่ายใหม่ให้ใกล้และสว่างขึ้น', true); return; }
    var ta = $('cText');
    ta.value = ta.value.trim() ? ta.value.replace(/\s+$/, '') + '\n' + text : text;
    updatePreview();
    scanMsg('อ่านเสร็จแล้ว ตรวจและแก้ข้อความด้านล่างให้ถูกต้องก่อนบันทึก');
    ta.focus({preventScroll:true});
  }catch(e){
    $('scanProg').hidden = true;
    scanMsg('อ่านตัวหนังสือจากรูปไม่สำเร็จ ลองใหม่อีกครั้ง หรือพิมพ์ข้อความแทน', true);
  }finally{
    if(worker){ try{ await worker.terminate(); }catch(_){} }
    scanBusy(false);
  }
}
$('camBtn').addEventListener('click', function(){ $('camInput').click(); });
$('galBtn').addEventListener('click', function(){ $('galInput').click(); });
['camInput', 'galInput'].forEach(function(id){
  $(id).addEventListener('change', function(){
    var f = this.files && this.files[0]; this.value = ''; scanFile(f);
  });
});

$('addForm').addEventListener('submit', function(e){
  e.preventDefault();
  var title = $('cTitle').value.trim() || 'นิทานของเรา';
  var sentences = parseText($('cText').value);
  var msg = $('addMsg');
  if(!sentences.length){ msg.classList.add('warn'); msg.textContent = 'กรุณาพิมพ์หรือวางเนื้อเรื่องอย่างน้อย 1 ประโยค'; return; }
  var sel = $('cLevel').value, level = sel === 'auto' ? levelOf(sentences) : Number(sel);
  save.custom.push({id:'c' + Date.now(), title:title, level:level, sentences:sentences});
  persist();
  $('cTitle').value = ''; $('cText').value = ''; $('cLevel').value = 'auto';
  $('prevBox').hidden = true; $('scanBox').hidden = true;
  msg.classList.remove('warn'); msg.textContent = 'บันทึกแล้ว เป็นระดับ “' + LEVELS[level].name + '” อยู่ในรายการด้านบน';
  renderMine();
});
function renderMine(){
  var ul = $('mineList'); ul.textContent = '';
  var cs = allCustom();
  cs.forEach(function(st){
    var li = el('li'), b = el('button', 'story'); b.type = 'button';
    b.appendChild(el('span', 's-title', st.title));
    var meta = el('span', 's-meta');
    var lb = el('span', 'lv l' + st.level, LEVELS[st.level].name); meta.appendChild(lb);
    meta.appendChild(el('span', '', st.sentences.length + ' ประโยค'));
    b.appendChild(meta);
    b.addEventListener('click', function(){ ensureAudio(); beginPractice(st); });
    li.appendChild(b);
    var d = el('button', 'del', 'ลบ'); d.type = 'button';
    d.setAttribute('aria-label', 'ลบนิทาน ' + st.title);
    d.addEventListener('click', function(){
      if(!window.confirm('ลบนิทาน “' + st.title + '” ใช่ไหม?')) return;
      save.custom = save.custom.filter(function(c){ return c.id !== st.id; });
      persist(); renderMine();
    });
    li.appendChild(d); ul.appendChild(li);
  });
  if(!cs.length){
    var e = el('li', 'empty'); e.appendChild(el('p', '', 'ยังไม่มีนิทานที่เพิ่มเอง')); ul.appendChild(e);
  }
}

document.addEventListener('visibilitychange', function(){
  if(document.hidden){
    if(listening){ stopListening(); bubble('พักก่อนนะ กดไมค์เมื่ออยากอ่านต่อ'); }
  }else if(ACC && P){
    if(hs === 'home'){ renderHome(); }
    if(dirty) syncNow();
  }
});
window.addEventListener('online', function(){ if(dirty) syncNow(); });

window.__t = {parseText:parseText, levelOf:levelOf, cleanOcr:cleanOcr, get P(){ return P; }, merge:merge, clean:clean, today:today, catState:catState};

/* ============ เริ่มต้น ============ */
$('noSeg').hidden = !!SEG;
try{ history.replaceState({s:'home'}, ''); }catch(e){}
B.restore().then(function(s){ if(s) return enter(s, null); toAuth(); }, function(){ toAuth(); });
})();
