const http = require('http');
const fs = require('fs');
const path = require('path');

const START_PORT = Number(process.env.PORT || 8080);
const HOST = '127.0.0.1';
const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, 'overlay-config.json');
const STATE_FILE = path.join(ROOT, 'overlay-server.json');
const clients = new Set();
const chatClients = new Set();
let ytTimer = null;
let ytContinuation = null;
let ytApiKey = null;
let ytClientVersion = '2.20240601.00.00';
let ytCurrentVideoId = '';
const seenYtMessages = new Set();

const defaults = {
  youtubeUrl: '',
  twitchChannel: ''
};
const CONFIG_LIMITS = {
  youtubeUrl: 2048,
  twitchChannel: 64
};
// YouTube chat is polled, not pushed, so messages arrive in batches. Measured against
// a live stream: YouTube asks for a 10s poll interval (we use 2.5s), the newest message
// in a batch is already ~1.2s old on arrival, and the first poll replays ~90s of chat.
const YT_BACKLOG_MS = 10_000; // on connect, ignore chat older than this
const YT_BACKLOG_MAX = 8;     // ...and show at most this many, however busy the chat
// Drain each batch across (almost) the whole gap until the next poll, so messages keep
// flowing instead of arriving in a rush followed by dead air. Draining faster than this
// is what made chat look bursty even once batches were split up.
const YT_SPREAD_RATIO = 0.9;
const YT_MAX_GAP_MS = 450;    // cap for sparse chat, so two messages aren't held apart
const ytQueue = [];
let ytDrainTimer = null;
let ytPrimed = false;         // false until the first batch has been handled
let ytPollDelay = 2500;       // the interval actually in use, tracked for the drain rate

const MAX_BODY_BYTES = 16 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

function securityHeaders(contentType) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin'
  };
  if (contentType?.startsWith('text/html')) {
    headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
  }
  return headers;
}

function localRequestOrigin(req) {
  try {
    const parsed = new URL(`http://${req.headers.host || ''}`);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function isAllowedOrigin(req, requestOrigin) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).origin === requestOrigin;
  } catch {
    return false;
  }
}

function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

function readConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const clean = {};
    for (const key of Object.keys(defaults)) {
      clean[key] = String(saved[key] || '').trim().slice(0, CONFIG_LIMITS[key]);
    }
    if (clean.twitchChannel && !/^[a-zA-Z0-9_]{1,25}$/.test(clean.twitchChannel)) clean.twitchChannel = '';
    return clean;
  } catch {
    return { ...defaults };
  }
}

function writeConfig(config) {
  const clean = {};
  for (const key of Object.keys(defaults)) {
    clean[key] = String(config[key] || '').trim().slice(0, CONFIG_LIMITS[key]);
  }
  if (clean.twitchChannel && !/^[a-zA-Z0-9_]{1,25}$/.test(clean.twitchChannel)) {
    throw new Error('Twitch channel must contain only letters, numbers, or underscores.');
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(clean, null, 2));
  return clean;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...securityHeaders('application/json')
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES && !settled) {
        settled = true;
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!settled) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', err => {
      if (!settled) reject(err);
    });
  });
}

function sseEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function broadcast(subscribers, event, data) {
  const msg = sseEvent(event, data);
  for (const res of subscribers) res.write(msg);
}

function parseVideoId(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.hostname.includes('youtube.com')) {
      if (url.searchParams.get('v')) return url.searchParams.get('v');
      const match = url.pathname.match(/\/(?:live|embed|shorts)\/([a-zA-Z0-9_-]{11})/);
      if (match) return match[1];
    }
    if (url.hostname === 'youtu.be') return url.pathname.slice(1, 12);
  } catch {}
  return /^[a-zA-Z0-9_-]{11}$/.test(value.trim()) ? value.trim() : '';
}

function findKey(obj, key) {
  if (!obj || typeof obj !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  for (const value of Object.values(obj)) {
    const found = findKey(value, key);
    if (found) return found;
  }
  return null;
}

function extractJsonAfter(html, marker) {
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const brace = html.indexOf('{', start);
  if (brace === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = brace; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(html.slice(brace, i + 1));
    }
  }
  return null;
}

function bestThumb(image) {
  const thumbs = image?.thumbnails || [];
  if (!thumbs.length) return '';
  const url = thumbs[thumbs.length - 1].url || thumbs[0].url || '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `https://www.youtube.com${url}`;
  return url;
}

function proxiedImage(url) {
  if (!url || url.startsWith('data:') || url.startsWith('/api/img?')) return url;
  return `/api/img?url=${encodeURIComponent(url)}`;
}

