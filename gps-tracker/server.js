const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3003;
const ORION_URL = process.env.ORION_URL || 'http://orion:1026';
const FIWARE_SERVICE = 'gpsroute';
const FIWARE_SERVICEPATH = '/routes';

const PHOTOS_DIR = path.join(__dirname, 'public', 'photos');
const DATA_DIR = path.join(__dirname, 'data');
const PHOTOS_DATA = path.join(DATA_DIR, 'photos-data.json');

if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let photosList = [];
try { photosList = JSON.parse(fs.readFileSync(PHOTOS_DATA, 'utf8')); } catch (e) {}

const ROUTES_DATA = path.join(DATA_DIR, 'routes-data.json');
let routesList = [];
try { routesList = JSON.parse(fs.readFileSync(ROUTES_DATA, 'utf8')); } catch (e) {}

// 旧形式(comment文字列) → 新形式(comments配列)への自動移行
let migrated = false;
photosList = photosList.map(p => {
  if (!Array.isArray(p.comments)) {
    migrated = true;
    const comments = [];
    if (p.comment && String(p.comment).trim()) {
      comments.push({
        deviceId: p.deviceId || 'unknown',
        text: String(p.comment).trim(),
        timestamp: p.timestamp,
      });
    }
    const { comment, ...rest } = p;
    return { ...rest, comments };
  }
  return p;
});
if (migrated) {
  fs.writeFileSync(PHOTOS_DATA, JSON.stringify(photosList));
  console.log(`[migration] comment → comments 変換完了 (${photosList.length}件)`);
}

const storage = multer.diskStorage({
  destination: PHOTOS_DIR,
  filename: (req, file, cb) => cb(null, `photo_${Date.now()}.jpg`),
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const orionHeaders = {
  'fiware-service': FIWARE_SERVICE,
  'fiware-servicepath': FIWARE_SERVICEPATH,
  'Content-Type': 'application/json',
};
const orionGetHeaders = {
  'fiware-service': FIWARE_SERVICE,
  'fiware-servicepath': FIWARE_SERVICEPATH,
};

function entityId(deviceId) {
  return `Route:${deviceId}`;
}

async function upsertOrionEntity(deviceId, attrs) {
  const id = entityId(deviceId);
  try {
    await axios.patch(`${ORION_URL}/v2/entities/${id}/attrs`, attrs, { headers: orionHeaders });
  } catch (e) {
    if (e.response?.status === 404) {
      await axios.post(`${ORION_URL}/v2/entities?options=upsert`, {
        id,
        type: 'Route',
        location: { type: 'geo:json', value: { type: 'Point', coordinates: [141.35, 43.06] } },
        speed: { type: 'Number', value: 0 },
        accuracy: { type: 'Number', value: 0 },
        tracking: { type: 'Boolean', value: false },
        ...attrs,
      }, { headers: orionHeaders });
    } else {
      throw e;
    }
  }
}

app.get('/last-position', async (req, res) => {
  const { deviceId } = req.query;
  if (!deviceId) return res.json(null);
  try {
    const resp = await axios.get(`${ORION_URL}/v2/entities/${entityId(deviceId)}`, { headers: orionGetHeaders });
    const coords = resp.data.location?.value?.coordinates;
    res.json(coords ? { lat: coords[1], lng: coords[0] } : null);
  } catch (e) {
    console.error('last-position error:', e.message, e.response?.status, JSON.stringify(e.response?.data));
    res.json(null);
  }
});

app.post('/location', async (req, res) => {
  const { lat, lng, speed, accuracy, deviceId } = req.body;
  if (!deviceId) return res.status(400).json({ error: 'deviceId required' });
  console.log(`[${new Date().toLocaleString('ja-JP')}] ${deviceId.slice(0, 8)}... lat=${lat} lng=${lng}`);
  try {
    await upsertOrionEntity(deviceId, {
      location: { type: 'geo:json', value: { type: 'Point', coordinates: [lng, lat] } },
      speed: { type: 'Number', value: speed || 0 },
      accuracy: { type: 'Number', value: accuracy || 0 },
    });
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Orionエラー:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/tracking', async (req, res) => {
  const { active, deviceId } = req.body;
  if (!deviceId) return res.status(400).json({ error: 'deviceId required' });
  try {
    await upsertOrionEntity(deviceId, {
      tracking: { type: 'Boolean', value: active },
    });
    console.log(`[${deviceId.slice(0, 8)}...] トラッキング: ${active ? '開始' : '停止'}`);
    res.json({ status: 'ok', tracking: active });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/photo', (req, res) => {
  upload.single('photo')(req, res, (err) => {
    if (err) {
      console.error('multerエラー:', err.message);
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'ファイルがありません' });
    }
    const { lat, lng, deviceId } = req.body;
    const entry = {
      url: `photos/${req.file.filename}`,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      timestamp: new Date().toISOString(),
      deviceId: deviceId || 'unknown',
      rating: 0,
      comments: [],
    };
    photosList.push(entry);
    fs.writeFileSync(PHOTOS_DATA, JSON.stringify(photosList));
    console.log(`[${new Date().toLocaleString('ja-JP')}] 写真保存: ${req.file.filename} at (${lat}, ${lng})`);
    res.json(entry);
  });
});

app.get('/photos-list', (req, res) => {
  const { deviceId } = req.query;
  res.json(deviceId ? photosList.filter(p => p.deviceId === deviceId) : photosList);
});

app.get('/photo-detail', (req, res) => {
  const { url } = req.query;
  const photo = photosList.find(p => p.url === url);
  if (!photo) return res.status(404).json({ error: 'not found' });
  res.json(photo);
});

app.patch('/photo-meta', (req, res) => {
  const { url, rating, deviceId } = req.body;
  const idx = photosList.findIndex(p => p.url === url);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  if (deviceId && photosList[idx].deviceId !== deviceId) return res.status(403).json({ error: 'forbidden' });
  photosList[idx].rating = rating;
  fs.writeFileSync(PHOTOS_DATA, JSON.stringify(photosList));
  res.json(photosList[idx]);
});

app.post('/photo-comment', (req, res) => {
  const { url, deviceId, authorName, text } = req.body;
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'text required' });
  const idx = photosList.findIndex(p => p.url === url);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  if (!Array.isArray(photosList[idx].comments)) photosList[idx].comments = [];
  const entry = {
    deviceId: deviceId || 'unknown',
    authorName: authorName ? String(authorName).trim().slice(0, 20) : null,
    text: String(text).trim(),
    timestamp: new Date().toISOString(),
  };
  photosList[idx].comments.push(entry);
  fs.writeFileSync(PHOTOS_DATA, JSON.stringify(photosList));
  res.json(entry);
});

