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
const ENTITY_ID = 'Route:smartphone';

const PHOTOS_DIR = path.join(__dirname, 'public', 'photos');
const DATA_DIR = path.join(__dirname, 'data');
const PHOTOS_DATA = path.join(DATA_DIR, 'photos-data.json');

if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let photosList = [];
try { photosList = JSON.parse(fs.readFileSync(PHOTOS_DATA, 'utf8')); } catch (e) {}

const storage = multer.diskStorage({
  destination: PHOTOS_DIR,
  filename: (req, file, cb) => cb(null, `photo_${Date.now()}.jpg`),
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const orionHeaders = {
  'fiware-service': FIWARE_SERVICE,
  'fiware-servicepath': FIWARE_SERVICEPATH,
  'Content-Type': 'application/json',
};

async function initOrionEntity() {
  await axios.post(`${ORION_URL}/v2/entities?options=upsert`, {
    id: ENTITY_ID,
    type: 'Route',
    location: { type: 'geo:json', value: { type: 'Point', coordinates: [141.35, 43.06] } },
    speed: { type: 'Number', value: 0 },
    accuracy: { type: 'Number', value: 0 },
    tracking: { type: 'Boolean', value: false },
  }, { headers: orionHeaders });
  console.log('Orionエンティティ準備完了');
}

app.post('/location', async (req, res) => {
  const { lat, lng, speed, accuracy } = req.body;
  console.log(`[${new Date().toLocaleString('ja-JP')}] lat=${lat} lng=${lng} speed=${speed}`);
  try {
    await axios.patch(`${ORION_URL}/v2/entities/${ENTITY_ID}/attrs`, {
      location: { type: 'geo:json', value: { type: 'Point', coordinates: [lng, lat] } },
      speed: { type: 'Number', value: speed || 0 },
      accuracy: { type: 'Number', value: accuracy || 0 },
    }, { headers: orionHeaders });
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Orionエラー:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/tracking', async (req, res) => {
  const { active } = req.body;
  try {
    await axios.patch(`${ORION_URL}/v2/entities/${ENTITY_ID}/attrs`, {
      tracking: { type: 'Boolean', value: active },
    }, { headers: orionHeaders });
    console.log(`トラッキング: ${active ? '開始' : '停止'}`);
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
    const { lat, lng } = req.body;
    const entry = {
      url: `photos/${req.file.filename}`,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      timestamp: new Date().toISOString(),
    };
    photosList.push(entry);
    fs.writeFileSync(PHOTOS_DATA, JSON.stringify(photosList));
    console.log(`[${new Date().toLocaleString('ja-JP')}] 写真保存: ${req.file.filename} at (${lat}, ${lng})`);
    res.json(entry);
  });
});

app.get('/photos-list', (req, res) => {
  res.json(photosList);
});

app.listen(PORT, async () => {
  console.log(`GPSトラッカーサーバー起動: http://localhost:${PORT}`);
  await initOrionEntity().catch(err => console.warn('Orion初期化スキップ:', err.message));
});
