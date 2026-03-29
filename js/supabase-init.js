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

  // ─── Step 1: 디버그 유틸리티 (최우선 정의) ───────────────────────────────
  var _debugLines = [];
  var _debugPanel = null;
  var _isDebugMode = new URLSearchParams(window.location.search).get('debug') === '1';

  function _dbg(msg) {
    var ts = new Date().toISOString().substr(11, 12);
    var line = '[' + ts + '] ' + msg;
    _debugLines.push(line);
    if (_debugPanel) {
      var p = document.createElement('div');
      p.textContent = line;
      _debugPanel.appendChild(p);
      _debugPanel.scrollTop = _debugPanel.scrollHeight;
      // 패널 높이 변동 시 header 위치 보정
      var hdr = document.querySelector('#__sb_debug_wrapper + div');
      if (hdr && _debugExpanded) hdr.style.bottom = _debugPanel.offsetHeight + 'px';
    }
    try { console.log('[supabase-debug]', msg); } catch(e) {}
  }

  var _debugExpanded = true;

  function _buildDebugPanel() {
    if (document.getElementById('__sb_debug_wrapper')) return; // 이미 있으면 스킵

    // 로그 영역 (접기/펼치기 대상)
    var panel = document.createElement('div');
    panel.id = '__sb_debug_panel';
    panel.style.cssText = [
      'background:rgba(0,0,0,0.85)', 'color:#0f0', 'font:12px/1.4 monospace',
      'padding:8px', 'max-height:150px', 'overflow-y:auto'
    ].join(';');

    // 이미 쌓인 로그 표시
    _debugLines.forEach(function(l) {
      var d = document.createElement('div');
      d.textContent = l;
      panel.appendChild(d);
    });

    // 헤더 바 (항상 표시)
    var header = document.createElement('div');
    header.style.cssText = [
      'position:fixed', 'bottom:0', 'left:0', 'right:0', 'z-index:99999',
      'background:#111', 'border-top:2px solid #0f0',
      'display:flex', 'align-items:center', 'padding:4px 8px', 'gap:8px'
    ].join(';');

    var title = document.createElement('span');
    title.style.cssText = 'color:#ff0;font:bold 12px monospace;flex:1';
    title.textContent = '── Supabase Debug ──';

    var toggleBtn = document.createElement('button');
    toggleBtn.textContent = '▲ 접기';
    toggleBtn.style.cssText = 'padding:2px 8px;background:#333;color:#fff;border:1px solid #666;cursor:pointer;font:12px monospace';
    toggleBtn.onclick = function() {
      _debugExpanded = !_debugExpanded;
      if (_debugExpanded) {
        panel.style.display = 'block';
        toggleBtn.textContent = '▲ 접기';
        header.style.bottom = panel.offsetHeight + 'px';
      } else {
        panel.style.display = 'none';
        toggleBtn.textContent = '▼ Debug';
        header.style.bottom = '0';
      }
    };

    header.appendChild(title);
    header.appendChild(toggleBtn);

    // 래퍼: 패널(로그)을 header 위에 붙임
    var wrapper = document.createElement('div');
    wrapper.id = '__sb_debug_wrapper';
    wrapper.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99998';

    wrapper.appendChild(panel);
    document.body.appendChild(wrapper);
    document.body.appendChild(header);

    // 초기 header 위치 보정
    setTimeout(function() {
      header.style.bottom = panel.offsetHeight + 'px';
    }, 0);

    _debugPanel = panel;
  }

  // ?debug=1 이면 DOM 준비되는 즉시 패널 생성 (createClient 실패해도 패널은 표시)
  if (_isDebugMode) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _buildDebugPanel);
    } else {
      _buildDebugPanel();
    }
  }

  // ─── Step 2: navigator.locks polyfill (Safari 불안정 대응) ───────────────
  // Supabase v2는 request(name, {mode:'exclusive'}, callback) 3-arg 형식으로 호출
  if (typeof navigator !== 'undefined' && !navigator.locks) {
    navigator.locks = {
      request: function(name, options, cb) {
        if (typeof options === 'function') { cb = options; }
        return Promise.resolve(cb({ name: name }));
      }
    };
    window.__sbLocksPolyfilled = true;
    _dbg('navigator.locks polyfill 적용됨');
  }

  // ─── Step 3: 중복 초기화 방지 ────────────────────────────────────────────
  if (window.__supabaseClient) {
    _dbg('이미 초기화됨 — 스킵');
    return;
  }

  // ─── Step 4: CDN 로드 확인 ───────────────────────────────────────────────
  if (!window.supabase || !window.supabase.createClient) {
    _dbg('ERROR: window.supabase 없음 — CDN 스크립트 로드 실패');
    return;
  }

  const SUPABASE_URL      = 'https://gvhwaeoyxkmdquxkumkh.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_NW9SJO3uG_fLbhlNywuuow_KsqD1N9J';

  // ─── Step 5: Safari ITP 대응 커스텀 스토리지 ─────────────────────────────
  // Safari ITP가 cross-site redirect 후 localStorage를 파티셔닝할 수 있음.
  // localStorage 실패 시 sessionStorage(탭 유지)에서 복구. 두 곳 모두에 백업.
  const safariFallbackStorage = {
    getItem: function(key) {
      try {
        var val = window.localStorage.getItem(key);
        if (val !== null) return val;
        return window.sessionStorage.getItem(key);
      } catch(e) {
        try { return window.sessionStorage.getItem(key); } catch(e2) { return null; }
      }
    },
    setItem: function(key, value) {
      try { window.localStorage.setItem(key, value); } catch(e) {}
      try { window.sessionStorage.setItem(key, value); } catch(e) {}
    },
    removeItem: function(key) {
      try { window.localStorage.removeItem(key); } catch(e) {}
      try { window.sessionStorage.removeItem(key); } catch(e) {}
    }
  };

  // ─── Step 6: Supabase 클라이언트 생성 ────────────────────────────────────
  // detectSessionInUrl: false — URL ?code= 처리는 아래 handlePkceRedirect에서만.
  // detectSessionInUrl: true + 수동 exchangeCodeForSession이 동시에 실행되면
  // 두 번째 호출이 "invalid grant"를 내고 Supabase가 세션을 삭제하여
  // Safari에서 로그인이 풀리는 원인이 됨.
  window.__supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType:           'pkce',
      detectSessionInUrl: false,   // ← 핵심: 수동 교환만 사용
      persistSession:     true,
      storage:            safariFallbackStorage,
      autoRefreshToken:   true,
    }
  });
  _dbg('Supabase 클라이언트 생성 완료');

  // ─── Step 7: PKCE redirect 수동 처리 ─────────────────────────────────────
  // detectSessionInUrl: false 이므로 반드시 여기서 수동으로 code 교환해야 함.
  // code 파라미터만 URL에서 제거하고 debug=1 등 나머지 파라미터와 hash는 유지.
  (function handlePkceRedirect() {
    var params = new URLSearchParams(window.location.search);
    var code   = params.get('code');
    if (!code) return;

    _dbg('PKCE code 발견, 교환 시작 (' + code.substr(0, 12) + '...)');

    window.__supabaseClient.auth.exchangeCodeForSession(code)
      .then(function(result) {
        if (result.error) {
          _dbg('exchangeCodeForSession error: ' + result.error.message);
          return;
        }
        _dbg('exchangeCodeForSession 성공: ' + (result.data.session ? result.data.session.user.email : 'no session'));
        // URL에서 code만 제거 (debug=1, hash 등은 유지)
        var cleanParams = new URLSearchParams(window.location.search);
        cleanParams.delete('code');
        var newSearch = cleanParams.toString() ? '?' + cleanParams.toString() : '';
        window.history.replaceState(null, '', window.location.pathname + newSearch + window.location.hash);
      })
      .catch(function(e) { _dbg('exchangeCodeForSession exception: ' + e); });
  })();

  // ─── Step 8: 디버그 체크 실행 ────────────────────────────────────────────
  function _runDebugChecks() {
    _dbg('=== 디버그 체크 시작 ===');

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
    _dbg('URL hash: ' + (window.location.hash || '없음'));

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

  if (_isDebugMode) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        _buildDebugPanel(); // 패널이 아직 없으면 재시도
        _runDebugChecks();
      });
    } else {
      _runDebugChecks();
    }
  }

})();
