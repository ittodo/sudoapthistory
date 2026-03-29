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
