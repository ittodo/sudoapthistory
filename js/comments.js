/**
 * nodostream.com 공통 댓글 모듈
 * Supabase 기반 / api 래퍼 패턴으로 백엔드 교체 용이
 *
 * 사용법:
 *   initComments('page-id', '#container-selector')
 */

(function (global) {
  'use strict';

  // ─── 설정 ────────────────────────────────────────────────────────────────
  const SUPABASE_URL = 'https://gvhwaeoyxkmdquxkumkh.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_NW9SJO3uG_fLbhlNywuuow_KsqD1N9J';
  const PAGE_SIZE = 20;

  // ─── 상태 ────────────────────────────────────────────────────────────────
  let _supabase = null;
  let _session  = null;
  let _profile  = null;
  let _pageId   = null;
  let _container = null;
  let _offset   = 0;
  let _totalCount = 0;
  let _editingId  = null;

  // ─── Supabase API 래퍼 ──────────────────────────────────────────────────
  // 이 섹션만 교체하면 자체 백엔드로 마이그레이션 가능
  const api = {
    async getSession() {
      const { data } = await _supabase.auth.getSession();
      return data.session;
    },

    async signInWithGoogle() {
      const { error } = await _supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: location.origin + location.pathname }
      });
      if (error) throw error;
    },

    async signOut() {
      const { error } = await _supabase.auth.signOut();
      if (error) throw error;
    },

    async getProfile(userId) {
      const { data, error } = await _supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },

    async upsertProfile(userId, nickname) {
      const { data, error } = await _supabase
        .from('profiles')
        .upsert({ user_id: userId, nickname }, { onConflict: 'user_id' })
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    async isNicknameAvailable(nickname) {
      const { data, error } = await _supabase.rpc('is_nickname_available', { p_nickname: nickname });
      if (error) throw error;
      return data;
    },

    async listComments(pageId, offset, limit) {
      const { data, error, count } = await _supabase
        .from('comments')
        .select(`
          id, content, created_at, updated_at,
          profiles!inner(nickname, avatar_url),
          user_id
        `, { count: 'exact' })
        .eq('page_id', pageId)
        .is('deleted_at', null)
        .is('moderated_at', null)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      return { data, count };
    },

    async insertComment(pageId, userId, content) {
      const { data, error } = await _supabase
        .from('comments')
        .insert({ page_id: pageId, user_id: userId, content })
        .select(`id, content, created_at, updated_at, user_id, profiles!inner(nickname, avatar_url)`)
        .single();
      if (error) throw error;
      return data;
    },

    async updateComment(id, content) {
      const { data, error } = await _supabase
        .from('comments')
        .update({ content, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select(`id, content, created_at, updated_at, user_id, profiles!inner(nickname, avatar_url)`)
        .single();
      if (error) throw error;
      return data;
    },

    async softDeleteComment(id) {
      const { error } = await _supabase.rpc('soft_delete_comment', { comment_id: id });
      if (error) throw error;
    }
  };

  // ─── CSS 삽입 ────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('nds-comments-style')) return;
    const css = `
      .nds-comments {
        max-width: 860px;
        margin: 40px auto 0;
        padding: 0 16px 40px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px;
        color: #e2e8f0;
      }
      .nds-comments * { box-sizing: border-box; }

      .nds-c-title {
        font-size: 15px;
        font-weight: 700;
        color: #e2e8f0;
        margin-bottom: 16px;
        padding-bottom: 10px;
        border-bottom: 1px solid #334155;
      }
      .nds-c-title span {
        font-size: 12px;
        font-weight: 400;
        color: #94a3b8;
        margin-left: 6px;
      }

      /* 인증 바 */
      .nds-auth-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 8px;
        padding: 10px 14px;
        margin-bottom: 16px;
        gap: 10px;
        flex-wrap: wrap;
      }
      .nds-user-info {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #94a3b8;
        font-size: 12px;
      }
      .nds-user-info strong { color: #e2e8f0; font-size: 13px; }
      .nds-avatar {
        width: 28px; height: 28px;
        border-radius: 50%;
        background: #334155;
        object-fit: cover;
        flex-shrink: 0;
      }
      .nds-btn {
        padding: 6px 14px;
        border-radius: 6px;
        border: 1px solid #334155;
        background: transparent;
        color: #94a3b8;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: all .15s;
        white-space: nowrap;
      }
      .nds-btn:hover { border-color: #94a3b8; color: #e2e8f0; }
      .nds-btn-primary {
        background: #3b82f6;
        border-color: #3b82f6;
        color: #fff;
      }
      .nds-btn-primary:hover { background: #2563eb; border-color: #2563eb; }
      .nds-btn-google {
        display: flex;
        align-items: center;
        gap: 8px;
        background: #fff;
        border-color: #d1d5db;
        color: #374151;
      }
      .nds-btn-google:hover { background: #f9fafb; }
      .nds-btn-google svg { flex-shrink: 0; }
      .nds-btn-sm {
        padding: 3px 9px;
        font-size: 11px;
      }
      .nds-btn-danger { color: #f87171; border-color: #7f1d1d22; }
      .nds-btn-danger:hover { border-color: #f87171; background: #7f1d1d33; color: #fca5a5; }
      .nds-btn-settings {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        text-decoration: none;
      }
      .nds-auth-actions { display: flex; align-items: center; gap: 6px; }

      /* 닉네임 설정 폼 */
      .nds-nick-form {
        background: #1e293b;
        border: 1px solid #f59e0b44;
        border-radius: 8px;
        padding: 14px 16px;
        margin-bottom: 16px;
      }
      .nds-nick-form p {
        font-size: 12px;
        color: #fbbf24;
        margin-bottom: 10px;
      }
      .nds-nick-row {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .nds-input {
        flex: 1;
        background: #0f172a;
        border: 1px solid #334155;
        border-radius: 6px;
        color: #e2e8f0;
        font-size: 13px;
        padding: 7px 10px;
        outline: none;
        transition: border-color .15s;
      }
      .nds-input:focus { border-color: #3b82f6; }
      .nds-input::placeholder { color: #475569; }
      .nds-nick-hint {
        font-size: 11px;
        color: #64748b;
        margin-top: 6px;
      }

      /* 댓글 작성 폼 */
      .nds-write-form {
        margin-bottom: 20px;
      }
      .nds-textarea {
        width: 100%;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 8px;
        color: #e2e8f0;
        font-size: 13px;
        padding: 10px 12px;
        outline: none;
        resize: vertical;
        min-height: 80px;
        font-family: inherit;
        transition: border-color .15s;
        line-height: 1.5;
      }
      .nds-textarea:focus { border-color: #3b82f6; }
      .nds-textarea::placeholder { color: #475569; }
      .nds-write-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 8px;
      }
      .nds-char-count { font-size: 11px; color: #64748b; }
      .nds-char-count.over { color: #f87171; }

      /* 댓글 목록 */
      .nds-list { display: flex; flex-direction: column; gap: 2px; }

      .nds-comment {
        background: #1e293b;
        border: 1px solid #1e293b;
        border-radius: 8px;
        padding: 12px 14px;
        transition: border-color .15s;
      }
      .nds-comment:hover { border-color: #334155; }

      .nds-comment-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }
      .nds-comment-nick {
        font-weight: 600;
        color: #e2e8f0;
        font-size: 12px;
      }
      .nds-comment-time {
        font-size: 11px;
        color: #64748b;
        flex: 1;
      }
      .nds-comment-edited {
        font-size: 10px;
        color: #475569;
        font-style: italic;
      }
      .nds-comment-actions {
        display: flex;
        gap: 4px;
      }
      .nds-comment-body {
        font-size: 13px;
        color: #cbd5e1;
        line-height: 1.6;
        white-space: pre-wrap;
        word-break: break-word;
      }

      /* 인라인 수정 폼 */
      .nds-edit-form { margin-top: 8px; }
      .nds-edit-footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        margin-top: 6px;
      }

      /* 더보기 */
      .nds-more-wrap {
        text-align: center;
        margin-top: 14px;
      }

      /* 로그인 유도 */
      .nds-login-prompt {
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 8px;
        padding: 16px;
        text-align: center;
        color: #94a3b8;
        font-size: 13px;
        margin-bottom: 20px;
      }

      /* 에러/알림 */
      .nds-toast {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 8px;
        padding: 10px 20px;
        font-size: 13px;
        color: #e2e8f0;
        z-index: 9999;
        pointer-events: none;
        opacity: 0;
        transition: opacity .2s;
        white-space: nowrap;
      }
      .nds-toast.show { opacity: 1; }
      .nds-toast.error { border-color: #f87171; color: #fca5a5; }

      .nds-empty {
        text-align: center;
        color: #64748b;
        font-size: 13px;
        padding: 30px 0;
      }
      .nds-loading-inline {
        text-align: center;
        color: #64748b;
        font-size: 12px;
        padding: 20px 0;
      }
    `;
    const el = document.createElement('style');
    el.id = 'nds-comments-style';
    el.textContent = css;
    document.head.appendChild(el);
  }

  // ─── 유틸 ────────────────────────────────────────────────────────────────
  function esc(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function timeAgo(iso) {
    const d = new Date(iso);
    const diff = Math.floor((Date.now() - d) / 1000);
    if (diff < 60)  return '방금';
    if (diff < 3600) return Math.floor(diff / 60) + '분 전';
    if (diff < 86400) return Math.floor(diff / 3600) + '시간 전';
    if (diff < 86400 * 30) return Math.floor(diff / 86400) + '일 전';
    return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  let _toastTimer = null;
  function showToast(msg, isError = false) {
    let el = document.getElementById('nds-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'nds-toast';
      el.className = 'nds-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'nds-toast' + (isError ? ' error' : '');
    clearTimeout(_toastTimer);
    requestAnimationFrame(() => {
      el.classList.add('show');
      _toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
    });
  }

  // ─── 렌더링 ──────────────────────────────────────────────────────────────
  function render() {
    _container.innerHTML = '';

    // 타이틀
    const title = document.createElement('div');
    title.className = 'nds-c-title';
    title.innerHTML = '댓글' + (_totalCount > 0 ? `<span>${_totalCount}개</span>` : '');
    _container.appendChild(title);

    // 인증 바
    _container.appendChild(renderAuthBar());

    // 닉네임 미설정 시 폼 (프로필 없는 신규 유저 포함)
    if (_session && (!_profile || !_profile.nickname)) {
      _container.appendChild(renderNickForm());
    }

    // 댓글 작성 폼
    if (_session && _profile && _profile.nickname) {
      _container.appendChild(renderWriteForm());
    } else if (!_session) {
      _container.appendChild(renderLoginPrompt());
    }

    // 댓글 목록 영역
    const listWrap = document.createElement('div');
    listWrap.id = 'nds-list-wrap';
    _container.appendChild(listWrap);

    renderList(listWrap);
  }

  function renderAuthBar() {
    const bar = document.createElement('div');
    bar.className = 'nds-auth-bar';

    if (_session) {
      const info = document.createElement('div');
      info.className = 'nds-user-info';
      const avatarSrc = _profile?.avatar_url || '';
      if (avatarSrc) {
        info.innerHTML = `<img class="nds-avatar" src="${esc(avatarSrc)}" alt="avatar">`;
      }
      const nick = _profile?.nickname || '닉네임 미설정';
      info.innerHTML += `<strong>${esc(nick)}</strong><span>으로 로그인됨</span>`;
      bar.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'nds-auth-actions';

      const settingsBtn = document.createElement('a');
      settingsBtn.className = 'nds-btn nds-btn-sm nds-btn-settings';
      settingsBtn.href = '/account/';
      settingsBtn.title = '계정 설정';
      settingsBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>계정 설정`;
      actions.appendChild(settingsBtn);

      const logoutBtn = document.createElement('button');
      logoutBtn.className = 'nds-btn nds-btn-sm';
      logoutBtn.textContent = '로그아웃';
      logoutBtn.onclick = handleSignOut;
      actions.appendChild(logoutBtn);

      bar.appendChild(actions);
    } else {
      const msg = document.createElement('span');
      msg.style.cssText = 'color:#94a3b8;font-size:12px;';
      msg.textContent = '댓글을 작성하려면 로그인하세요.';
      bar.appendChild(msg);

      const loginBtn = document.createElement('button');
      loginBtn.className = 'nds-btn nds-btn-google';
      loginBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Google로 로그인`;
      loginBtn.onclick = () => api.signInWithGoogle().catch(e => showToast(e.message, true));
      bar.appendChild(loginBtn);
    }

    return bar;
  }

  function renderNickForm() {
    const wrap = document.createElement('div');
    wrap.className = 'nds-nick-form';
    wrap.innerHTML = `
      <p>댓글 작성을 위해 닉네임을 설정해주세요. (최초 1회)</p>
      <div class="nds-nick-row">
        <input class="nds-input" id="nds-nick-input" type="text"
          placeholder="닉네임 (2~30자)" maxlength="30" autocomplete="off">
        <button class="nds-btn nds-btn-primary" id="nds-nick-save">저장</button>
      </div>
      <div class="nds-nick-hint">영문, 한글, 숫자, _, - 사용 가능 / 2~30자</div>
    `;

    setTimeout(() => {
      const input = document.getElementById('nds-nick-input');
      const saveBtn = document.getElementById('nds-nick-save');
      if (!input || !saveBtn) return;

      saveBtn.onclick = async () => {
        const val = input.value.trim();
        if (val.length < 2) { showToast('닉네임은 2자 이상이어야 합니다.', true); return; }
        if (!/^[가-힣a-zA-Z0-9_\-]+$/.test(val)) {
          showToast('사용할 수 없는 문자가 포함되어 있습니다.', true); return;
        }
        saveBtn.disabled = true;
        saveBtn.textContent = '확인 중...';
        try {
          const avail = await api.isNicknameAvailable(val);
          if (!avail) { showToast('이미 사용 중인 닉네임입니다.', true); return; }
          _profile = await api.upsertProfile(_session.user.id, val);
          showToast('닉네임이 설정되었습니다.');
          render();
        } catch (e) {
          showToast(e.message, true);
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = '저장';
        }
      };

      input.addEventListener('keydown', e => { if (e.key === 'Enter') saveBtn.click(); });
    }, 0);

    return wrap;
  }

  function renderLoginPrompt() {
    const el = document.createElement('div');
    el.className = 'nds-login-prompt';
    el.textContent = '댓글을 작성하려면 로그인이 필요합니다.';
    return el;
  }

  function renderWriteForm() {
    const wrap = document.createElement('div');
    wrap.className = 'nds-write-form';
    wrap.innerHTML = `
      <textarea class="nds-textarea" id="nds-new-content"
        placeholder="댓글을 입력하세요... (최대 1000자)" maxlength="1000" rows="3"></textarea>
      <div class="nds-write-footer">
        <span class="nds-char-count" id="nds-new-count">0 / 1000</span>
        <button class="nds-btn nds-btn-primary" id="nds-submit-btn">댓글 작성</button>
      </div>
    `;

    setTimeout(() => {
      const ta = document.getElementById('nds-new-content');
      const countEl = document.getElementById('nds-new-count');
      const submitBtn = document.getElementById('nds-submit-btn');
      if (!ta || !countEl || !submitBtn) return;

      ta.addEventListener('input', () => {
        const len = ta.value.length;
        countEl.textContent = `${len} / 1000`;
        countEl.classList.toggle('over', len > 1000);
      });

      submitBtn.onclick = async () => {
        const content = ta.value.trim();
        if (!content) { showToast('댓글 내용을 입력하세요.', true); return; }
        if (content.length > 1000) { showToast('1000자 이하로 입력하세요.', true); return; }
        submitBtn.disabled = true;
        submitBtn.textContent = '저장 중...';
        try {
          await api.insertComment(_pageId, _session.user.id, content);
          ta.value = '';
          countEl.textContent = '0 / 1000';
          _offset = 0;
          await refreshList();
          showToast('댓글이 등록되었습니다.');
          // 타이틀 카운트 업데이트
          const titleEl = _container.querySelector('.nds-c-title');
          if (titleEl) titleEl.innerHTML = '댓글' + (_totalCount > 0 ? `<span>${_totalCount}개</span>` : '');
        } catch (e) {
          showToast(e.message, true);
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = '댓글 작성';
        }
      };
    }, 0);

    return wrap;
  }

  function renderComment(c, isOwn) {
    const el = document.createElement('div');
    el.className = 'nds-comment';
    el.dataset.id = c.id;

    const nick = c.profiles?.nickname || '(알 수 없음)';
    const editedMark = c.updated_at ? '<span class="nds-comment-edited">(수정됨)</span>' : '';
    const actionsHtml = isOwn ? `
      <div class="nds-comment-actions">
        <button class="nds-btn nds-btn-sm nds-edit-btn" data-id="${c.id}">수정</button>
        <button class="nds-btn nds-btn-sm nds-btn-danger nds-del-btn" data-id="${c.id}">삭제</button>
      </div>` : '';

    el.innerHTML = `
      <div class="nds-comment-header">
        <span class="nds-comment-nick">${esc(nick)}</span>
        <span class="nds-comment-time">${timeAgo(c.created_at)}</span>
        ${editedMark}
        ${actionsHtml}
      </div>
      <div class="nds-comment-body" id="nds-body-${c.id}">${esc(c.content)}</div>
    `;

    if (isOwn) {
      el.querySelector('.nds-edit-btn').onclick = () => showEditForm(el, c);
      el.querySelector('.nds-del-btn').onclick = () => handleDelete(c.id);
    }

    return el;
  }

  function showEditForm(el, c) {
    if (_editingId === c.id) return;
    _editingId = c.id;

    const bodyEl = el.querySelector(`#nds-body-${c.id}`);
    const editHtml = `
      <div class="nds-edit-form" id="nds-edit-${c.id}">
        <textarea class="nds-textarea" id="nds-edit-ta-${c.id}"
          maxlength="1000" rows="3">${esc(c.content)}</textarea>
        <div class="nds-edit-footer">
          <span class="nds-char-count" id="nds-edit-count-${c.id}">${c.content.length} / 1000</span>
          <button class="nds-btn nds-btn-sm" id="nds-edit-cancel-${c.id}">취소</button>
          <button class="nds-btn nds-btn-sm nds-btn-primary" id="nds-edit-save-${c.id}">저장</button>
        </div>
      </div>`;
    bodyEl.insertAdjacentHTML('afterend', editHtml);
    bodyEl.style.display = 'none';

    const ta = document.getElementById(`nds-edit-ta-${c.id}`);
    const countEl = document.getElementById(`nds-edit-count-${c.id}`);
    const cancelBtn = document.getElementById(`nds-edit-cancel-${c.id}`);
    const saveBtn = document.getElementById(`nds-edit-save-${c.id}`);

    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    ta.addEventListener('input', () => {
      countEl.textContent = `${ta.value.length} / 1000`;
    });

    cancelBtn.onclick = () => {
      document.getElementById(`nds-edit-${c.id}`)?.remove();
      bodyEl.style.display = '';
      _editingId = null;
    };

    saveBtn.onclick = async () => {
      const newContent = ta.value.trim();
      if (!newContent) { showToast('내용을 입력하세요.', true); return; }
      if (newContent.length > 1000) { showToast('1000자 이하로 입력하세요.', true); return; }
      saveBtn.disabled = true;
      saveBtn.textContent = '저장 중...';
      try {
        const updated = await api.updateComment(c.id, newContent);
        document.getElementById(`nds-edit-${c.id}`)?.remove();
        bodyEl.textContent = updated.content;
        bodyEl.style.display = '';
        _editingId = null;
        // 수정됨 표시
        const header = el.querySelector('.nds-comment-header');
        if (!header.querySelector('.nds-comment-edited')) {
          header.insertAdjacentHTML('beforeend', '<span class="nds-comment-edited">(수정됨)</span>');
        }
        showToast('댓글이 수정되었습니다.');
      } catch (e) {
        showToast(e.message, true);
        saveBtn.disabled = false;
        saveBtn.textContent = '저장';
      }
    };
  }

  async function handleDelete(id) {
    if (!confirm('댓글을 삭제하시겠습니까?')) return;
    try {
      await api.softDeleteComment(id);
      const el = _container.querySelector(`[data-id="${id}"]`);
      if (el) el.remove();
      _totalCount = Math.max(0, _totalCount - 1);
      const titleEl = _container.querySelector('.nds-c-title');
      if (titleEl) titleEl.innerHTML = '댓글' + (_totalCount > 0 ? `<span>${_totalCount}개</span>` : '');
      showToast('댓글이 삭제되었습니다.');
    } catch (e) {
      showToast(e.message, true);
    }
  }

  async function renderList(listWrap) {
    listWrap.innerHTML = '<div class="nds-loading-inline">불러오는 중...</div>';
    try {
      const { data, count } = await api.listComments(_pageId, 0, PAGE_SIZE);
      _offset = data.length;
      _totalCount = count || 0;

      // 타이틀 업데이트
      const titleEl = _container.querySelector('.nds-c-title');
      if (titleEl) titleEl.innerHTML = '댓글' + (_totalCount > 0 ? `<span>${_totalCount}개</span>` : '');

      listWrap.innerHTML = '';
      if (!data.length) {
        listWrap.innerHTML = '<div class="nds-empty">아직 댓글이 없습니다. 첫 번째 댓글을 작성해보세요!</div>';
        return;
      }

      const list = document.createElement('div');
      list.className = 'nds-list';
      list.id = 'nds-comment-list';
      data.forEach(c => {
        const isOwn = _session && _session.user.id === c.user_id;
        list.appendChild(renderComment(c, isOwn));
      });
      listWrap.appendChild(list);

      if (_totalCount > _offset) {
        appendMoreBtn(listWrap);
      }
    } catch (e) {
      listWrap.innerHTML = `<div class="nds-empty" style="color:#f87171;">불러오기 실패: ${esc(e.message)}</div>`;
    }
  }

  async function refreshList() {
    const listWrap = document.getElementById('nds-list-wrap');
    if (listWrap) await renderList(listWrap);
  }

  function appendMoreBtn(listWrap) {
    const wrap = document.createElement('div');
    wrap.className = 'nds-more-wrap';
    wrap.id = 'nds-more-wrap';

    const btn = document.createElement('button');
    btn.className = 'nds-btn';
    btn.textContent = `더보기 (${_totalCount - _offset}개 남음)`;
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = '불러오는 중...';
      try {
        const { data } = await api.listComments(_pageId, _offset, PAGE_SIZE);
        _offset += data.length;

        const list = document.getElementById('nds-comment-list');
        data.forEach(c => {
          const isOwn = _session && _session.user.id === c.user_id;
          list.appendChild(renderComment(c, isOwn));
        });

        if (_totalCount <= _offset) {
          wrap.remove();
        } else {
          btn.disabled = false;
          btn.textContent = `더보기 (${_totalCount - _offset}개 남음)`;
        }
      } catch (e) {
        showToast(e.message, true);
        btn.disabled = false;
        btn.textContent = '더보기';
      }
    };

    wrap.appendChild(btn);
    listWrap.appendChild(wrap);
  }

  // ─── 인증 핸들러 ─────────────────────────────────────────────────────────
  async function handleSignOut() {
    try {
      await api.signOut();
      _session = null;
      _profile = null;
      render();
      showToast('로그아웃되었습니다.');
    } catch (e) {
      showToast(e.message, true);
    }
  }

  // ─── 초기화 ──────────────────────────────────────────────────────────────
  async function initComments(pageId, containerSelector) {
    _pageId = pageId;
    _container = document.querySelector(containerSelector);
    if (!_container) {
      console.error('[comments.js] 컨테이너를 찾을 수 없습니다:', containerSelector);
      return;
    }
    _container.className = (_container.className + ' nds-comments').trim();

    injectStyles();

    // Supabase SDK 로드 대기
    if (typeof window.supabase === 'undefined') {
      console.error('[comments.js] Supabase SDK가 로드되지 않았습니다.');
      return;
    }

    _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // 세션 확인
    _session = await api.getSession();
    if (_session) {
      _profile = await api.getProfile(_session.user.id);
    }

    // OAuth 리다이렉트 후 auth 상태 변화 처리
    _supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN') {
        _session = session;
        _profile = await api.getProfile(session.user.id);
        render();
      } else if (event === 'SIGNED_OUT') {
        _session = null;
        _profile = null;
        render();
      }
    });

    render();
  }

  // ─── 공개 API ────────────────────────────────────────────────────────────
  global.initComments = initComments;

})(window);
