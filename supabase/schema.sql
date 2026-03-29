-- =============================================
-- nodostream.com 댓글 시스템 스키마
-- Supabase SQL Editor에서 실행하세요.
-- =============================================

-- =============================================
-- 1. profiles 테이블
-- =============================================
CREATE TABLE IF NOT EXISTS public.profiles (
  user_id   UUID        NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname  VARCHAR(30) UNIQUE,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- profiles 읽기: 전체 공개
CREATE POLICY "profiles_select_public"
  ON public.profiles FOR SELECT
  USING (TRUE);

-- profiles insert: 본인만
CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- profiles update: 본인만
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- =============================================
-- 2. comments 테이블
-- =============================================
CREATE TABLE IF NOT EXISTS public.comments (
  id         BIGSERIAL   NOT NULL PRIMARY KEY,
  page_id    VARCHAR(100) NOT NULL,
  user_id    UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content    TEXT         NOT NULL CHECK (char_length(content) <= 1000),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS comments_page_id_idx ON public.comments(page_id);
CREATE INDEX IF NOT EXISTS comments_user_id_idx ON public.comments(user_id);

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

-- comments 읽기: 전체 공개 (소프트 삭제 제외)
CREATE POLICY "comments_select_public"
  ON public.comments FOR SELECT
  USING (deleted_at IS NULL);

-- comments insert: 로그인 사용자만
CREATE POLICY "comments_insert_auth"
  ON public.comments FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' AND auth.uid() = user_id);

-- comments update: 본인만 (content, updated_at)
CREATE POLICY "comments_update_own"
  ON public.comments FOR UPDATE
  USING (auth.uid() = user_id AND deleted_at IS NULL)
  WITH CHECK (auth.uid() = user_id);

-- comments delete(soft): 본인만 deleted_at 설정
-- UPDATE를 통한 소프트 삭제이므로 update 정책으로 커버됨


-- =============================================
-- 3. auth.users 가입 시 profiles 자동 생성 트리거
-- =============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, nickname, avatar_url)
  VALUES (
    NEW.id,
    NULL,
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- =============================================
-- 4. 닉네임 중복 체크 RPC (클라이언트에서 호출)
-- =============================================
CREATE OR REPLACE FUNCTION public.is_nickname_available(p_nickname VARCHAR(30))
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE nickname = p_nickname
  );
$$;


-- =============================================
-- 5. Admin 시스템
-- =============================================

-- profiles에 role 컬럼 추가 (default: 'user', admin은 'admin')
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user';

-- comments에 moderation 컬럼 추가
-- moderation_reason 구조: {"category": "광고/스팸", "detail": "추가 사유"}
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ;
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS moderated_by UUID REFERENCES auth.users(id);
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS moderation_reason JSONB;


-- =============================================
-- 5-1. is_admin(): 현재 유저 admin 여부 확인
-- =============================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$;


-- =============================================
-- 5-2. comments 읽기 정책 재설정
--      일반 유저: deleted + moderated 모두 숨김
--      admin:    전체 열람 가능
-- =============================================
DROP POLICY IF EXISTS "comments_select_public" ON public.comments;
CREATE POLICY "comments_select_public"
  ON public.comments FOR SELECT
  USING (
    (deleted_at IS NULL AND moderated_at IS NULL)
    OR public.is_admin()
  );


-- =============================================
-- 5-3. admin_list_comments(): 전체 댓글 조회 (admin 전용)
-- =============================================
CREATE OR REPLACE FUNCTION public.admin_list_comments(
  p_limit   INT  DEFAULT 50,
  p_offset  INT  DEFAULT 0,
  p_status  TEXT DEFAULT 'all',   -- 'all' | 'normal' | 'deleted' | 'moderated'
  p_page_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  id                BIGINT,
  page_id           VARCHAR(100),
  user_id           UUID,
  content           TEXT,
  created_at        TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ,
  moderated_at      TIMESTAMPTZ,
  moderated_by      UUID,
  moderation_reason JSONB,
  nickname          VARCHAR(30),
  avatar_url        TEXT,
  total_count       BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.page_id,
    c.user_id,
    c.content,
    c.created_at,
    c.updated_at,
    c.deleted_at,
    c.moderated_at,
    c.moderated_by,
    c.moderation_reason,
    p.nickname,
    p.avatar_url,
    COUNT(*) OVER()::BIGINT AS total_count
  FROM public.comments c
  LEFT JOIN public.profiles p ON p.user_id = c.user_id
  WHERE
    CASE p_status
      WHEN 'normal'    THEN c.deleted_at IS NULL AND c.moderated_at IS NULL
      WHEN 'deleted'   THEN c.deleted_at IS NOT NULL
      WHEN 'moderated' THEN c.moderated_at IS NOT NULL AND c.deleted_at IS NULL
      ELSE TRUE
    END
    AND (p_page_id IS NULL OR c.page_id = p_page_id)
  ORDER BY c.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;


-- =============================================
-- 5-4. admin_moderate_comment(): 댓글 숨김 처리 (admin 전용)
-- =============================================
CREATE OR REPLACE FUNCTION public.admin_moderate_comment(
  p_comment_id BIGINT,
  p_category   TEXT,
  p_detail     TEXT DEFAULT ''
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  UPDATE public.comments
  SET
    moderated_at      = NOW(),
    moderated_by      = auth.uid(),
    moderation_reason = jsonb_build_object('category', p_category, 'detail', p_detail)
  WHERE id = p_comment_id;
END;
$$;


-- =============================================
-- 5-5. admin_restore_comment(): 숨김 복원 (admin 전용)
-- =============================================
CREATE OR REPLACE FUNCTION public.admin_restore_comment(
  p_comment_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  UPDATE public.comments
  SET
    moderated_at      = NULL,
    moderated_by      = NULL,
    moderation_reason = NULL
  WHERE id = p_comment_id;
END;
$$;


-- =============================================
-- 5-6. admin_get_stats(): 댓글 통계 (admin 전용)
-- =============================================
CREATE OR REPLACE FUNCTION public.admin_get_stats()
RETURNS TABLE (
  total_comments     BIGINT,
  normal_comments    BIGINT,
  deleted_comments   BIGINT,
  moderated_comments BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT                                                              AS total_comments,
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND moderated_at IS NULL)::BIGINT  AS normal_comments,
    COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::BIGINT                       AS deleted_comments,
    COUNT(*) FILTER (WHERE moderated_at IS NOT NULL AND deleted_at IS NULL)::BIGINT AS moderated_comments
  FROM public.comments;
END;
$$;


-- =============================================
-- 5-7. 관리자 계정 설정
-- =============================================
UPDATE public.profiles
SET role = 'admin'
WHERE user_id = 'd9f762d8-3578-4211-9367-fdaad05a820c';


-- =============================================
-- 6. 대댓글 지원 (parent_id)
-- =============================================
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS parent_id BIGINT
    REFERENCES public.comments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS comments_parent_id_idx
  ON public.comments(parent_id);


-- =============================================
-- 7. comment_likes 테이블 (추천/좋아요)
-- =============================================
CREATE TABLE IF NOT EXISTS public.comment_likes (
  comment_id  BIGINT      NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (comment_id, user_id)
);

ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;

-- 전체 공개 읽기
CREATE POLICY "comment_likes_select_public"
  ON public.comment_likes FOR SELECT
  USING (TRUE);

-- 본인만 INSERT
CREATE POLICY "comment_likes_insert_own"
  ON public.comment_likes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 본인만 DELETE
CREATE POLICY "comment_likes_delete_own"
  ON public.comment_likes FOR DELETE
  USING (auth.uid() = user_id);


-- =============================================
-- 8. admin_list_comments RPC 재정의
--    parent_id, like_count 컬럼 추가
-- =============================================
CREATE OR REPLACE FUNCTION public.admin_list_comments(
  p_limit   INT  DEFAULT 50,
  p_offset  INT  DEFAULT 0,
  p_status  TEXT DEFAULT 'all',
  p_page_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  id                BIGINT,
  page_id           VARCHAR(100),
  user_id           UUID,
  content           TEXT,
  parent_id         BIGINT,
  created_at        TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ,
  moderated_at      TIMESTAMPTZ,
  moderated_by      UUID,
  moderation_reason JSONB,
  nickname          VARCHAR(30),
  avatar_url        TEXT,
  like_count        BIGINT,
  total_count       BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.page_id,
    c.user_id,
    c.content,
    c.parent_id,
    c.created_at,
    c.updated_at,
    c.deleted_at,
    c.moderated_at,
    c.moderated_by,
    c.moderation_reason,
    p.nickname,
    p.avatar_url,
    (SELECT COUNT(*)::BIGINT FROM public.comment_likes cl
     WHERE cl.comment_id = c.id)        AS like_count,
    COUNT(*) OVER()::BIGINT             AS total_count
  FROM public.comments c
  LEFT JOIN public.profiles p ON p.user_id = c.user_id
  WHERE
    CASE p_status
      WHEN 'normal'    THEN c.deleted_at IS NULL AND c.moderated_at IS NULL
      WHEN 'deleted'   THEN c.deleted_at IS NOT NULL
      WHEN 'moderated' THEN c.moderated_at IS NOT NULL AND c.deleted_at IS NULL
      ELSE TRUE
    END
    AND (p_page_id IS NULL OR c.page_id = p_page_id)
  ORDER BY c.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;
