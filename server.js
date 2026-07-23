#!/usr/bin/env node
'use strict';

/*
 * 웨딩 사진 셀렉 - 로컬 실시간 서버 (PIN 잠금 + UI 폴더 선택 + 외부 접속)
 * 실행:  node server.js
 *        (사진 폴더는 브라우저에서 골라요. 원하면 인자로 미리 지정도 가능: node server.js "경로")
 * PIN:   실행하면 터미널에 4자리 PIN이 표시됩니다. 고정하려면: PIN=1234 node server.js
 * 외부접속: TUNNEL=true node server.js  또는  node server.js --tunnel
 * 썸네일 가속(선택): npm install sharp
 */

// 로컬 개발용: .env 파일이 있으면 읽어서 process.env에 채워줌 (Vercel은 자체 env var를 쓰니 무해하게 그냥 넘어감)
try { require('dotenv').config(); } catch (_) {}

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { URL } = require('url');

// ---------- Supabase Auth (관리자 권한: SERVICE_ROLE_KEY, 절대 클라이언트에 노출 금지) ----------
// 여기서 예외가 나면(모듈 없음/URL 형식 오류 등) 서버 전체가 죽지 않고 이 기능만 비활성화되도록 방어
let supabaseAdmin = null;
try {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { createClient } = require('@supabase/supabase-js');
    supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  }
} catch (e) {
  console.error('Supabase admin client 초기화 실패(계정삭제/네이버연동 비활성화됨):', e.message);
}

// ---------- 설정 ----------
let PORT = Number(process.env.PORT) || 3000;
const PIN = String(process.env.PIN || Math.floor(1000 + Math.random() * 9000));
const APP_DIR = __dirname;
const STATE_FILE = path.join(APP_DIR, 'selections.json');
const SESSIONS_FILE = path.join(APP_DIR, 'sessions.json');
const THUMB_DIR = path.join(APP_DIR, '.thumbs');
const THUMB_SIZE = 520;
const IMG_EXT = new Set(['.jpg', '.jpeg']);
const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
};

// ---------- 접속자 & SSE 상태 (최상단 선언) ----------
const activeClientsMap = new Map();
const sseClients = new Set();

function getClientIP(req) {
  const cfIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'];
  if (cfIp) return cfIp.split(',')[0].trim();
  const raw = req.socket.remoteAddress || '';
  if (raw === '127.0.0.1' || raw === '::1' || raw === '::ffff:127.0.0.1') return '내 컴퓨터 (localhost)';
  return raw.replace(/^::ffff:/, '');
}

function parseUserAgent(ua) {
  if (!ua) return '기타 기기';
  let device = 'PC';
  if (/iPhone/i.test(ua)) device = '📱 iPhone';
  else if (/iPad/i.test(ua)) device = '📱 iPad';
  else if (/Android/i.test(ua)) device = '📱 Android 폰';
  else if (/Macintosh/i.test(ua)) device = '💻 Mac PC';
  else if (/Windows/i.test(ua)) device = '💻 Windows PC';

  let browser = '';
  if (/CriOS|Chrome/i.test(ua)) browser = 'Chrome';
  else if (/Safari/i.test(ua)) browser = 'Safari';
  else if (/Firefox/i.test(ua)) browser = 'Firefox';
  else if (/Edg/i.test(ua)) browser = 'Edge';

  return `${device} (${browser || '브라우저'})`;
}

function touchClient(req) {
  const ip = getClientIP(req);
  const ua = parseUserAgent(req.headers['user-agent'] || '');
  const isLocal = isLocalReq(req);
  const key = `${ip}|${ua}`;
  
  const now = Date.now();
  const existing = activeClientsMap.get(key);
  const isNew = !existing;

  activeClientsMap.set(key, {
    ip,
    ua,
    isLocal,
    lastSeen: now,
    time: existing ? existing.time : new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  });

  // 2.5분 이상 요청이 없는 오래된 기기 자동 정리
  for (const [k, v] of activeClientsMap.entries()) {
    if (now - v.lastSeen > 150000) {
      activeClientsMap.delete(k);
    }
  }

  if (isNew) {
    console.log(`[실시간 접속] 🟢 ${ua} (IP: ${ip}) 접속! (현재 총 ${activeClientsMap.size}대 기기 활동 중)`);
    broadcast();
  }
}

function getActiveUsersList() {
  const now = Date.now();
  const list = [];
  for (const [k, v] of activeClientsMap.entries()) {
    if (now - v.lastSeen <= 150000) {
      list.push({
        ip: v.ip,
        ua: v.ua,
        isLocal: v.isLocal,
        time: v.time
      });
    }
  }
  return list;
}

