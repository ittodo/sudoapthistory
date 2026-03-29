/**
 * supabase-init.js — 공용 Supabase 클라이언트 싱글턴
 *
 * 모든 페이지에서 이 파일을 Supabase CDN 스크립트 다음에 로드.
 * window.__supabaseClient 로 공유 인스턴스에 접근.
 *
 * 디버그 모드: URL에 ?debug=1 추가 시 화면 하단에 디버그 패널 표시
 */
(function () {
  'use strict';

  // ─── navigator.locks polyfill (Safari 불안정 대응) ───────────────────────
  // Supabase v2는 request(name, {mode:'exclusive'}, callback) 3-arg 형식으로 호출
  if (typeof navigator !== 'undefined' && !navigator.locks) {
    navigator.locks = {
      request: function(name, options, cb) {
        if (typeof options === 'function') { cb = options; }
        return Promise.resolve(cb({ name: name }));
      }
    };
  }

  if (window.__supabaseClient) return; // 이미 초기화된 경우 스킵

  const SUPABASE_URL      = 'https://gvhwaeoyxkmdquxkumkh.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_NW9SJO3uG_fLbhlNywuuow_KsqD1N9J';

  // ─── Safari ITP: PKCE code verifier sessionStorage 백업 커스텀 스토리지 ──
  // Safari ITP가 redirect 후 localStorage를 파티셔닝할 수 있으므로
  // localStorage에 쓸 때 sessionStorage에도 동시에 백업하고,
  // localStorage에서 못 읽으면 sessionStorage에서 복구 시도
  const safariFallbackStorage = {
    getItem: function(key) {
      try {
        var val = window.localStorage.getItem(key);
        if (val !== null) return val;
        // localStorage에 없으면 sessionStorage에서 복구 시도
        return window.sessionStorage.getItem(key);
      } catch(e) {
        try { return window.sessionStorage.getItem(key); } catch(e2) { return null; }
      }
    },
    setItem: function(key, value) {
      try { window.localStorage.setItem(key, value); } catch(e) {}
      // code verifier 관련 키는 sessionStorage에도 백업
      try { window.sessionStorage.setItem(key, value); } catch(e) {}
    },
    removeItem: function(key) {
      try { window.localStorage.removeItem(key); } catch(e) {}
      try { window.sessionStorage.removeItem(key); } catch(e) {}
    }
  };

  window.__supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType:          'pkce',
      detectSessionInUrl: true,
      persistSession:    true,
      storage:           safariFallbackStorage,
      autoRefreshToken:  true,
    }
  });

  // ─── Safari에서 ?code= redirect 후 수동 code exchange ────────────────────
  // detectSessionInUrl이 Safari에서 제대로 동작 안 할 수 있으므로 명시적 처리
  (function handlePkceRedirect() {
    var params = new URLSearchParams(window.location.search);
    var code   = params.get('code');
    if (!code) return;

    window.__supabaseClient.auth.exchangeCodeForSession(code)
      .then(function(result) {
        if (result.error) {
          _dbg('exchangeCodeForSession error: ' + result.error.message);
          return;
        }
        _dbg('exchangeCodeForSession 성공: ' + (result.data.session ? result.data.session.user.email : 'no session'));
        // URL에서 code 파라미터 제거 (뒤로가기 시 재실행 방지)
        var clean = window.location.pathname + window.location.hash;
        window.history.replaceState(null, '', clean);
      })
      .catch(function(e) { _dbg('exchangeCodeForSession exception: ' + e); });
  })();

  // ─── 디버그 패널 ─────────────────────────────────────────────────────────
  var _debugLines = [];
  var _debugPanel = null;

  function _dbg(msg) {
    var ts = new Date().toISOString().substr(11, 12);
    var line = '[' + ts + '] ' + msg;
    _debugLines.push(line);
    if (_debugPanel) {
      var p = document.createElement('div');
      p.textContent = line;
      _debugPanel.appendChild(p);
      _debugPanel.scrollTop = _debugPanel.scrollHeight;
    }
    // console도 같이 출력 (지원하는 환경에서)
    try { console.log('[supabase-debug]', msg); } catch(e) {}
  }

  function _buildDebugPanel() {
    var panel = document.createElement('div');
    panel.id = '__sb_debug_panel';
    panel.style.cssText = [
      'position:fixed', 'bottom:0', 'left:0', 'right:0', 'z-index:99999',
      'background:rgba(0,0,0,0.85)', 'color:#0f0', 'font:12px/1.4 monospace',
      'padding:8px', 'max-height:40vh', 'overflow-y:auto',
      'border-top:2px solid #0f0'
    ].join(';');

    var title = document.createElement('div');
    title.style.cssText = 'color:#ff0;font-weight:bold;margin-bottom:4px';
    title.textContent = '── Supabase Debug Panel ──';
    panel.appendChild(title);

    _debugLines.forEach(function(l) {
      var d = document.createElement('div');
      d.textContent = l;
      panel.appendChild(d);
    });

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ 닫기';
    closeBtn.style.cssText = 'margin-top:6px;padding:2px 8px;background:#333;color:#fff;border:1px solid #666;cursor:pointer';
    closeBtn.onclick = function() { panel.remove(); };
    panel.appendChild(closeBtn);

    document.body.appendChild(panel);
    _debugPanel = panel;
  }

  function _runDebugChecks() {
    _dbg('=== 디버그 시작 ===');

    // 1. navigator.locks 지원 여부
    _dbg('navigator.locks: ' + (
      window.__sbLocksPolyfilled ? 'polyfill 적용됨' :
      (typeof navigator !== 'undefined' && navigator.locks ? '네이티브 지원' : '없음')
    ));

    // 2. localStorage 접근 가능 여부
    try {
      window.localStorage.setItem('__sb_test', '1');
      window.localStorage.removeItem('__sb_test');
      _dbg('localStorage: 접근 가능');
    } catch(e) {
      _dbg('localStorage: 차단됨 (' + e.message + ')');
    }

    // 3. sessionStorage 접근 가능 여부
    try {
      window.sessionStorage.setItem('__sb_test', '1');
      window.sessionStorage.removeItem('__sb_test');
      _dbg('sessionStorage: 접근 가능');
    } catch(e) {
      _dbg('sessionStorage: 차단됨 (' + e.message + ')');
    }

    // 4. URL ?code= 파라미터
    var params = new URLSearchParams(window.location.search);
    _dbg('URL ?code=: ' + (params.get('code') ? '있음 (' + params.get('code').substr(0,12) + '...)' : '없음'));

    // 5. PKCE code verifier (localStorage/sessionStorage)
    var cvKey = null;
    try {
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k && k.indexOf('code-verifier') !== -1) { cvKey = k; break; }
      }
    } catch(e) {}
    if (!cvKey) {
      try {
        for (var j = 0; j < window.sessionStorage.length; j++) {
          var sk = window.sessionStorage.key(j);
          if (sk && sk.indexOf('code-verifier') !== -1) { cvKey = sk + ' [session]'; break; }
        }
      } catch(e) {}
    }
    _dbg('PKCE code-verifier: ' + (cvKey ? '존재 (' + cvKey + ')' : '없음'));

    // 6. auth-token 키
    var authKey = null;
    try {
      for (var ai = 0; ai < window.localStorage.length; ai++) {
        var ak = window.localStorage.key(ai);
        if (ak && ak.indexOf('auth-token') !== -1 && ak.indexOf('code-verifier') === -1) {
          authKey = ak; break;
        }
      }
    } catch(e) {}
    _dbg('auth-token key: ' + (authKey || '없음'));

    // 7. getSession() 결과
    window.__supabaseClient.auth.getSession()
      .then(function(r) {
        if (r.error) {
          _dbg('getSession error: ' + r.error.message);
        } else if (r.data.session) {
          _dbg('getSession: 세션 있음 (' + r.data.session.user.email + ')');
        } else {
          _dbg('getSession: 세션 없음');
        }
      })
      .catch(function(e) { _dbg('getSession exception: ' + e); });

    // 8. onAuthStateChange 모니터링
    window.__supabaseClient.auth.onAuthStateChange(function(event, session) {
      _dbg('onAuthStateChange: event=' + event + ', user=' + (session ? session.user.email : 'null'));
    });

    _dbg('=== 체크 완료 (getSession 비동기 대기중) ===');
  }

  // ?debug=1 파라미터가 있으면 디버그 패널 활성화
  if (new URLSearchParams(window.location.search).get('debug') === '1') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        _buildDebugPanel();
        _runDebugChecks();
      });
    } else {
      _buildDebugPanel();
      _runDebugChecks();
    }
  }

})();
