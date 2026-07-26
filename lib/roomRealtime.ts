import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

// 룸의 "현황판" — project_state 실시간 동기화 + 접속자 수(Presence) + 최종 확정 P2P 핸드오프용
// 시그널링(offer/answer/ice) 브로드캐스트를 한 채널에서 모두 처리한다.
// (wedding-photo-select/index.html:640-692 subscribeProjectState/initRoomHost 포팅,
//  접속자 수는 기존 dc.onopen/onclose 카운트 대신 Presence로 대체)

export type SignalKind = 'offer' | 'answer' | 'ice';
export type SignalPayload = {
  to: string;
  from: string;
  kind: SignalKind;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

export type ProjectStateRow = {
  users?: { id: string; name: string; color: string }[];
  selections?: Record<string, string[]>;
  notes?: Record<string, any[]>;
  ratings?: Record<string, Record<string, number>>;
  photos?: any[];
};

export type HandoffRequest = { from: string; ids: string[] };

export function createRoomChannel(
  supabase: SupabaseClient,
  projectId: string,
  clientId: string,
  handlers: {
    onStateUpdate: (row: ProjectStateRow) => void;
    onSignal: (payload: SignalPayload) => void;
    onPresenceCount?: (count: number) => void;
    onHandoffRequest?: (req: HandoffRequest) => void; // 호스트 전용: 게스트가 "내 최종 확정본 원본도 줘" 요청
  },
): RealtimeChannel {
  const channel = supabase.channel('room:' + projectId, {
    config: { broadcast: { self: false }, presence: { key: clientId } },
  });

  channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
    if ((payload as SignalPayload).to === clientId) handlers.onSignal(payload as SignalPayload);
  });

  if (handlers.onHandoffRequest) {
    channel.on('broadcast', { event: 'request-handoff' }, ({ payload }) => handlers.onHandoffRequest!(payload as HandoffRequest));
  }

  channel.on(
    'postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'project_state', filter: `project_id=eq.${projectId}` },
    ({ new: row }) => handlers.onStateUpdate(row as ProjectStateRow),
  );

  if (handlers.onPresenceCount) {
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      handlers.onPresenceCount!(Object.keys(state).length);
    });
  }

  return channel;
}

export function broadcastHandoffRequest(channel: RealtimeChannel, from: string, ids: string[]) {
  channel.send({ type: 'broadcast', event: 'request-handoff', payload: { from, ids } });
}

// 접속 중인 다른 클라이언트id 목록(호스트가 게스트들에게 선제 전송할 때 대상 목록으로 사용)
export function getOtherPresenceIds(channel: RealtimeChannel, myClientId: string): string[] {
  const state = channel.presenceState();
  return Object.keys(state).filter((id) => id !== myClientId);
}

export function broadcastSignal(channel: RealtimeChannel, payload: SignalPayload) {
  channel.send({ type: 'broadcast', event: 'signal', payload });
}

export async function subscribeAndTrackPresence(channel: RealtimeChannel) {
  await channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await channel.track({ online_at: new Date().toISOString() });
    }
  });
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

// 선택/노트/별점 변경은 타이핑/클릭마다 즉시 저장하지 않고 300ms 묶어서 저장(디바운스).
// (wedding-photo-select/index.html:658-670 persistProjectState 포팅)
export function persistProjectState(
  supabase: SupabaseClient,
  projectId: string,
  data: {
    sel: Record<string, Set<string>>;
    notes: Record<string, any>;
    ratings: Record<string, any>;
    users: any[];
  },
) {
  if (!projectId) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const selections: Record<string, string[]> = {};
    for (const k of Object.keys(data.sel)) selections[k] = Array.from(data.sel[k]);
    const { error } = await supabase
      .from('project_state')
      .update({
        selections,
        notes: data.notes,
        ratings: data.ratings,
        users: data.users,
        updated_at: new Date().toISOString(),
      })
      .eq('project_id', projectId);
    if (error) console.error('선택 저장 실패:', error.message);
  }, 300);
}
