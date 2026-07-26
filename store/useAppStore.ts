import { create } from 'zustand';

// 이 파일은 기존 vanilla index.html의 전역 `state` 객체 + `room` 객체를 그대로 옮긴 것이다.
// (참고: wedding-photo-select/index.html:402-424 state, :536-557 room)

export type Profile = { id: string; name: string; color: string };

export type Note = {
  id: string;
  user: string;
  userName: string;
  userColor: string;
  text: string;
  time: string;
};

// 브라우징용 사진 한 장. 호스트는 file(원본 File 핸들)을 들고 있고, 게스트는 Storage에서 받은
// blob URL만 가진다 — 원본 접근은 최종 확정 시점의 P2P 핸드오프로만 이루어진다.
export type Photo = {
  id: string;
  name: string;
  folder: string;
  size: number;
  mtime: number;
  url: string;
  path?: string; // Supabase Storage 안에서의 경로({projectId}/{hash}.webp) — 호스트가 업로드 후 채움
  file?: File; // 호스트 전용: 원본 File 핸들(라이트박스 미리보기/최종 P2P 전송에 사용)
};

export type FilterView = 'all' | 'mine' | 'common' | 'similar' | 'eye' | (string & {});

export type RoomMode = 'host' | 'guest' | null;

interface AppState {
  // ---- 프로필/선택 ----
  who: string;
  users: Profile[];
  sel: Record<string, Set<string>>;
  ratings: Record<string, Record<string, number>>;
  notes: Record<string, Note[]>;

  // ---- 사진 ----
  photos: Photo[];
  folders: string[];
  byId: Map<string, Photo>;
  dirHandle: FileSystemDirectoryHandle | null;

  // ---- 스마트 분석 ----
  hashesCache: { id: string; hash: string; folder: string; avgColor: [number, number, number] }[];
  similarGroups: Map<string, string>;
  eyeClosedSet: Set<string>;
  sensLevel: number;

  // ---- 필터/UI ----
  filter: { q: string; folder: string; view: FilterView };
  sideTab: string;
  lbId: string | null;

  // ---- 룸(Supabase 연동) ----
  roomMode: RoomMode;
  projectId: string | null;
  roomCode: string | null;
  connectedGuests: number;

  // ---- 액션 ----
  ensureSelSet: (id: string) => Set<string>;
  userName: (id: string) => string;
  userColor: (id: string) => string;
  setActiveRole: (who: string) => void;
  toggleSelect: (id: string) => void;
  forceSelect: (id: string, val: boolean) => void;
  setRating: (photoId: string, rating: number) => void;
  addNote: (photoId: string, text: string) => void;
  setUsers: (users: Profile[]) => void;
  addProfile: (name: string) => Profile;
  removeProfile: (id: string) => void;
  setPhotos: (photos: Photo[]) => void;
  upsertPhotoUrl: (id: string, url: string) => void;
  setFilter: (patch: Partial<AppState['filter']>) => void;
  setSideTab: (tab: string) => void;
  setSensLevel: (lvl: number) => void;
  setSimilarGroups: (groups: Map<string, string>) => void;
  setEyeClosedSet: (set: Set<string>) => void;
  setHashesCache: (hashes: AppState['hashesCache']) => void;
  openLightbox: (id: string) => void;
  closeLightbox: () => void;
  setDirHandle: (h: FileSystemDirectoryHandle | null) => void;
  setRoom: (patch: Partial<Pick<AppState, 'roomMode' | 'projectId' | 'roomCode' | 'connectedGuests'>>) => void;

  // project_state 행이 realtime으로 갱신될 때 통째로 반영(applyProjectStateRow 포팅)
  applyProjectStateRow: (row: {
    users?: Profile[];
    selections?: Record<string, string[]>;
    notes?: Record<string, Note[]>;
    ratings?: Record<string, Record<string, number>>;
    photos?: Photo[];
  }) => void;
}

const DEFAULT_USERS: Profile[] = [
  { id: 'p1', name: '참여자1', color: '#3B82F6' },
  { id: 'p2', name: '참여자2', color: '#EC4899' },
];