app.get('/routes-list', (req, res) => {
  res.json(routesList);
});

app.post('/route', (req, res) => {
  const { deviceId, authorName, points, startTime, endTime } = req.body;
  if (!points || points.length < 1) return res.status(400).json({ error: 'points required' });
  const entry = {
    id: `route_${Date.now()}`,
    deviceId: deviceId || 'unknown',
    authorName: authorName ? String(authorName).trim().slice(0, 20) : null,
    points,
    startTime: startTime || new Date().toISOString(),
    endTime: endTime || new Date().toISOString(),
  };
  routesList.push(entry);
  fs.writeFileSync(ROUTES_DATA, JSON.stringify(routesList));
  console.log(`[${new Date().toLocaleString('ja-JP')}] ルート保存: ${entry.id} ${points.length}pts (${authorName || deviceId})`);
  res.json(entry);
});

app.get('/device-ids', (req, res) => {
  const map = {};
  photosList.forEach(p => { map[p.deviceId] = (map[p.deviceId] || 0) + 1; });
  res.json(Object.entries(map).map(([deviceId, count]) => ({ deviceId, count })));
});

// 旧deviceId → 新deviceId への一括変更（本人確認なし・個人用途のみ）
app.post('/rename-device', (req, res) => {
  const { oldId, newId } = req.body;
  if (!newId || !String(newId).trim()) return res.status(400).json({ error: 'newId required' });
  let count = 0;
  photosList.forEach(p => {
    if (!oldId || p.deviceId === oldId) { p.deviceId = String(newId).trim(); count++; }
  });
  fs.writeFileSync(PHOTOS_DATA, JSON.stringify(photosList));
  res.json({ updated: count });
});

app.listen(PORT, () => {
  console.log(`GPSトラッカーサーバー起動: http://localhost:${PORT}`);
});
