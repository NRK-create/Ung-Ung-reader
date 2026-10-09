/* บริการสมาชิกและอันดับ
   - ถ้าใส่ค่าใน firebase-config.js จะใช้ Firebase จริง (สมัคร เข้าสู่ระบบ ส่งอีเมลรีเซ็ตรหัสผ่าน เก็บคะแนน อันดับรวมของทุกคน)
   - ถ้ายังไม่ใส่ จะเป็น "โหมดทดลอง" ข้อมูลอยู่ในเครื่องนี้เท่านั้น ไม่ส่งอีเมลจริง และมีผู้เล่นตัวอย่างให้ดูหน้าอันดับ */
(function(){
'use strict';
var CFG = window.FIREBASE_CONFIG || {};
var REAL = !!(CFG.apiKey && CFG.projectId);

var LS = {
  get: function(k, d){ try{ var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set: function(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} },
  del: function(k){ try{ localStorage.removeItem(k); }catch(e){} }
};
function fail(code, msg){ var e = new Error(msg || code); e.code = code; return e; }
function normEmail(s){ return String(s || '').trim().toLowerCase(); }
function okEmail(s){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

var MSG = {
  EMAIL_EXISTS: 'อีเมลนี้สมัครไว้แล้ว ลองเข้าสู่ระบบ หรือกด “ลืมรหัสผ่าน”',
  INVALID_LOGIN_CREDENTIALS: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
  INVALID_PASSWORD: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
  EMAIL_NOT_FOUND: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
  USER_DISABLED: 'บัญชีนี้ถูกปิดการใช้งาน',
  WEAK_PASSWORD: 'รหัสผ่านสั้นเกินไป ต้องมีอย่างน้อย 6 ตัวอักษร',
  INVALID_EMAIL: 'รูปแบบอีเมลไม่ถูกต้อง',
  MISSING_PASSWORD: 'กรุณาใส่รหัสผ่าน',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'ลองหลายครั้งเกินไป รอสักครู่แล้วลองใหม่',
  NETWORK: 'ต่ออินเทอร์เน็ตไม่ได้ ตรวจการเชื่อมต่อแล้วลองใหม่',
  OPERATION_NOT_ALLOWED: 'ยังไม่ได้เปิดการสมัครด้วยอีเมลใน Firebase (ดูคู่มือตั้งค่า)',
  CONFIGURATION_NOT_FOUND: 'ยังไม่ได้เปิดระบบ Authentication ใน Firebase (ดูคู่มือตั้งค่า)',
  PERMISSION_DENIED: 'บันทึกไม่ได้ เพราะกฎของ Firestore ยังไม่ถูกตั้งค่า (ดูคู่มือตั้งค่า)',
  CREDENTIAL_TOO_OLD_LOGIN_AGAIN: 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง'
};
function errorText(e){
  var c = e && e.code;
  return MSG[c] || ('เกิดข้อผิดพลาด' + (c ? ' (' + c + ')' : '') + ' ลองใหม่อีกครั้ง');
}

var API;

/* ===================== Firebase (REST) ===================== */
if(REAL){
  var KEY = CFG.apiKey, PID = CFG.projectId;
  var IT = 'https://identitytoolkit.googleapis.com/v1/accounts:';
  var FS = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(PID) + '/databases/(default)/documents';
  var SKEY = 'uu-session-v1';
  var sess = LS.get(SKEY, null);

  var http = function(url, opt){
    return fetch(url, opt).then(function(r){
      return r.text().then(function(t){
        var j = {}; try{ j = t ? JSON.parse(t) : {}; }catch(e){}
        if(!r.ok){
          var m = (j.error && j.error.message) || '';
          var first = String(m).split(/[ :]/)[0];
          var code = /^[A-Z][A-Z_]+$/.test(first) ? first : ((j.error && j.error.status) || ('HTTP_' + r.status));
          throw fail(code, m);
        }
        return j;
      });
    }, function(){ throw fail('NETWORK', 'network'); });
  };
  var post = function(url, body, tok){
    var h = {'Content-Type': 'application/json'};
    if(tok) h.Authorization = 'Bearer ' + tok;
    return http(url, {method: 'POST', headers: h, body: JSON.stringify(body)});
  };
  var setSess = function(j){
    sess = {
      uid: j.localId || j.user_id || (sess && sess.uid),
      email: j.email || (sess && sess.email) || '',
      refresh: j.refreshToken || j.refresh_token || (sess && sess.refresh),
      id: j.idToken || j.id_token,
      exp: Date.now() + Number(j.expiresIn || j.expires_in || 3600) * 1000
    };
    LS.set(SKEY, sess);
    return {uid: sess.uid, email: sess.email};
  };
  var token = function(){
    if(!sess) return Promise.reject(fail('NO_SESSION'));
    if(sess.id && sess.exp - Date.now() > 60000) return Promise.resolve(sess.id);
    return http('https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(KEY), {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(sess.refresh)
    }).then(function(j){ setSess(j); return sess.id; });
  };
  var toFs = function(p){
    var f = {};
    Object.keys(p).forEach(function(k){
      var v = p[k];
      f[k] = (typeof v === 'number') ? {integerValue: String(Math.round(v))} : {stringValue: String(v == null ? '' : v)};
    });
    return {fields: f};
  };
  var fromFs = function(d){
    var o = {}, f = (d && d.fields) || {};
    Object.keys(f).forEach(function(k){
      var v = f[k];
      if(v.integerValue !== undefined) o[k] = Number(v.integerValue);
      else if(v.doubleValue !== undefined) o[k] = Number(v.doubleValue);
      else if(v.stringValue !== undefined) o[k] = v.stringValue;
    });
    return o;
  };
  var authed = function(fn){ return token().then(fn); };

  API = {
    mode: 'firebase',
    signUp: function(a){
      return post(IT + 'signUp?key=' + encodeURIComponent(KEY), {email: normEmail(a.email), password: a.password, returnSecureToken: true}).then(setSess);
    },
    signIn: function(a){
      return post(IT + 'signInWithPassword?key=' + encodeURIComponent(KEY), {email: normEmail(a.email), password: a.password, returnSecureToken: true}).then(setSess);
    },
    signOut: function(){ sess = null; LS.del(SKEY); return Promise.resolve(); },
    resetPassword: function(email){
      return post(IT + 'sendOobCode?key=' + encodeURIComponent(KEY), {requestType: 'PASSWORD_RESET', email: normEmail(email)}).then(function(){ return true; });
    },
    restore: function(){
      if(!sess || !sess.refresh) return Promise.resolve(null);
      return token().then(function(){ return {uid: sess.uid, email: sess.email}; }, function(e){
        if(e.code === 'NETWORK') return {uid: sess.uid, email: sess.email, offline: true};
        sess = null; LS.del(SKEY); return null;
      });
    },
    loadProfile: function(uid){
      return authed(function(t){
        return http(FS + '/players/' + encodeURIComponent(uid), {headers: {Authorization: 'Bearer ' + t}}).then(fromFs);
      }).then(function(p){ return p; }, function(e){ if(e.code === 'NOT_FOUND') return null; throw e; });
    },
    saveProfile: function(uid, p){
      return authed(function(t){
        return http(FS + '/players/' + encodeURIComponent(uid), {
          method: 'PATCH', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + t}, body: JSON.stringify(toFs(p))
        });
      }).then(function(){ return true; });
    },
    leaderboard: function(field, n){
      return authed(function(t){
        return post(FS + ':runQuery', {structuredQuery: {
          from: [{collectionId: 'players'}],
          orderBy: [{field: {fieldPath: field}, direction: 'DESCENDING'}],
          limit: n || 50
        }}, t);
      }).then(function(arr){
        return (arr || []).filter(function(x){ return x.document; }).map(function(x){
          var o = fromFs(x.document);
          return {uid: x.document.name.split('/').pop(), name: o.name || '?', score: o[field] || 0};
        });
      });
    },
    rankOf: function(field, score){
      return authed(function(t){
        return post(FS + ':runAggregationQuery', {structuredAggregationQuery: {
          structuredQuery: {from: [{collectionId: 'players'}], where: {fieldFilter: {field: {fieldPath: field}, op: 'GREATER_THAN', value: {integerValue: String(Math.round(score))}}}},
          aggregations: [{alias: 'n', count: {}}]
        }}, t);
      }).then(function(arr){
        var r = arr && arr[0] && arr[0].result && arr[0].result.aggregateFields && arr[0].result.aggregateFields.n;
        return r ? Number(r.integerValue) + 1 : null;
      });
    },
    deleteAccount: function(uid){
      return authed(function(t){
        return http(FS + '/players/' + encodeURIComponent(uid), {method: 'DELETE', headers: {Authorization: 'Bearer ' + t}})
          .then(function(){ return post(IT + 'delete?key=' + encodeURIComponent(KEY), {idToken: t}); });
      }).then(function(){ sess = null; LS.del(SKEY); return true; });
    },
    errorText: errorText
  };

/* ===================== โหมดทดลอง (ในเครื่อง) ===================== */
}else{
  var DU = 'uu-demo-users', DP = 'uu-demo-players', DS = 'uu-demo-session';
  var h53 = function(str){
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57, ch;
    for(var i = 0; i < str.length; i++){
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  };
  // ผู้เล่นตัวอย่าง (ใช้ดูหน้าอันดับเท่านั้น)
  var SAMPLES = [
    ['ใบเตย', 38, 120, 90, 60], ['ข้าวปั้น', 52, 84, 40, 20], ['น้ำใส', 30, 66, 45, 15], ['ตะวัน', 45, 40, 12, 0],
    ['ฟ้าใส', 25, 55, 30, 10], ['มะลิ', 40, 30, 0, 0], ['ต้นกล้า', 20, 48, 20, 0], ['ดาว', 35, 22, 8, 0],
    ['ฝน', 15, 18, 0, 0], ['ข้าวหอม', 25, 10, 5, 0], ['หมึก', 10, 12, 0, 0], ['ไข่มุก', 5, 0, 0, 0]
  ].map(function(r, i){
    return {uid: 'sample' + i, name: r[0], sample: true, login: r[1], s1: r[2], s2: r[3], s3: r[4], total: r[1] + r[2] + r[3] + r[4]};
  });
  var allPlayers = function(){
    var mine = LS.get(DP, {}), list = SAMPLES.slice();
    Object.keys(mine).forEach(function(uid){ var p = mine[uid]; list.push({uid: uid, name: p.name, login: p.login, s1: p.s1, s2: p.s2, s3: p.s3, total: p.total}); });
    return list;
  };
  var later = function(v){ return new Promise(function(res){ setTimeout(function(){ res(v); }, 120); }); };

  API = {
    mode: 'demo',
    signUp: function(a){
      var email = normEmail(a.email);
      if(!okEmail(email)) return Promise.reject(fail('INVALID_EMAIL'));
      if(String(a.password || '').length < 6) return Promise.reject(fail('WEAK_PASSWORD'));
      var users = LS.get(DU, {});
      if(users[email]) return Promise.reject(fail('EMAIL_EXISTS'));
      var uid = 'demo' + h53(email);
      users[email] = {uid: uid, ph: h53(a.password + '|' + email)};
      LS.set(DU, users); LS.set(DS, {uid: uid, email: email});
      return later({uid: uid, email: email});
    },
    signIn: function(a){
      var email = normEmail(a.email), users = LS.get(DU, {}), u = users[email];
      if(!okEmail(email)) return Promise.reject(fail('INVALID_EMAIL'));
      if(!u || u.ph !== h53(a.password + '|' + email)) return Promise.reject(fail('INVALID_LOGIN_CREDENTIALS'));
      LS.set(DS, {uid: u.uid, email: email});
      return later({uid: u.uid, email: email});
    },
    signOut: function(){ LS.del(DS); return Promise.resolve(); },
    resetPassword: function(email){
      if(!okEmail(normEmail(email))) return Promise.reject(fail('INVALID_EMAIL'));
      return later(true);     // โหมดทดลองไม่ส่งอีเมลจริง
    },
    restore: function(){ return Promise.resolve(LS.get(DS, null)); },
    loadProfile: function(uid){ return later(LS.get(DP, {})[uid] || null); },
    saveProfile: function(uid, p){ var all = LS.get(DP, {}); all[uid] = p; LS.set(DP, all); return Promise.resolve(true); },
    leaderboard: function(field, n){
      var rows = allPlayers().map(function(p){ return {uid: p.uid, name: p.name, score: p[field] || 0, sample: !!p.sample}; });
      rows.sort(function(a, b){ return b.score - a.score; });
      return later(rows.slice(0, n || 50));
    },
    rankOf: function(field, score){
      var higher = allPlayers().filter(function(p){ return (p[field] || 0) > score; }).length;
      return later(higher + 1);
    },
    deleteAccount: function(uid){
      var users = LS.get(DU, {});
      Object.keys(users).forEach(function(e){ if(users[e].uid === uid) delete users[e]; });
      LS.set(DU, users);
      var all = LS.get(DP, {}); delete all[uid]; LS.set(DP, all);
      LS.del(DS);
      return later(true);
    },
    errorText: errorText
  };
}

window.UU_BACKEND = API;
})();
