import type { Session } from '@supabase/supabase-js';

// (wedding-photo-select/landing.html:782-819 formatDisplayName/userFromSession 포팅, 로직 동일)
export type CurrentUser = {
  id: string;
  email: string | null;
  contactEmail: string | null;
  name: string;
  gender: 'male' | 'female';
  birthYear: number | null;
  birthday: string | null;
  provider: string;
  needEmail: boolean;
  needSocialExtra: boolean;
};

export function formatDisplayName(name: string | undefined, email: string | undefined | null, provider: string): string {
  if (name && !name.includes('사용자') && !name.startsWith('kakao_') && !name.startsWith('naver_')) {
    return name;
  }
  if (email && email.includes('@picselec.com')) {
    const idPart = email.split('@')[0];
    const parts = idPart.split('_');
    if (parts.length > 1) {
      const provName = parts[0] === 'kakao' ? '카카오' : parts[0] === 'naver' ? '네이버' : parts[0];
      const num = parts[1].slice(-4);
      return `${provName}#${num}`;
    }
  }
  if (email && !email.includes('@picselec.com')) return email.split('@')[0];
  return name || (provider === 'kakao' ? '카카오회원' : provider === 'naver' ? '네이버회원' : '회원');
}

export function userFromSession(session: Session | null): CurrentUser | null {
  if (!session?.user) return null;
  const u = session.user;
  const meta = u.user_metadata || {};
  const provider = meta.provider || 'email';
  const needEmail = provider !== 'email' && !!meta.need_email && !meta.contact_email;
  return {
    id: u.id,
    email: u.email ?? null,
    contactEmail: meta.contact_email || null,
    name: formatDisplayName(meta.name, u.email, provider),
    gender: meta.gender === 'female' ? 'female' : 'male',
    birthYear: meta.birth_year || null,
    birthday: meta.birthday || null,
    provider,
    needEmail,
    needSocialExtra: provider !== 'email' && (!meta.gender || !meta.birth_year || needEmail),
  };
}
