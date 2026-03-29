/**
 * supabase-init.js — 공용 Supabase 클라이언트 싱글턴
 *
 * 모든 페이지에서 이 파일을 Supabase CDN 스크립트 다음에 로드.
 * window.__supabaseClient 로 공유 인스턴스에 접근.
 */
(function () {
  'use strict';

  if (window.__supabaseClient) return; // 이미 초기화된 경우 스킵

  const SUPABASE_URL     = 'https://gvhwaeoyxkmdquxkumkh.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_NW9SJO3uG_fLbhlNywuuow_KsqD1N9J';

  window.__supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession:    true,
      autoRefreshToken:  true,
      detectSessionInUrl: true,
      flowType:          'pkce'
    }
  });
})();