let sharp = null;
try { sharp = require('sharp'); } catch (_) {}
// Vercel 등 서버리스 환경은 /var/task(앱 폴더)가 읽기 전용이라 여기서 mkdir이 실패할 수 있음.
// 실패하면 캐시 없이(원본 그대로) 서빙하도록 sharp를 꺼서 나머지 요청은 계속 정상 처리되게 함.
if (sharp) {
  try {
    if (!fs.existsSync(THUMB_DIR)) fs.mkdirSync(THUMB_DIR, { recursive: true });
  } catch (e) {
    console.error('썸네일 캐시 폴더 생성 실패(읽기 전용 환경으로 추정, 캐시 없이 원본으로 서빙):', e.message);
    sharp = null;
  }
}

// ---------- 동적 상태(사진 루트는 런타임에 결정) ----------
let ROOT = null;
let PHOTOS = [];
let PHOTO_IDS = new Set();
let FOLDERS = [];
let scanId = 0; // 루트/스캔이 바뀔 때마다 증가 → 클라이언트 재로딩 트리거

let externalUrl = null;
let tunnelStatus = 'off'; // 'off' | 'starting' | 'ready' | 'error'

let cacheStatus = { total: 0, done: 0, active: false };

const DEFAULT_USERS = [
  { id: 'groom', name: '신랑', color: '#4a90d9' },
  { id: 'bride', name: '신부', color: '#e0669a' }
];

let stateData = {
  selections: { groom: [], bride: [] },
  users: DEFAULT_USERS,
  notes: {},
  ratings: {},
  root: null
};

try {
  if (fs.existsSync(STATE_FILE)) {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (raw.selections) {
      stateData.selections = raw.selections;
    } else {
      stateData.selections = {
        groom: raw.groom || [],
        bride: raw.bride || []
      };
    }
    stateData.users = (Array.isArray(raw.users) && raw.users.length) ? raw.users : DEFAULT_USERS;
    stateData.notes = (raw.notes && typeof raw.notes === 'object') ? raw.notes : {};
    stateData.ratings = (raw.ratings && typeof raw.ratings === 'object') ? raw.ratings : {};
    if (raw.root) stateData.root = raw.root;
  }
} catch (_) {}

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(stateData)); }
    catch (e) { console.error('선택 저장 실패:', e.message); }
  }, 250);
}

function getLocalIPs() {
  const ifs = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifs)) {
    for (const i of (ifs[name] || [])) {
      if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
    }
  }
  return ips;
}

function openBrowser(url) {
  if (process.env.NO_OPEN) return;
  const cp = require('child_process');
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  cp.exec(cmd, () => {});
}

function initTunnel(listenPort) {
  const wantTunnel = process.env.TUNNEL === 'true' || process.argv.includes('--tunnel');
  if (!wantTunnel) return;

  tunnelStatus = 'starting';
  console.log('\n[외부 접속] 외부 접속 터널(Cloudflare Tunnel)을 개설 중입니다. 잠시만 기다려주세요...');

  const cp = require('child_process');
  const child = cp.spawn('npx', ['-y', 'cloudflared', 'tunnel', '--url', `http://localhost:${listenPort}`], { shell: true });

  let found = false;
  const handleLine = (line) => {
    const match = line.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && !found) {
      found = true;
      externalUrl = match[0];
      tunnelStatus = 'ready';
      console.log('\n==================================================');
      console.log(`  ★ 외부 접속 URL 생성 성공! ★`);
      console.log(`  외부 접속 주소: ${externalUrl}`);
      console.log(`  접속 PIN       : ${PIN}`);
      console.log('==================================================\n');
      broadcast();
    }
  };

  child.stdout.on('data', chunk => chunk.toString().split('\n').forEach(handleLine));
  child.stderr.on('data', chunk => chunk.toString().split('\n').forEach(handleLine));
  child.on('error', (err) => {
    tunnelStatus = 'error';
    console.error('[외부 접속] 터널 개설 실패:', err.message);
  });
}