export const useAppStore = create<AppState>((set, get) => ({
  who: 'p1',
  users: DEFAULT_USERS,
  sel: { p1: new Set(), p2: new Set() },
  ratings: {},
  notes: {},

  photos: [],
  folders: [],
  byId: new Map(),
  dirHandle: null,

  hashesCache: [],
  similarGroups: new Map(),
  eyeClosedSet: new Set(),
  sensLevel: 3,

  filter: { q: '', folder: '', view: 'all' },
  sideTab: 'p1',
  lbId: null,

  roomMode: null,
  projectId: null,
  roomCode: null,
  connectedGuests: 0,

  ensureSelSet: (id) => {
    const cur = get().sel[id];
    if (cur) return cur;
    const next = new Set<string>();
    set((s) => ({ sel: { ...s.sel, [id]: next } }));
    return next;
  },

  userName: (id) => get().users.find((u) => u.id === id)?.name || id,
  userColor: (id) => get().users.find((u) => u.id === id)?.color || '#3B82F6',

  setActiveRole: (who) => set({ who }),

  toggleSelect: (id) => {
    const { who, sel } = get();
    const set_ = new Set(sel[who] || []);
    if (set_.has(id)) set_.delete(id);
    else set_.add(id);
    set({ sel: { ...sel, [who]: set_ } });
  },

  forceSelect: (id, val) => {
    const { who, sel } = get();
    const set_ = new Set(sel[who] || []);
    const already = set_.has(id);
    if ((val && already) || (!val && !already)) return;
    if (val) set_.add(id);
    else set_.delete(id);
    set({ sel: { ...sel, [who]: set_ } });
  },

  setRating: (photoId, rating) => {
    set((s) => ({
      ratings: { ...s.ratings, [photoId]: { ...(s.ratings[photoId] || {}), [s.who]: rating } },
    }));
  },

  addNote: (photoId, text) => {
    const { who, userName, userColor } = get();
    const note: Note = {
      id: 'n_' + Date.now(),
      user: who,
      userName: userName(who),
      userColor: userColor(who),
      text,
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
    };
    set((s) => ({ notes: { ...s.notes, [photoId]: [...(s.notes[photoId] || []), note] } }));
  },

  setUsers: (users) => {
    // 목록에 없는 프로필로 셀렉한 이력이 있어도(과거 삭제된 프로필 등) 조회 시 죽지 않도록 매번 보정
    const sel: Record<string, Set<string>> = {};
    users.forEach((u) => {
      sel[u.id] = get().sel[u.id] || new Set();
    });
    set({ users, sel });
  },

  addProfile: (name) => {
    const palette = ['#3B82F6', '#EC4899', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#14B8A6', '#F472B6'];
    const used = new Set(get().users.map((u) => u.color));
    const color = palette.find((c) => !used.has(c)) || palette[get().users.length % palette.length];
    const profile: Profile = { id: 'u_' + Date.now().toString(36), name, color };
    set((s) => ({ users: [...s.users, profile], sel: { ...s.sel, [profile.id]: new Set() } }));
    return profile;
  },

  removeProfile: (id) => {
    set((s) => {
      if (s.users.length <= 1) return s;
      const users = s.users.filter((u) => u.id !== id);
      const who = s.who === id ? users[0].id : s.who;
      const sideTab = s.sideTab === id ? users[0].id : s.sideTab;
      return { users, who, sideTab };
    });
  },

  setPhotos: (photos) => {
    const byId = new Map(photos.map((p) => [p.id, p]));
    set({ photos, byId });
  },

  upsertPhotoUrl: (id, url) => {
    set((s) => {
      const p = s.byId.get(id);
      if (!p) return s;
      const updated = { ...p, url };
      const byId = new Map(s.byId);
      byId.set(id, updated);
      const photos = s.photos.map((x) => (x.id === id ? updated : x));
      return { byId, photos };
    });
  },

  setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
  setSideTab: (tab) => set({ sideTab: tab }),
  setSensLevel: (lvl) => set({ sensLevel: lvl }),
  setSimilarGroups: (groups) => set({ similarGroups: groups }),
  setEyeClosedSet: (set_) => set({ eyeClosedSet: set_ }),
  setHashesCache: (hashes) => set({ hashesCache: hashes }),
  openLightbox: (id) => set({ lbId: id }),
  closeLightbox: () => set({ lbId: null }),
  setDirHandle: (h) => set({ dirHandle: h }),
  setRoom: (patch) => set(patch),

  applyProjectStateRow: (row) => {
    if (row.users && row.users.length) get().setUsers(row.users);
    const sel: Record<string, Set<string>> = {};
    get().users.forEach((u) => {
      sel[u.id] = new Set(row.selections?.[u.id] || []);
    });
    set({ sel, notes: row.notes || {}, ratings: row.ratings || {} });
    if (row.photos) get().setPhotos(row.photos);
  },
}));