// Google/YouTube-owned image CDNs. Emoji and avatars are spread across several of
// these: custom channel emoji come from ggpht, standard emoji from gstatic, and
// avatars from googleusercontent. Matching whole hosts (not URL prefixes) keeps the
// proxy locked to Google origins while surviving CDN shard changes.
const IMAGE_HOST_SUFFIXES = ['ggpht.com', 'googleusercontent.com', 'ytimg.com', 'gstatic.com', 'youtube.com'];

function isAllowedImageHost(target) {
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return IMAGE_HOST_SUFFIXES.some(domain => host === domain || host.endsWith(`.${domain}`));
}

// Returns a rendered part for an emoji run — an 'emote' when there is a usable
// image, otherwise a 'text' part. It must never return null for a run that really
// holds an emoji: emoji runs carry no `text` field, so anything dropped here
// disappears from the message entirely rather than degrading to something readable.
function emojiFromRun(run) {
  const emoji = run.emoji || run.customEmoji || run.liveChatCustomEmojiRenderer
    || findKey(run, 'liveChatCustomEmojiRenderer') || findKey(run, 'emoji');
  if (!emoji || typeof emoji !== 'object') return null;

  const emojiId = String(emoji.emojiId || '');
  const label = emoji.shortcuts?.[0] || emoji.label || '';
  // Standard emoji carry the literal character in emojiId (custom ones use a
  // "channelId/emojiId" form). Emitting the character beats proxying an image:
  // it always renders, needs no network round-trip, and picks up the chat font.
  const isCustom = emoji.isCustomEmoji === true || emojiId.includes('/');
  if (!isCustom && emojiId && /[^\x00-\x7F]/.test(emojiId)) return { t: 'text', v: emojiId };

  const src = bestThumb(emoji.image || emoji.thumbnail || emoji.customThumbnail);
  if (src) return { t: 'emote', name: label || 'emoji', src: proxiedImage(src) };
  // No usable image — fall back to the shortcut text so the emoji still shows.
  return label ? { t: 'text', v: label } : null;
}

function textOf(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.simpleText) return node.simpleText;
  if (Array.isArray(node.runs)) return node.runs.map(run => run.text || '').join('');
  return '';
}

function parseRuns(runs = []) {
  const parts = [];
  for (const run of runs) {
    const emoji = emojiFromRun(run);
    if (emoji) parts.push(emoji);
    else if (run.text) parts.push({ t: 'text', v: run.text });
  }
  return parts;
}

function normalizeYtRenderer(renderer) {
  if (!renderer?.id || seenYtMessages.has(renderer.id)) return null;
  const author = textOf(renderer.authorName) || 'YouTube Viewer';
  const parts = parseRuns(renderer.message?.runs || []);
  const badges = [];
  for (const badge of renderer.authorBadges || []) {
    const b = badge.liveChatAuthorBadgeRenderer;
    const img = bestThumb(b?.customThumbnail);
    if (img) badges.push({ img, lbl: b.tooltip || '' });
    else if (/owner/i.test(b?.tooltip || '')) badges.push({ img: 'owner', lbl: 'Channel Owner' });
    else if (/moderator/i.test(b?.tooltip || '')) badges.push({ img: 'mod', lbl: 'Moderator' });
    else if (/member/i.test(b?.tooltip || '')) badges.push({ img: 'member', lbl: b.tooltip });
  }
  seenYtMessages.add(renderer.id);
  if (seenYtMessages.size > 500) seenYtMessages.delete(seenYtMessages.values().next().value);
  return { platform: 'youtube', username: author, badges, color: null, parts };
}

// A poll returns every message since the last one — measured at 6-11 at a time on a
// busy stream. Emitting them in one synchronous loop makes them all land in the same
// frame, so chat arrives in clumps instead of a stream. These queue and trickle out.
function releaseYtQueue() {
  ytDrainTimer = null;
  const msg = ytQueue.shift();
  if (!msg) return;
  broadcast(chatClients, 'message', msg);
  if (!ytQueue.length) return;
  // pace so the queue empties just as the next poll lands — a batch's messages were
  // really sent ~2s apart, so this restores their spacing rather than inventing lag
  const gap = Math.min(YT_MAX_GAP_MS, (ytPollDelay * YT_SPREAD_RATIO) / ytQueue.length);
  ytDrainTimer = setTimeout(releaseYtQueue, gap);
}

function queueYtMessages(messages) {
  if (!messages.length) return;
  ytQueue.push(...messages);
  if (!ytDrainTimer) releaseYtQueue(); // first message of an idle queue goes out now
}