// 백그라운드 초고속 썸네일 pre-caching
let precacheToken = 0;
async function precacheThumbnails() {
  if (!sharp || !ROOT || !PHOTOS.length) return;
  const currentToken = ++precacheToken;
  cacheStatus = { total: PHOTOS.length, done: 0, active: true };
  console.log(`[썸네일 고속 가속] ${PHOTOS.length}장에 대한 백그라운드 썸네일 캐싱을 시작합니다...`);

  const CONCURRENCY = 8;
  let idx = 0;

  async function worker() {
    while (idx < PHOTOS.length && precacheToken === currentToken) {
      const p = PHOTOS[idx++];
      if (!p) break;
      const abs = safeAbs(p.id);
      if (!abs) continue;
      try {
        const st = fs.statSync(abs);
        const key = crypto.createHash('md5').update((ROOT || '') + '|' + p.id + '|' + st.mtimeMs).digest('hex');
        const cachePath = path.join(THUMB_DIR, key + '.jpg');
        if (!fs.existsSync(cachePath)) {
          const buf = await sharp(abs).rotate().resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
          fs.writeFileSync(cachePath, buf);
        }
      } catch (_) {}
      cacheStatus.done++;
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);
  if (precacheToken === currentToken) {
    cacheStatus.active = false;
    console.log(`[썸네일 고속 가속] 완료! ${cacheStatus.done}/${cacheStatus.total}장 준비 완료.`);
  }
}

// 재귀 스캔(하위폴더 전부 펼침, 숨김폴더 제외)
function scan(dir, base) {
  let out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out = out.concat(scan(full, base));
    else if (IMG_EXT.has(path.extname(ent.name).toLowerCase())) {
      const rel = path.relative(base, full).split(path.sep).join('/');
      let size = 0, mtime = 0;
      try {
        const st = fs.statSync(full);
        size = st.size;
        mtime = Math.floor(st.mtimeMs || st.birthtimeMs || 0);
      } catch (_) {}
      const dirRel = path.dirname(rel);
      out.push({ id: rel, name: ent.name, folder: dirRel === '.' ? '(최상위)' : dirRel, size, mtime });
    }
  }
  return out;
}

function stateMsg() {
  return JSON.stringify({
    groom: stateData.selections.groom || [],
    bride: stateData.selections.bride || [],
    selections: stateData.selections,
    users: stateData.users,
    notes: stateData.notes || {},
    ratings: stateData.ratings || {},
    scanId,
    rootName: ROOT,
    total: PHOTOS.length,
    externalUrl,
    tunnelStatus,
    ips: getLocalIPs(),
    pin: PIN,
    port: PORT,
    cacheStatus,
    activeUsers: getActiveUsersList()
  });
}

function broadcast() {
  const line = `data: ${stateMsg()}\n\n`;
  for (const res of sseClients) { try { res.write(line); } catch (_) {} }
}

function setRoot(p) {
  if (!p) return { ok: false, error: '경로가 비어 있어요.' };
  const abs = path.resolve(p);
  let st; try { st = fs.statSync(abs); } catch (_) { return { ok: false, error: '폴더를 찾을 수 없어요.' }; }
  if (!st.isDirectory()) return { ok: false, error: '폴더가 아니에요.' };
  ROOT = abs;
  stateData.root = abs;
  const photos = scan(abs, abs);
  photos.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }));
  PHOTOS = photos;
  PHOTO_IDS = new Set(photos.map(x => x.id));
  FOLDERS = Array.from(new Set(photos.map(x => x.folder))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  
  // 새 루트에 존재하는 선택만 유지
  if (!stateData.selections) stateData.selections = {};
  for (const k of Object.keys(stateData.selections)) {
    if (Array.isArray(stateData.selections[k])) {
      stateData.selections[k] = stateData.selections[k].filter(id => PHOTO_IDS.has(id));
    }
  }
  stateData.groom = stateData.selections.groom || [];
  stateData.bride = stateData.selections.bride || [];

  scanId++;
  saveState(); broadcast();
  console.log(`폴더 설정: ${abs} — 사진 ${photos.length}장, 폴더 ${FOLDERS.length}개`);
  
  // 백그라운드 캐싱 자동 실행
  precacheThumbnails();

  return { ok: true, total: photos.length };
}

// 저장되었거나 wdpt 폴더가 존재하면 자동 복원
if (stateData.root && fs.existsSync(stateData.root)) {
  setRoot(stateData.root);
} else {
  const candidates = [
    path.join(APP_DIR, 'wdpt'),
    path.join(process.cwd(), 'wdpt'),
    path.join(path.dirname(APP_DIR), 'wdpt')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isDirectory()) {
      setRoot(c);
      break;
    }
  }
}

// 폴더 탐색(윈도우 드라이브 포함)
function listDir(reqPath) {
  const isWin = process.platform === 'win32';
  if (isWin && (reqPath === 'DRIVES')) {
    const drives = [];
    for (let c = 65; c <= 90; c++) { const d = String.fromCharCode(c) + ':\\'; try { if (fs.existsSync(d)) drives.push(d); } catch (_) {} }
    return { path: 'DRIVES', parent: null, dirs: [], drives };
  }
  const target = path.resolve(reqPath || os.homedir());
  let entries;
  try { entries = fs.readdirSync(target, { withFileTypes: true }); }
  catch (e) { return { error: '이 폴더를 열 수 없어요 (' + e.code + ')' }; }
  const dirs = [];
  for (const ent of entries) if (ent.isDirectory() && !ent.name.startsWith('.')) dirs.push({ name: ent.name, path: path.join(target, ent.name) });
  dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const par = path.dirname(target);
  let parent = null;
  if (par !== target) parent = par; else if (isWin) parent = 'DRIVES';
  return { path: target, parent, dirs, drives: [] };
}

