/* 덕구랩 데이터 레이어 — 좋아요·제안함·댓글
 * 설정(window.DEOKGU_SUPABASE = {url, key})이 있으면 Supabase REST로,
 * 없으면 localStorage 목업으로 동작한다. 프론트는 이 API만 부르면 되고,
 * 백엔드 연결은 설정 한 줄로 스위치된다. 외부 SDK 없이 fetch만 사용.
 */
(function () {
  var CFG = window.DEOKGU_SUPABASE;
  var LIVE = !!(CFG && CFG.url && CFG.key);
  var LS = window.localStorage;

  // ── localStorage 목업 헬퍼 ─────────────────────────────
  function jget(k, d) { try { return JSON.parse(LS.getItem(k)) || d; } catch (e) { return d; } }
  function jset(k, v) { try { LS.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var likedKey = 'dl_liked', likeCntKey = 'dl_likes', fbKey = 'dl_feedback', cmtKey = 'dl_comments';

  // ── 스팸 방어: 최소 작성 간격(cooldown) ────────────────
  var COOLDOWN = { comment: 15000, feedback: 20000 };
  function canPost(kind) { return (Date.now() - (jget('dl_last', {})[kind] || 0)) >= (COOLDOWN[kind] || 15000); }
  function markPost(kind) { var m = jget('dl_last', {}); m[kind] = Date.now(); jset('dl_last', m); }

  // ── Supabase REST 헬퍼 ─────────────────────────────────
  function sb(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({
      'apikey': CFG.key,
      'Authorization': 'Bearer ' + CFG.key,
      'Content-Type': 'application/json'
    }, opts.headers || {});
    return fetch(CFG.url.replace(/\/$/, '') + '/rest/v1/' + path, opts);
  }

  var API = {
    live: LIVE,

    // 여러 item의 좋아요 수 조회 → {id: count}
    getLikes: function (ids) {
      if (!LIVE) {
        var m = jget(likeCntKey, {}); var out = {};
        ids.forEach(function (id) { out[id] = m[id] || 0; });
        return Promise.resolve(out);
      }
      var inList = '(' + ids.map(function (s) { return '"' + s + '"'; }).join(',') + ')';
      return sb('likes?item_id=in.' + encodeURIComponent(inList) + '&select=item_id,count')
        .then(function (r) { return r.json(); })
        .then(function (rows) {
          var out = {}; ids.forEach(function (id) { out[id] = 0; });
          (rows || []).forEach(function (row) { out[row.item_id] = row.count; });
          return out;
        }).catch(function () { var o = {}; ids.forEach(function (id) { o[id] = 0; }); return o; });
    },

    hasLiked: function (id) { return jget(likedKey, []).indexOf(id) !== -1; },

    // 좋아요 +1 (중복은 localStorage로 방지) → 새 카운트 반환
    like: function (id, seed) {
      if (this.hasLiked(id)) return Promise.resolve(null);
      var liked = jget(likedKey, []); liked.push(id); jset(likedKey, liked);
      if (!LIVE) {
        var m = jget(likeCntKey, {});
        m[id] = (m[id] != null ? m[id] : (seed || 0)) + 1;
        jset(likeCntKey, m);
        return Promise.resolve(m[id]);
      }
      return sb('rpc/increment_like', { method: 'POST', body: JSON.stringify({ p_item_id: id }) })
        .then(function (r) { return r.json(); })
        .then(function (n) { return typeof n === 'number' ? n : (n && n.count); })
        .catch(function () { return null; });
    },

    // 제안함(피드백) 등록 (insert-only)
    addFeedback: function (data) {
      if (!LIVE) {
        var arr = jget(fbKey, []); arr.push(Object.assign({ created_at: Date.now() }, data)); jset(fbKey, arr);
        return Promise.resolve(true);
      }
      return sb('feedback', { method: 'POST', headers: { 'Prefer': 'return=minimal' }, body: JSON.stringify(data) })
        .then(function (r) { return r.ok; });
    },

    // 댓글 조회 (최신순) — id·up·down 포함
    getComments: function (itemId) {
      if (!LIVE) {
        var all = jget(cmtKey, {}); return Promise.resolve((all[itemId] || []).slice().reverse());
      }
      return sb('comments?item_id=eq.' + encodeURIComponent(itemId) + '&select=id,name,message,up,down,created_at&order=created_at.desc')
        .then(function (r) { return r.json(); }).catch(function () { return []; });
    },

    // 댓글 등록 (data: {item_id,name,message,pw}) → 새 행({id,...})
    addComment: function (data) {
      if (!LIVE) {
        var all = jget(cmtKey, {}); var arr = all[data.item_id] = all[data.item_id] || [];
        var row = { id: 'c' + Date.now() + Math.random().toString(36).slice(2, 6), name: data.name || null, message: data.message, pw: data.pw, up: 0, down: 0, created_at: Date.now() };
        arr.push(row); jset(cmtKey, all); return Promise.resolve({ id: row.id });
      }
      return sb('rpc/add_comment', { method: 'POST', body: JSON.stringify({ p_item_id: data.item_id, p_name: data.name || '', p_message: data.message, p_pw: data.pw, p_hp: data.hp || '' }) })
        .then(function (r) { return r.json(); }).then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },

    // 수정 (비번 확인) → true/false
    editComment: function (itemId, id, pw, message) {
      if (!LIVE) {
        var all = jget(cmtKey, {}); var c = (all[itemId] || []).filter(function (x) { return x.id === id; })[0];
        if (!c || String(c.pw) !== String(pw)) return Promise.resolve(false);
        c.message = message; jset(cmtKey, all); return Promise.resolve(true);
      }
      return sb('rpc/edit_comment', { method: 'POST', body: JSON.stringify({ p_id: id, p_pw: pw, p_message: message }) })
        .then(function (r) { return r.json(); }).catch(function () { return false; });
    },

    // 삭제 (비번 확인) → true/false
    deleteComment: function (itemId, id, pw) {
      if (!LIVE) {
        var all = jget(cmtKey, {}); var arr = all[itemId] || []; var c = arr.filter(function (x) { return x.id === id; })[0];
        if (!c || String(c.pw) !== String(pw)) return Promise.resolve(false);
        all[itemId] = arr.filter(function (x) { return x.id !== id; }); jset(cmtKey, all); return Promise.resolve(true);
      }
      return sb('rpc/delete_comment', { method: 'POST', body: JSON.stringify({ p_id: id, p_pw: pw }) })
        .then(function (r) { return r.json(); }).catch(function () { return false; });
    },

    votedComment: function (id) { return jget('dl_cvotes', {})[id]; },

    // 추천/비추천 — 중복은 localStorage로 방지 → {up,down} 또는 null(이미 투표)
    voteComment: function (itemId, id, dir) {
      var v = jget('dl_cvotes', {}); if (v[id]) return Promise.resolve(null);
      v[id] = dir; jset('dl_cvotes', v);
      if (!LIVE) {
        var all = jget(cmtKey, {}); var c = (all[itemId] || []).filter(function (x) { return x.id === id; })[0];
        if (!c) return Promise.resolve(null); c[dir] = (c[dir] || 0) + 1; jset(cmtKey, all);
        return Promise.resolve({ up: c.up || 0, down: c.down || 0 });
      }
      return sb('rpc/vote_comment', { method: 'POST', body: JSON.stringify({ p_id: id, p_dir: dir }) })
        .then(function (r) { return r.json(); }).then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; }).catch(function () { return null; });
    }
  };

  window.DeokguAPI = API;

  // ── 공통 스타일 주입 (댓글·제안함 모달) ────────────────────
  var CSS = '' +
    '.comments{max-width:760px;margin:10px auto 44px;padding:0 22px}' +
    '.comments .cm-h{font-family:"Gaegu",cursive;font-weight:700;font-size:24px;margin:10px 0 12px;color:#2E2A26}' +
    '.cm-form{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}' +
    '.cm-form .cm-name{flex:0 0 130px;border:1px solid #EAD9BE;border-radius:10px;padding:9px 12px;font-family:inherit;font-size:14px}' +
    '.cm-form .cm-msg{flex:1 1 100%;border:1px solid #EAD9BE;border-radius:10px;padding:9px 12px;font-family:inherit;font-size:14px;resize:vertical}' +
    '.cm-form .cm-send{background:#F2A33C;color:#fff;border:0;border-radius:10px;padding:9px 18px;font-family:"Gaegu",cursive;font-size:16px;cursor:pointer}' +
    '.cm-form .cm-send:hover{background:#C77A2C}' +
    '.cm-item{border-top:1px solid #EAD9BE;padding:11px 0}.cm-item b{font-size:14px}.cm-item .cm-when{font-size:12px;color:#7A6A56;margin-left:6px}' +
    '.cm-item p{margin:4px 0 0;font-size:15px;white-space:pre-wrap}.cm-empty{color:#7A6A56;font-size:14px;padding:10px 0}' +
    '.cm-form .cm-pw{flex:0 0 110px;border:1px solid #EAD9BE;border-radius:10px;padding:9px 12px;font-family:inherit;font-size:14px}' +
    '.cm-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.cm-actions{margin-left:auto;display:flex;gap:4px}' +
    '.cm-actions button{background:none;border:0;color:#7A6A56;font-size:12px;cursor:pointer;padding:2px 4px}.cm-actions button:hover{color:#C77A2C}' +
    '.cm-votes{display:flex;gap:8px;margin-top:7px}' +
    '.cm-votes button{background:#FFFDF8;border:1px solid #EAD9BE;border-radius:16px;padding:3px 12px;font-size:13px;cursor:pointer;color:#7A6A56}' +
    '.cm-votes button:hover{border-color:#3CC9A0}.cm-votes button b{font-weight:400}' +
    '.cm-votes button.up.on{border-color:#3CC9A0;color:#1c8f6f;background:#E1F6EF}.cm-votes button.down.on{border-color:#E8938A;color:#c0685c;background:#FCEBE8}' +
    '.cm-edit{width:100%;border:1px solid #EAD9BE;border-radius:10px;padding:8px 10px;font-family:inherit;font-size:14px;margin-top:6px}' +
    '.dl-hp{position:absolute!important;left:-9999px!important;top:-9999px!important;width:1px;height:1px;opacity:0;pointer-events:none}' +
    '.dl-ov{position:fixed;inset:0;background:rgba(46,42,38,.45);display:flex;align-items:center;justify-content:center;z-index:100;padding:20px}' +
    '.dl-modal{background:#FFFDF8;border-radius:18px;max-width:440px;width:100%;padding:24px;box-shadow:0 20px 50px rgba(0,0,0,.25)}' +
    '.dl-modal h3{font-family:"Gaegu",cursive;font-size:26px;margin-bottom:6px;color:#2E2A26}' +
    '.dl-modal p.sub{font-size:14px;color:#7A6A56;margin-bottom:14px}' +
    '.dl-modal textarea,.dl-modal input{width:100%;border:1px solid #EAD9BE;border-radius:10px;padding:10px 12px;font-family:inherit;font-size:14px;margin-bottom:10px}.dl-modal textarea{resize:vertical}' +
    '.dl-row{display:flex;gap:8px;justify-content:flex-end;margin-top:4px}' +
    '.dl-btn{border:0;border-radius:10px;padding:10px 18px;font-family:"Gaegu",cursive;font-size:16px;cursor:pointer}' +
    '.dl-btn.send{background:#F2A33C;color:#fff}.dl-btn.send:hover{background:#C77A2C}.dl-btn.cancel{background:#EEE3CF;color:#2E2A26}' +
    '.dl-ok{text-align:center;padding:14px 0;color:#1c8f6f;font-size:16px;font-family:"Gaegu",cursive}';
  var stylesDone = false;
  function ensureStyles() { if (stylesDone) return; stylesDone = true; var s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }

  // ── 제안함(개선·문의) 모달 ─────────────────────────────
  window.DeokguFeedback = {
    open: function (itemId) {
      ensureStyles();
      var ov = document.createElement('div'); ov.className = 'dl-ov';
      ov.innerHTML = '<div class="dl-modal"><h3>개선·문의 제안함</h3><p class="sub">불편한 점, 이랬으면 하는 것, 뭐든 툭 남겨주세요. 🐈</p><input class="dl-hp" tabindex="-1" autocomplete="off" aria-hidden="true"><textarea class="dl-msg" rows="4" placeholder="내용을 적어주세요"></textarea><input class="dl-contact" type="text" placeholder="연락처(선택) — 답이 필요하면"><div class="dl-row"><button class="dl-btn cancel" type="button">닫기</button><button class="dl-btn send" type="button">보내기</button></div></div>';
      document.body.appendChild(ov);
      function close() { ov.remove(); }
      ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
      ov.querySelector('.cancel').addEventListener('click', close);
      ov.querySelector('.send').addEventListener('click', function () {
        if (ov.querySelector('.dl-hp').value) { close(); return; }            // 허니팟: 봇 → 조용히 닫기
        if (!canPost('feedback')) { alert('잠깐만요, 조금 뒤에 다시 보내주세요 🙏'); return; }
        var ta = ov.querySelector('.dl-msg'); var msg = ta.value.trim(); if (msg.length < 3) { ta.focus(); return; }
        var contact = ov.querySelector('.dl-contact').value.trim();
        API.addFeedback({ item_id: itemId || null, message: msg, contact: contact || null }).then(function () {
          markPost('feedback');
          ov.querySelector('.dl-modal').innerHTML = '<div class="dl-ok">고맙습니다! 잘 접수됐어요 🙌</div>';
          setTimeout(close, 1400);
        });
      });
    }
  };

  // ── 게시글 페이지 헬퍼: 좋아요 배선 + 댓글 UI 주입 ──────────
  window.DeokguPost = {
    itemId: function () {
      var m = location.pathname.match(/webs\/([^\/]+)\//);
      return m ? m[1] : (location.pathname.split('/').filter(Boolean).slice(-2, -1)[0] || 'post');
    },
    init: function () {
      ensureStyles();
      var id = this.itemId();
      // 좋아요
      var likeBtn = document.querySelector('.foot-actions .like');
      if (likeBtn) {
        var b = likeBtn.querySelector('b');
        API.getLikes([id]).then(function (m) { if (b) b.textContent = m[id] || 0; });
        if (API.hasLiked(id)) likeBtn.classList.add('liked');
        likeBtn.addEventListener('click', function () {
          if (likeBtn.classList.contains('liked')) return;
          var seed = parseInt((b && b.textContent) || '0', 10);
          API.like(id, seed).then(function (n) { if (n != null && b) b.textContent = n; likeBtn.classList.add('liked'); });
        });
      }
      // 댓글 UI 주입 (foot-actions 뒤)
      var anchor = document.querySelector('.foot-actions');
      if (anchor) {
        var wrap = document.createElement('section');
        wrap.className = 'comments';
        wrap.innerHTML =
          '<h2 class="cm-h">댓글</h2>' +
          '<form class="cm-form"><input class="dl-hp" tabindex="-1" autocomplete="off" aria-hidden="true"><input class="cm-name" type="text" maxlength="20" placeholder="이름 (선택)"><input class="cm-pw" type="password" inputmode="numeric" maxlength="4" placeholder="비번 4자리"><textarea class="cm-msg" maxlength="500" rows="2" placeholder="댓글을 남겨주세요"></textarea><button class="cm-send" type="submit">등록</button></form>' +
          '<div class="cm-list"></div>';
        anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
        var list = wrap.querySelector('.cm-list');
        function render(rows) {
          if (!rows || !rows.length) { list.innerHTML = '<p class="cm-empty">첫 댓글을 남겨보세요 🐈</p>'; return; }
          list.innerHTML = rows.map(function (c) {
            var when = c.created_at ? new Date(c.created_at).toLocaleDateString('ko-KR') : '';
            var v = API.votedComment(c.id);
            return '<div class="cm-item" data-id="' + esc(c.id) + '">' +
              '<div class="cm-head"><b>' + esc(c.name || '익명') + '</b><span class="cm-when">' + when + '</span>' +
              '<span class="cm-actions"><button type="button" class="cm-edit-b">수정</button><button type="button" class="cm-del-b">삭제</button></span></div>' +
              '<p class="cm-msg-t">' + esc(c.message) + '</p>' +
              '<div class="cm-votes"><button type="button" class="up' + (v === 'up' ? ' on' : '') + '">👍 <b>' + (c.up || 0) + '</b></button>' +
              '<button type="button" class="down' + (v === 'down' ? ' on' : '') + '">👎 <b>' + (c.down || 0) + '</b></button></div>' +
              '</div>';
          }).join('');
        }
        function reload() { API.getComments(id).then(render); }
        reload();
        wrap.querySelector('.cm-form').addEventListener('submit', function (e) {
          e.preventDefault();
          if (wrap.querySelector('.dl-hp').value) return;                       // 허니팟: 봇 → 조용히 무시
          if (!canPost('comment')) { alert('잠깐만요, 조금 뒤에 다시 올려주세요 🙏'); return; }
          var msg = wrap.querySelector('.cm-msg').value.trim();
          if (msg.length < 2) { alert('댓글을 조금만 더 적어주세요.'); return; }   // 최소 길이
          var pw = wrap.querySelector('.cm-pw').value.trim();
          if (!/^[0-9]{4}$/.test(pw)) { alert('비밀번호는 숫자 4자리로 입력해 주세요. (나중에 수정·삭제할 때 필요해요)'); return; }
          var name = wrap.querySelector('.cm-name').value.trim();
          API.addComment({ item_id: id, name: name, message: msg, pw: pw, hp: wrap.querySelector('.dl-hp').value }).then(function () {
            markPost('comment');
            wrap.querySelector('.cm-msg').value = ''; wrap.querySelector('.cm-pw').value = '';
            reload();
          });
        });
        // 추천/비추천·수정·삭제 (이벤트 위임)
        list.addEventListener('click', function (e) {
          var item = e.target.closest('.cm-item'); if (!item) return; var cid = item.getAttribute('data-id');
          if (e.target.closest('.up') || e.target.closest('.down')) {
            if (API.votedComment(cid)) return;
            var dir = e.target.closest('.up') ? 'up' : 'down';
            API.voteComment(id, cid, dir).then(function (res) { if (res) reload(); });
          } else if (e.target.closest('.cm-del-b')) {
            var pw = prompt('댓글 삭제 — 비밀번호 4자리'); if (!pw) return;
            API.deleteComment(id, cid, pw).then(function (ok) { ok ? reload() : alert('비밀번호가 맞지 않아요.'); });
          } else if (e.target.closest('.cm-edit-b')) {
            var p = item.querySelector('.cm-msg-t'); if (item.querySelector('.cm-edit')) return;
            var ta = document.createElement('textarea'); ta.className = 'cm-edit'; ta.rows = 2; ta.value = p.textContent;
            var save = document.createElement('button'); save.type = 'button'; save.className = 'cm-send'; save.textContent = '저장'; save.style.marginTop = '6px';
            p.style.display = 'none'; p.parentNode.insertBefore(ta, p.nextSibling); ta.parentNode.insertBefore(save, ta.nextSibling); ta.focus();
            save.addEventListener('click', function () {
              var nv = ta.value.trim(); if (!nv) return;
              var pw = prompt('댓글 수정 — 비밀번호 4자리'); if (!pw) return;
              API.editComment(id, cid, pw, nv).then(function (ok) { ok ? reload() : alert('비밀번호가 맞지 않아요.'); });
            });
          }
        });
      }
    }
  };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
})();
