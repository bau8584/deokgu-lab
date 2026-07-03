/* Supabase 연결 설정 — 이 파일만 채우면 전 페이지가 mock→실서버로 전환됩니다.
 * anon(public) key는 브라우저에 노출돼도 안전합니다(RLS로 보호). 공개 repo에 커밋 OK.
 * 값이 비어 있으면 localStorage 목업으로 동작합니다.
 *
 * 연결 순서:
 *   1) supabase.com 에서 프로젝트 생성 (무료)
 *   2) SQL Editor에 supabase/schema.sql 붙여넣어 실행
 *   3) Project Settings → API 에서 아래 두 값 복사해 채우기
 */
window.DEOKGU_SUPABASE = {
  url: '',   // 예: https://abcdefgh.supabase.co
  key: ''    // anon public key (eyJhbGciOi... 로 시작하는 긴 문자열)
};