// ---------- 영구 인증 세션 보존 ----------
const sessions = new Set();
try {
  if (fs.existsSync(SESSIONS_FILE)) {
    const list = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    if (Array.isArray(list)) list.forEach(t => sessions.add(t));
  }
} catch (_) {}

function saveSessions() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Array.from(sessions)));
  } catch (_) {}
}

let fails = 0, lockUntil = 0;
function newToken() { return crypto.randomBytes(24).toString('hex'); }
function parseCookies(req) {
  const h = req.headers.cookie || ''; const o = {};
  h.split(';').forEach(pair => { const i = pair.indexOf('='); if (i > 0) o[pair.slice(0, i).trim()] = pair.slice(i + 1).trim(); });
  return o;
}
function authed(req) { 
  if (isLocalReq(req)) return true; // 내 컴퓨터(서버 PC) 본인 접속은 PIN 입력 없이 즉시 통과!
  const c = parseCookies(req); 
  return !!(c.wps_session && sessions.has(c.wps_session)); 
}
function isLocalReq(req) {
  const remote = req.socket.remoteAddress || '';
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
}

// ---------- 유틸 ----------
function safeAbs(rel) {
  if (!ROOT) return null;
  const abs = path.resolve(ROOT, rel);
  const rootAbs = path.resolve(ROOT);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null;
  return abs;
}
function sendJSON(res, obj, code = 200, headers = {}) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length }, headers));
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = ''; req.on('data', c => { d += c; if (d.length > 8e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch (_) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
function serveFile(res, abs) {
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'public, max-age=86400' });
    fs.createReadStream(abs).pipe(res);
  });
}
// 프론트에서 쓰는 Supabase 공개 키(anon key)를 서빙 시점에 주입 (소스에 하드코딩하지 않기 위함)
function serveHtmlWithEnv(res, abs) {
  fs.readFile(abs, 'utf8', (err, html) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const out = html
      .replace(/__SUPABASE_URL__/g, process.env.SUPABASE_URL || '')
      .replace(/__SUPABASE_ANON_KEY__/g, process.env.SUPABASE_ANON_KEY || '')
      .replace(/__KAKAO_JS_KEY__/g, process.env.KAKAO_JS_KEY || '');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(out);
  });
}
async function serveThumb(res, abs, rel) {
  if (!sharp) return serveFile(res, abs);
  try {
    const st = fs.statSync(abs);
    const key = crypto.createHash('md5').update((ROOT || '') + '|' + rel + '|' + st.mtimeMs).digest('hex');
    const cachePath = path.join(THUMB_DIR, key + '.jpg');
    if (fs.existsSync(cachePath)) return serveFile(res, cachePath);
    const buf = await sharp(abs).rotate().resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
    fs.writeFile(cachePath, buf, () => {});
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=86400' });
    res.end(buf);
  } catch (_) { serveFile(res, abs); }
}