function resetYtQueue() {
  ytQueue.length = 0;
  clearTimeout(ytDrainTimer);
  ytDrainTimer = null;
  ytPrimed = false;
}

function emitYtActions(actions = []) {
  const now = Date.now();
  const fresh = [];
  for (const action of actions) {
    const item = action.addChatItemAction?.item;
    const renderer = item?.liveChatTextMessageRenderer || item?.liveChatPaidMessageRenderer;
    if (!renderer) continue;
    // The first poll replays a backlog — measured at 71 messages spanning 90s — which
    // would otherwise flood the overlay the instant it connects.
    const sentAt = Number(renderer.timestampUsec) / 1000;
    if (!ytPrimed && sentAt && now - sentAt > YT_BACKLOG_MS) continue;
    const msg = normalizeYtRenderer(renderer);
    if (msg) fresh.push(msg);
  }
  // an age cut alone still lets a fast chat dump dozens on connect, so cap the count
  const batch = ytPrimed ? fresh : fresh.slice(-YT_BACKLOG_MAX);
  ytPrimed = true;
  queueYtMessages(batch);
}

async function initYoutubeChat(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const html = await fetchWithTimeout(watchUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en-US,en;q=0.9' }
  }).then(r => r.text());
  ytApiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  ytClientVersion = html.match(/"clientVersion":"([^"]+)"/)?.[1] || ytClientVersion;
  const initialData = extractJsonAfter(html, 'var ytInitialData =') || extractJsonAfter(html, 'ytInitialData');
  ytContinuation = findKey(initialData, 'reloadContinuationData')?.continuation
    || findKey(initialData, 'invalidationContinuationData')?.continuation
    || findKey(initialData, 'timedContinuationData')?.continuation
    || findKey(initialData, 'continuation');
  if (!ytApiKey || !ytContinuation) throw new Error('Could not find live chat data for this YouTube video.');
}

async function pollYoutubeChat() {
  if (!ytContinuation || !ytApiKey) return;
  try {
    const body = {
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: ytClientVersion,
          hl: 'en',
          gl: 'US'
        }
      },
      continuation: ytContinuation
    };
    const res = await fetchWithTimeout(`https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${encodeURIComponent(ytApiKey)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
        'Origin': 'https://www.youtube.com',
        'Referer': `https://www.youtube.com/watch?v=${ytCurrentVideoId}`
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    const cont = data.continuationContents?.liveChatContinuation;
    emitYtActions(cont?.actions || []);
    const next = cont?.continuations?.[0];
    ytContinuation = next?.timedContinuationData?.continuation
      || next?.invalidationContinuationData?.continuation
      || next?.reloadContinuationData?.continuation
      || ytContinuation;
    const delay = next?.timedContinuationData?.timeoutMs || next?.invalidationContinuationData?.timeoutMs || 2500;
    ytPollDelay = Math.max(1000, Math.min(Number(delay) || 2500, 2500));
    ytTimer = setTimeout(pollYoutubeChat, ytPollDelay);
    broadcast(chatClients, 'status', { platform: 'youtube', text: 'Connected', ok: true });
  } catch (err) {
    broadcast(chatClients, 'status', { platform: 'youtube', text: `YouTube helper error: ${err.message}`, ok: false });
    ytTimer = setTimeout(pollYoutubeChat, 10000);
  }
}

