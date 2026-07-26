import type { RealtimeChannel } from '@supabase/supabase-js';
import { broadcastSignal, type SignalPayload } from '@/lib/roomRealtime';

// 최종 확정 시점에만 여는 1회성 WebRTC 핸드오프 — Snapdrop 방식으로 선택된 원본만 P2P 직접 전송.
// STUN만 쓰고 TURN은 없다: 실패해도 CSV/파일명 목록이라는 수동 대체 경로가 있어 영향이 작기 때문에
// (설계 논의 참고), 상시 연결 유지가 필요했던 예전 구조와 달리 이 좁은 범위에서는 STUN-only로 충분하다.
const STUN_ONLY_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};
const CHUNK_SIZE = 16 * 1024;
const CONNECT_TIMEOUT_MS = 25000;

// 원격 clientId를 키로 진행 중인 RTCPeerConnection을 추적 — 같은 Realtime 채널에서 오는
// answer/ice 시그널을 어느 커넥션에 연결해야 할지 찾기 위함.
const connsByRemoteId = new Map<string, RTCPeerConnection>();

export type HandoffFile = { id: string; name: string; file: File };
export type HandoffProgress = { done: number; total: number };

// ===== 호스트: 접속 중인 특정 게스트 한 명에게 선택된 원본 파일들을 전송 =====
export function hostSendOriginalsToGuest(
  channel: RealtimeChannel,
  guestClientId: string,
  myClientId: string,
  files: HandoffFile[],
  onProgress?: (p: HandoffProgress) => void,
): Promise<{ ok: boolean }> {
  return new Promise(async (resolve) => {
    const pc = new RTCPeerConnection(STUN_ONLY_CONFIG);
    connsByRemoteId.set(guestClientId, pc);
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      connsByRemoteId.delete(guestClientId);
      try {
        pc.close();
      } catch {}
      resolve({ ok });
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) broadcastSignal(channel, { to: guestClientId, from: myClientId, kind: 'ice', candidate: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) finish(false);
    };

    const dc = pc.createDataChannel('picselec-handoff');
    dc.onopen = async () => {
      let done = 0;
      for (const f of files) {
        if (dc.readyState !== 'open') {
          finish(false);
          return;
        }
        const buf = await f.file.arrayBuffer();
        dc.send(JSON.stringify({ type: 'meta', id: f.id, name: f.name, mime: f.file.type || 'application/octet-stream' }));
        for (let off = 0; off < buf.byteLength; off += CHUNK_SIZE) {
          if (dc.bufferedAmount > CHUNK_SIZE * 8) {
            await new Promise<void>((r) => {
              dc.bufferedAmountLowThreshold = CHUNK_SIZE * 4;
              dc.addEventListener('bufferedamountlow', () => r(), { once: true });
            });
          }
          if (dc.readyState !== 'open') {
            finish(false);
            return;
          }
          dc.send(buf.slice(off, off + CHUNK_SIZE));
        }
        dc.send(JSON.stringify({ type: 'end', id: f.id }));
        done++;
        onProgress?.({ done, total: files.length });
      }
      if (dc.readyState === 'open') dc.send(JSON.stringify({ type: 'all-done' }));
      finish(true);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    broadcastSignal(channel, { to: guestClientId, from: myClientId, kind: 'offer', sdp: offer });

    setTimeout(() => finish(false), CONNECT_TIMEOUT_MS);
  });
}

// ===== 게스트: 호스트가 보낸 offer를 받아 응답하고 파일을 수신 =====
export function guestHandleIncomingOffer(
  channel: RealtimeChannel,
  payload: SignalPayload,
  myClientId: string,
  onFileReceived: (file: { id: string; name: string; blob: Blob }) => void,
  onDone?: () => void,
) {
  const hostClientId = payload.from;
  const pc = new RTCPeerConnection(STUN_ONLY_CONFIG);
  connsByRemoteId.set(hostClientId, pc);

  pc.onicecandidate = (e) => {
    if (e.candidate) broadcastSignal(channel, { to: hostClientId, from: myClientId, kind: 'ice', candidate: e.candidate.toJSON() });
  };

  pc.ondatachannel = (e) => {
    const dc = e.channel;
    dc.binaryType = 'arraybuffer';
    let building: { id: string; name: string; mime: string; chunks: Uint8Array[] } | null = null;

    dc.onmessage = (ev) => {
      if (typeof ev.data !== 'string') {
        building?.chunks.push(new Uint8Array(ev.data));
        return;
      }
      const msg = JSON.parse(ev.data);
      if (msg.type === 'meta') {
        building = { id: msg.id, name: msg.name, mime: msg.mime, chunks: [] };
      } else if (msg.type === 'end') {
        if (building && building.id === msg.id) {
          const blob = new Blob(building.chunks as BlobPart[], { type: building.mime });
          onFileReceived({ id: building.id, name: building.name, blob });
        }
        building = null;
      } else if (msg.type === 'all-done') {
        onDone?.();
        connsByRemoteId.delete(hostClientId);
        try {
          pc.close();
        } catch {}
      }
    };
  };

  (async () => {
    await pc.setRemoteDescription(payload.sdp!);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    broadcastSignal(channel, { to: hostClientId, from: myClientId, kind: 'answer', sdp: answer });
  })();
}

// 페이지의 onSignal 핸들러에서 answer/ice를 이 함수로 그대로 흘려보내면 됨(offer는 호출부에서
// guestHandleIncomingOffer로 직접 분기).
export async function routeAnswerOrIce(payload: SignalPayload) {
  const pc = connsByRemoteId.get(payload.from);
  if (!pc) return;
  if (payload.kind === 'answer' && payload.sdp) await pc.setRemoteDescription(payload.sdp);
  else if (payload.kind === 'ice' && payload.candidate) {
    try {
      await pc.addIceCandidate(payload.candidate);
    } catch {}
  }
}