// 셀렉본 복사
function copySelected(ids, mode, destName) {
  if (!ROOT) throw new Error('사진 폴더가 설정되지 않았어요.');
  const valid = ids.filter(id => PHOTO_IDS.has(id));
  const safeName = (destName || '').trim().replace(/[\\/:*?"<>|]/g, '_');
  const folderName = safeName || ('_최종셀렉_' + new Date().toISOString().slice(0, 10));
  const destDir = path.join(path.dirname(ROOT), folderName);
  fs.mkdirSync(destDir, { recursive: true });
  let count = 0; const errors = [];
  valid.forEach((id, i) => {
    const src = safeAbs(id); if (!src) return;
    let base = path.basename(id);
    if (mode === 'number') base = String(i + 1).padStart(2, '0') + '_' + base;
    let target = path.join(destDir, base), c = 1;
    while (fs.existsSync(target)) { const e = path.extname(base), nm = path.basename(base, e); target = path.join(destDir, `${nm}(${c})${e}`); c++; }
    try { fs.copyFileSync(src, target); count++; } catch (_) { errors.push(base); }
  });
  return { dir: destDir, count, total: valid.length, errors };
}

// ---------- HTTP ----------
const INDEX_PATH = path.join(APP_DIR, 'index.html');
const LANDING_PATH = path.join(APP_DIR, 'landing.html');

const server = http.createServer(async (req, res) => {
  touchClient(req);

  let u; try { u = new URL(req.url, 'http://localhost'); } catch (_) { res.writeHead(400); return res.end(); }
  const p = u.pathname;

  // 루트 접속 시 메인 랜딩페이지(landing.html)가 표시됨!
  if (p === '/' || p === '/landing' || p === '/landing.html') return serveHtmlWithEnv(res, LANDING_PATH);
  if (p === '/app' || p === '/select' || p === '/index.html') return serveHtmlWithEnv(res, INDEX_PATH);
  if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (p === '/img' || p === '/thumb') {
    const abs = safeAbs(u.searchParams.get('path') || '');
    if (!abs) { res.writeHead(403); return res.end('forbidden'); }
    return p === '/thumb' ? serveThumb(res, abs, u.searchParams.get('path')) : serveFile(res, abs);
  }

  if (p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    sseClients.add(res);
    broadcast();

    const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch (_) {} }, 25000);
    req.on('close', () => {
      clearInterval(ka);
      sseClients.delete(res);
      broadcast();
    });
    return;
  }

  if (p === '/api/me') return sendJSON(res, {
    authed: authed(req),
    rootReady: scanId > 0,
    isLocal: isLocalReq(req),
    platform: process.platform,
    pin: PIN,
    ips: getLocalIPs(),
    port: PORT,
    externalUrl,
    tunnelStatus,
    cacheStatus,
    activeUsers: getActiveUsersList()
  });
  // 자체 회원가입/로그인/비밀번호 재설정은 브라우저에서 Supabase Auth(supabase-js)로 직접 처리합니다.
  // (landing.html 참고: supabase.auth.signUp / signInWithPassword / resetPasswordForEmail / updateUser)
  // 서버는 세션 토큰을 발급하지 않고, Supabase가 내려준 access_token만 검증합니다.

  // 회원 탈퇴 / 계정 삭제 API — 반드시 "본인의" Supabase 세션으로만 본인 계정을 삭제
  if (p === '/api/auth/delete-account' && req.method === 'POST') {
    if (!supabaseAdmin) return sendJSON(res, { ok: false, error: '서버에 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.' }, 500);

    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return sendJSON(res, { ok: false, error: '로그인이 필요합니다.' }, 401);

    // 클라이언트가 보낸 email은 절대 신뢰하지 않고, 토큰으로부터 검증된 본인 계정만 사용
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return sendJSON(res, { ok: false, error: '세션이 유효하지 않습니다.' }, 401);

    const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(userData.user.id);
    if (delErr) return sendJSON(res, { ok: false, error: delErr.message }, 500);

    return sendJSON(res, { ok: true, message: '회원 탈퇴 및 계정 삭제가 완료되었습니다.' });
  }

  // 카카오/네이버 로그인 — Supabase Auth의 Kakao 프로바이더는 이메일 동의항목(account_email)을
  // 요구하는데, 비즈니스 인증이 안 된 카카오 앱은 그 동의항목 자체를 설정할 수 없어 KOE205로
  // 막힙니다. 그래서 카카오도 네이버처럼 자체 OAuth 교환 후 Supabase 유저로 연동(federate)합니다.
  if (p.startsWith('/api/auth/')) {
    const actionPath = p.replace('/api/auth/', '');
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'picselec.com';
    const baseUrl = `${proto}://${host}`;

    // 소셜 로그인 인증 완료 후 돌아오는 콜백 (Callback) 처리
    if (actionPath.endsWith('/callback')) {
      const provider = actionPath.split('/')[0];
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const code = parsedUrl.searchParams.get('code');

      let userName = `${provider.toUpperCase()} 회원`;
      let userEmail = `${provider}_user@picselec.com`;
      let userGender = null;
      let userBirthYear = null;
      let userBirthday = null;
      let needEmail = true; // 실제 이메일을 받으면 false로 바뀜 — 마이페이지에서 추가 입력 요청용

      try {
        // 카카오 토큰 & 프로필 조회 (이메일 동의항목이 없을 수 있어 없으면 임시 이메일로 대체)
        if (provider === 'kakao' && code && process.env.KAKAO_CLIENT_ID) {
          const bodyParams = new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: process.env.KAKAO_CLIENT_ID,
            redirect_uri: `${baseUrl}/api/auth/kakao/callback`,
            code
          });
          if (process.env.KAKAO_CLIENT_SECRET) {
            bodyParams.append('client_secret', process.env.KAKAO_CLIENT_SECRET);
          }
          const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
            body: bodyParams
          });
          const tokenData = await tokenRes.json();
          if (tokenData.access_token) {
            const profileRes = await fetch('https://kapi.kakao.com/v2/user/me', {
              headers: { Authorization: `Bearer ${tokenData.access_token}` }
            });
            const profileData = await profileRes.json();
            const kakaoAcc = profileData.kakao_account || {};
            const prof = kakaoAcc.profile || profileData.properties || {};
            const rawNickname = prof.nickname || profileData.properties?.nickname || kakaoAcc.name;
            const idSuffix = profileData.id ? String(profileData.id).slice(-4) : String(Date.now()).slice(-4);
            userName = rawNickname || `카카오#${idSuffix}`;
            if (kakaoAcc.email) { userEmail = kakaoAcc.email; needEmail = false; }
            else { userEmail = `kakao_${profileData.id || Date.now()}@picselec.com`; }
          }
        }

        // 네이버 토큰 & 프로필 조회
        if (provider === 'naver' && code && process.env.NAVER_CLIENT_ID) {
          const clientSecret = process.env.NAVER_CLIENT_SECRET || '';
          const tokenRes = await fetch(`https://nid.naver.com/oauth2.0/token?grant_type=authorization_code&client_id=${encodeURIComponent(process.env.NAVER_CLIENT_ID)}&client_secret=${encodeURIComponent(clientSecret)}&code=${encodeURIComponent(code)}&state=picselec_state`);
          const tokenData = await tokenRes.json();
          if (tokenData.access_token) {
            const profileRes = await fetch('https://openapi.naver.com/v1/nid/me', {
              headers: { Authorization: `Bearer ${tokenData.access_token}` }
            });
            const profileData = await profileRes.json();
            const nResp = profileData.response || {};
            const rawName = nResp.name || nResp.nickname;
            const nIdSuffix = nResp.id ? String(nResp.id).slice(-4) : String(Date.now()).slice(-4);
            userName = rawName || `네이버#${nIdSuffix}`;
            if (nResp.email) { userEmail = nResp.email; needEmail = false; }
            else { userEmail = `naver_${String(nResp.id || Date.now()).slice(-4)}@picselec.com`; }
            if (nResp.gender) userGender = (nResp.gender === 'F' || nResp.gender === 'female') ? 'female' : 'male';
            if (nResp.birthyear) userBirthYear = nResp.birthyear;
            if (nResp.birthday) userBirthday = nResp.birthday;
          }
        }

      } catch (err) {
        console.error('OAuth profile fetch error:', err.message);
      }

      // Supabase Auth에 실제 유저로 연동(federate): 없으면 생성, 있으면 매직링크 토큰 발급
      if (!supabaseAdmin) {
        res.writeHead(302, { 'Location': `/?social_auth=need_key&provider=${provider}&reason=no_supabase` });
        return res.end();
      }

      const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email: userEmail,
        options: {
          data: {
            name: userName,
            gender: userGender || 'male',
            birth_year: userBirthYear || null,
            birthday: userBirthday || null,
            provider,
            need_email: needEmail
          }
        }
      });

      if (linkErr || !linkData?.properties?.hashed_token) {
        console.error('Supabase generateLink error:', linkErr?.message);
        res.writeHead(302, { 'Location': `/?social_auth=error&provider=${provider}` });
        return res.end();
      }

      // 이미 가입된 유저인 경우에도 metadata name을 최신 카카오/네이버 프로필 닉네임으로 최신화
      if (linkData?.user?.id) {
        try {
          const existingMeta = linkData.user.user_metadata || {};
          const currentName = existingMeta.name;
          const isGenericName = !currentName || currentName.includes('사용자') || currentName.startsWith('kakao_') || currentName.startsWith('naver_');
          
          await supabaseAdmin.auth.admin.updateUserById(linkData.user.id, {
            user_metadata: {
              ...existingMeta,
              name: isGenericName ? userName : currentName,
              provider,
              need_email: needEmail && existingMeta.need_email !== false
            }
          });
        } catch (updErr) {
          console.error('Failed updating user_metadata on OAuth login:', updErr.message);
        }
      }

      const redirectParams = new URLSearchParams({
        social_verify: '1',
        provider,
        email: userEmail,
        token_hash: linkData.properties.hashed_token
      });

      res.writeHead(302, { 'Location': `/?${redirectParams.toString()}` });
      return res.end();
    }

    const provider = actionPath;

    // 카카오 OAuth
    if (provider === 'kakao') {
      const clientId = process.env.KAKAO_CLIENT_ID;
      if (clientId) {
        const kakaoAuthUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(baseUrl + '/api/auth/kakao/callback')}&response_type=code`;
        res.writeHead(302, { 'Location': kakaoAuthUrl });
        return res.end();
      }
    }

    // 네이버 OAuth
    if (provider === 'naver') {
      const clientId = process.env.NAVER_CLIENT_ID;
      if (clientId) {
        const naverAuthUrl = `https://nid.naver.com/oauth2.0/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(baseUrl + '/api/auth/naver/callback')}&response_type=code&state=picselec_state`;
        res.writeHead(302, { 'Location': naverAuthUrl });
        return res.end();
      }
    }

    // 구글은 Supabase Auth 기본 프로바이더라 서버를 거치지 않고 클라이언트에서
    // supabase.auth.signInWithOAuth({ provider: 'google' })로 바로 처리합니다.

    // 키가 아직 Vercel에 세팅되지 않은 경우
    if (['kakao', 'naver'].includes(provider)) {
      res.writeHead(302, { 'Location': `/?social_auth=need_key&provider=${provider}` });
      return res.end();
    }
  }

  if (p === '/api/auth' && req.method === 'POST') {
    const b = await readBody(req); const now = Date.now();
    if (now < lockUntil) return sendJSON(res, { ok: false, locked: true, wait: Math.ceil((lockUntil - now) / 1000) });
    if (String(b.pin) === PIN) {
      fails = 0;
      const t = newToken();
      sessions.add(t);
      saveSessions();
      return sendJSON(res, { ok: true, rootReady: scanId > 0 }, 200, {
        'Set-Cookie': `wps_session=${t}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`
      });
    }
    fails++; let locked = false, wait = 0;
    if (fails >= 5) { lockUntil = now + 30000; fails = 0; locked = true; wait = 30; }
    return sendJSON(res, { ok: false, locked, wait });
  }

  if (p === '/api/photos') return sendJSON(res, { photos: PHOTOS, folders: FOLDERS, total: PHOTOS.length, root: ROOT });
  if (p === '/api/state') return sendJSON(res, {
    groom: stateData.selections.groom || [],
    bride: stateData.selections.bride || [],
    selections: stateData.selections,
    users: stateData.users,
    notes: stateData.notes || {},
    ratings: stateData.ratings || {},
    scanId,
    rootName: ROOT,
    externalUrl,
    tunnelStatus,
    ips: getLocalIPs(),
    pin: PIN,
    port: PORT,
    cacheStatus,
    activeUsers: getActiveUsersList()
  });

  // 이하 전부 인증 필요
  if (!authed(req)) return sendJSON(res, { error: 'unauthorized' }, 401);

  if (p === '/api/browse') {
    return sendJSON(res, listDir(u.searchParams.get('path') || ''));
  }
  if (p === '/api/set-root' && req.method === 'POST') {
    const b = await readBody(req);
    return sendJSON(res, setRoot(b.path));
  }

  if (p === '/api/select' && req.method === 'POST') {
    const b = await readBody(req);
    const who = (b.who || '').trim();
    if (!who || !PHOTO_IDS.has(b.id)) return sendJSON(res, { ok: false }, 400);
    if (!stateData.selections[who]) stateData.selections[who] = [];
    const set = new Set(stateData.selections[who]);
    if (b.selected) set.add(b.id); else set.delete(b.id);
    stateData.selections[who] = Array.from(set);
    stateData.groom = stateData.selections.groom || [];
    stateData.bride = stateData.selections.bride || [];
    saveState(); broadcast();
    return sendJSON(res, { ok: true });
  }

  if (p === '/api/note/save' && req.method === 'POST') {
    const b = await readBody(req);
    const photoId = (b.id || '').trim();
    const text = (b.text || '').trim();
    const who = (b.who || 'groom').trim();
    if (!photoId || !text) return sendJSON(res, { ok: false, error: '내용이 없어요' }, 400);

    if (!stateData.notes) stateData.notes = {};
    if (!stateData.notes[photoId]) stateData.notes[photoId] = [];

    const userObj = (stateData.users || []).find(u => u.id === who) || { name: '참여자', color: '#3498db' };
    const noteObj = {
      id: 'n_' + Date.now(),
      user: who,
      userName: userObj.name,
      userColor: userObj.color,
      text,
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    };

    stateData.notes[photoId].push(noteObj);
    saveState(); broadcast();
    return sendJSON(res, { ok: true, note: noteObj, notes: stateData.notes[photoId] });
  }

  if (p === '/api/note/delete' && req.method === 'POST') {
    const b = await readBody(req);
    const photoId = (b.id || '').trim();
    const noteId = (b.noteId || '').trim();
    if (!photoId || !noteId || !stateData.notes || !stateData.notes[photoId]) return sendJSON(res, { ok: false }, 400);

    stateData.notes[photoId] = stateData.notes[photoId].filter(n => n.id !== noteId);
    if (stateData.notes[photoId].length === 0) delete stateData.notes[photoId];

    saveState(); broadcast();
    return sendJSON(res, { ok: true });
  }

  if (p === '/api/rating/set' && req.method === 'POST') {
    const b = await readBody(req);
    const photoId = (b.id || '').trim();
    const rating = parseInt(b.rating) || 0;
    const who = (b.who || 'groom').trim();
    if (!photoId) return sendJSON(res, { ok: false }, 400);

    if (!stateData.ratings) stateData.ratings = {};
    if (!stateData.ratings[photoId]) stateData.ratings[photoId] = {};

    if (rating > 0) {
      stateData.ratings[photoId][who] = rating;
    } else {
      delete stateData.ratings[photoId][who];
      if (Object.keys(stateData.ratings[photoId]).length === 0) delete stateData.ratings[photoId];
    }

    saveState(); broadcast();
    return sendJSON(res, { ok: true, ratings: stateData.ratings[photoId] });
  }

  if (p === '/api/user/save' && req.method === 'POST') {
    const b = await readBody(req);
    const id = (b.id || ('u_' + Date.now())).trim();
    const name = (b.name || '').trim();
    const color = (b.color || '#3498db').trim();
    if (!name) return sendJSON(res, { ok: false, error: '이름을 입력해주세요.' }, 400);

    let found = stateData.users.find(u => u.id === id);
    if (found) {
      found.name = name;
      found.color = color;
    } else {
      stateData.users.push({ id, name, color });
      if (!stateData.selections[id]) stateData.selections[id] = [];
    }
    saveState(); broadcast();
    return sendJSON(res, { ok: true, user: { id, name, color } });
  }

  if (p === '/api/user/delete' && req.method === 'POST') {
    const b = await readBody(req);
    const id = (b.id || '').trim();
    if (stateData.users.length <= 1) return sendJSON(res, { ok: false, error: '최소 1명의 참여자는 있어야 해요.' }, 400);
    stateData.users = stateData.users.filter(u => u.id !== id);
    delete stateData.selections[id];
    saveState(); broadcast();
    return sendJSON(res, { ok: true });
  }

  if (p === '/api/copy' && req.method === 'POST') {
    const b = await readBody(req);
    const ids = Array.isArray(b.ids) ? b.ids : [];
    if (!ids.length) return sendJSON(res, { ok: false, error: '선택된 사진이 없어요.' }, 400);
    try { const r = copySelected(ids, b.mode || 'keep', b.destName); console.log(`복사 완료: ${r.count}/${r.total} → ${r.dir}`); return sendJSON(res, { ok: true, ...r }); }
    catch (e) { return sendJSON(res, { ok: false, error: e.message }, 500); }
  }

  res.writeHead(404); res.end('not found');
});

