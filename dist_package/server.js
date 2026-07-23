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

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { URL } = require('url');

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
if (sharp && !fs.existsSync(THUMB_DIR)) fs.mkdirSync(THUMB_DIR, { recursive: true });

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
const ZIP_PATH = path.join(APP_DIR, 'PicSelec_Windows_v1.0.zip');

const server = http.createServer(async (req, res) => {
  touchClient(req);

  let u; try { u = new URL(req.url, 'http://localhost'); } catch (_) { res.writeHead(400); return res.end(); }
  const p = u.pathname;

  // 인증 없이 열리는 경로 (이미지 & SSE 실시간 접속 등록)
  if (p === '/' || p === '/index.html') return serveFile(res, INDEX_PATH);
  if (p === '/landing' || p === '/landing.html') return serveFile(res, LANDING_PATH);
  if (p === '/PicSelec_Windows_v1.0.zip') return serveFile(res, ZIP_PATH);
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

  // 이하 전부 인증 필요
  if (!authed(req)) return sendJSON(res, { error: 'unauthorized' }, 401);

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