async function startYoutubeChat(config) {
  clearTimeout(ytTimer);
  ytTimer = null;
  ytContinuation = null;
  ytApiKey = null;
  seenYtMessages.clear();
  resetYtQueue();
  ytCurrentVideoId = parseVideoId(config.youtubeUrl);
  if (!ytCurrentVideoId) {
    broadcast(chatClients, 'status', { platform: 'youtube', text: 'Waiting for YouTube URL', ok: false });
    return;
  }
  broadcast(chatClients, 'status', { platform: 'youtube', text: 'Connecting to YouTube web chat...', ok: false });
  try {
    await initYoutubeChat(ytCurrentVideoId);
    pollYoutubeChat();
  } catch (err) {
    broadcast(chatClients, 'status', { platform: 'youtube', text: err.message, ok: false });
  }
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...securityHeaders('text/plain') });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = ext === '.html' ? 'text/html; charset=utf-8'
      : ext === '.js' ? 'text/javascript; charset=utf-8'
      : ext === '.json' ? 'application/json; charset=utf-8'
      : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, ...securityHeaders(type) });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const requestOrigin = localRequestOrigin(req);
  if (!requestOrigin) {
    res.writeHead(421, { 'Content-Type': 'text/plain; charset=utf-8', ...securityHeaders('text/plain') });
    res.end('Misdirected request');
    return;
  }

  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', ...securityHeaders('text/plain') });
    res.end('Bad request');
    return;
  }

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !isAllowedOrigin(req, requestOrigin)) {
    sendJson(res, 403, { error: 'Cross-origin request blocked' });
    return;
  }

  if (url.pathname === '/api/config' && req.method === 'GET') {
    sendJson(res, 200, readConfig());
    return;
  }

  if (url.pathname === '/api/version' && req.method === 'GET') {
    sendJson(res, 200, { name: 'twitch-chat-overlay-helper', version: 4, videoId: ytCurrentVideoId });
    return;
  }

  if (url.pathname === '/api/img' && req.method === 'GET') {
    const target = url.searchParams.get('url') || '';
    if (!isAllowedImageHost(target)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', ...securityHeaders('text/plain') });
      res.end('Unsupported image host');
      return;
    }
    try {
      const img = await fetchWithTimeout(target, {
        redirect: 'error',
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Referer': `https://www.youtube.com/watch?v=${ytCurrentVideoId || ''}`
        }
      });
      if (!img.ok) throw new Error(`Image fetch failed: ${img.status}`);
      const contentType = img.headers.get('content-type') || 'image/png';
      if (!contentType.toLowerCase().startsWith('image/')) throw new Error('Upstream response was not an image');
      const declaredLength = Number(img.headers.get('content-length') || 0);
      if (declaredLength > MAX_IMAGE_BYTES) throw new Error('Image is too large');
      const bytes = Buffer.from(await img.arrayBuffer());
      if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Image is too large');
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
        'Content-Length': bytes.length,
        ...securityHeaders(contentType)
      });
      res.end(bytes);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', ...securityHeaders('text/plain') });
      res.end('Image fetch failed');
    }
    return;
  }

  if (url.pathname === '/api/shutdown' && req.method === 'POST') {
    sendJson(res, 200, { ok: true });
    setTimeout(() => process.exit(0), 50);
    return;
  }

  if (url.pathname === '/api/config' && req.method === 'POST') {
    try {
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
        sendJson(res, 415, { error: 'Content-Type must be application/json' });
        return;
      }
      const incoming = JSON.parse(await readBody(req) || '{}');
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
        throw new Error('Config must be a JSON object');
      }
      const config = writeConfig({ ...readConfig(), ...incoming });
      sendJson(res, 200, config);
      broadcast(clients, 'config', config);
      startYoutubeChat(config);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  if (url.pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      ...securityHeaders('text/event-stream')
    });
    clients.add(res);
    res.write(sseEvent('config', readConfig()));
    req.on('close', () => clients.delete(res));
    return;
  }

  if (url.pathname === '/api/chat' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      ...securityHeaders('text/event-stream')
    });
    chatClients.add(res);
    res.write(sseEvent('status', { platform: 'youtube', text: ytCurrentVideoId ? 'YouTube helper active' : 'Waiting for YouTube URL', ok: !!ytCurrentVideoId }));
    req.on('close', () => chatClients.delete(res));
    return;
  }

  if (url.pathname === '/' || url.pathname === '/stream_chat_overlay.html') {
    serveFile(res, path.join(ROOT, 'stream_chat_overlay.html'));
    return;
  }

  if (url.pathname === '/control' || url.pathname === '/control.html') {
    serveFile(res, path.join(ROOT, 'control.html'));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...securityHeaders('text/plain') });
  res.end('Not found');
});

function listen(port, attemptsLeft = 20) {
  const onListening = () => {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ pid: process.pid, port }));
    console.log(`Overlay helper running on http://localhost:${port} (loopback only)`);
    console.log(`Control page: http://localhost:${port}/control`);
    console.log(`OBS URL:      http://localhost:${port}/stream_chat_overlay.html`);
  };
  server.once('listening', onListening);
  server.once('error', err => {
    server.removeListener('listening', onListening);
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`Port ${port} is already in use by another process, trying ${port + 1}...`);
      listen(port + 1, attemptsLeft - 1);
      return;
    }
    throw err;
  });
  server.listen(port, HOST);
}

const initialConfig = readConfig();
if (fs.existsSync(CONFIG_FILE)) writeConfig(initialConfig);
listen(START_PORT);
startYoutubeChat(initialConfig);

function cleanupState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (String(state.pid) === String(process.pid)) fs.unlinkSync(STATE_FILE);
    }
  } catch {}
}
process.on('exit', cleanupState);
process.on('SIGINT', () => process.exit(0));