// 인자로 폴더를 미리 준 경우 즉시 설정(선택)
if (process.argv[2] && !process.argv[2].startsWith('--')) { const r = setRoot(process.argv[2]); if (!r.ok) console.error('[안내] 지정한 폴더를 못 열었어요. 브라우저에서 고르면 됩니다:', r.error); }

// 포트 중복(EADDRINUSE) 처리 및 자동 다음 포트 전환
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`[안내] ${PORT}번 포트가 사용 중입니다. 다음 포트(${PORT + 1})로 연결합니다...`);
    PORT++;
    startServer(PORT);
  } else {
    console.error('서버 오류:', err.message);
  }
});

function startServer(p) {
  server.listen(p, '0.0.0.0', () => {
    const ips = getLocalIPs();
    const localUrl = `http://localhost:${p}`;

    console.log('\n==================================================');
    console.log('         💒 웨딩 사진 셀렉 서버 💒');
    console.log('==================================================');
    console.log(`  ★ 접속 PIN : 【 ${PIN} 】  (신부/신랑 접속용)`);
    console.log('--------------------------------------------------');
    console.log(`  사진 폴더: ${ROOT ? ROOT : '브라우저에서 선택'}`);
    console.log(`  썸네일   : ${sharp ? '⚡ 초고속 가속 켜짐 (sharp)' : '꺼짐'}`);
    console.log('\n  [접속 주소]');
    console.log(`  1. 이 컴퓨터        : ${localUrl}`);
    if (ips.length) ips.forEach(ip => console.log(`  2. 같은 와이파이(폰): http://${ip}:${p}`));
    console.log('--------------------------------------------------');
    console.log('  종료하려면 이 창을 닫거나 Ctrl+C를 누르세요.');
    console.log('==================================================\n');

    openBrowser(localUrl);
    initTunnel(p);
  });
}

startServer(PORT);
