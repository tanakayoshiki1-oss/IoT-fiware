# IoT-fiware システム設計

## アーキテクチャ全体図

```
【外部】
  スマートフォン（GPS / LINE）
       │
       ▼
  Cloudflare Tunnel（cloudflared.exe）
       │
       ▼
  nginx リバースプロキシ（C:\Projects\ngrok、ポート 8081）
       │
       ├─ /gps/          → gps-tracker サーバー（ポート 3003）
       ├─ /line-picarx/  → middleware サーバー（ポート 3001）★ IoT-fiware
       └─ /grafana-fiware/→ Grafana（ポート 4101）
              │
              ▼
       LINE Platform（Webhook POST）
              │
              ▼
       middleware（Node.js / Docker）
              │
       ┌──────┴──────────────┐
       ▼                     ▼
  Google Home Mini      PiCar-X カメラサーバー
  192.168.3.11          192.168.3.17:5000（Flask）
  （TTS / 音量）         （JPEG 撮影）

【データパイプライン】
  GPS スマートフォン → gps-tracker → FIWARE Orion
  PiCar-X 写真 URL  → middleware  → FIWARE Orion
                                         │
                                    FIWARE Draco（Apache NiFi）
                                         │
                                    PostgreSQL（fiware-base）
                                         │
                                    Grafana（grafana-fiware）
```

---

## コンポーネント詳細

### IoT-fiware（本プロジェクト）

| コンポーネント | 場所 | 役割 |
|---------------|------|------|
| line-server | `line-server/` / Docker（ポート 3001） | LINE Webhook 受信、Google Home 制御、PiCar-X 連携、Orion 更新 |
| camera_server.py | `picarx/` / PiCar-X 上（ポート 5000） | Vilib カメラで JPEG 撮影、Flask API |

#### line-server ソース構成

```
line-server/src/
├── server.js       # Express サーバー、Webhook ルーティング
├── googleHome.js   # TTS (google-home-player) / 音量 (castv2-client)
├── lineApi.js      # LINE Messaging API（テキスト返信・画像返信）
├── orion.js        # FIWARE Orion NGSI v2 エンティティ操作
└── picarx.js       # PiCar-X HTTP API クライアント
```

### 関連プロジェクト

| プロジェクト | パス | 役割 |
|-------------|------|------|
| fiware-base | `C:\Projects\fiware-base` | Orion (ポート 4226) / Draco / PostgreSQL (ポート 4243) |
| grafana-fiware | `C:\Projects\grafana-fiware` | Grafana (ポート 4101) / GPS ダッシュボード |
| gps-tracker | `C:\Projects\gps-tracker` | GPS 位置情報受信サーバー（ポート 3003） |
| ngrok | `C:\Projects\ngrok` | nginx リバースプロキシ + Cloudflare Tunnel |

---

## データフロー

### フロー 1: LINE テキスト → Google Home 読み上げ

```
LINE アプリ
  → LINE Platform (Webhook)
  → Cloudflare Tunnel
  → nginx (/line-picarx/)
  → middleware POST /webhook
  → googleHome.say(text)
  → Google Home Mini TTS
```

### フロー 2: !写真 → LINE 写真返信

```
LINE アプリ（!写真）
  → middleware POST /webhook
  → picarx.takePhoto()  GET http://192.168.3.17:5000/photo
  → 写真保存 /app/photos/photo_TIMESTAMP.jpg
  → orion.updatePhoto(photoUrl)  PATCH Orion PiCarX:001
  → lineApi.replyImage(replyToken, photoUrl)
  → LINE アプリに写真返信
```

### フロー 3: スマートフォン GPS トラッキング

```
スマートフォン ブラウザ（/gps/）
  → navigator.geolocation.watchPosition()
  → POST /gps/location（5 秒ごと）
  → gps-tracker PATCH Orion Route:smartphone
  → Draco サブスクリプション通知
  → PostgreSQL gpsroute.routes テーブル
  → Grafana GPS ルートマップ
```

---

## FIWARE データモデル

### PiCarX:001（写真管理）

| 属性 | 型 | 内容 |
|------|-----|------|
| photo_url | Text | 最新写真の URL |
| timestamp | DateTime | 撮影日時 |

- fiware-service: `linepicarx`
- fiware-servicepath: `/picarx`

### Route:smartphone（GPS ルート）

| 属性 | 型 | 内容 |
|------|-----|------|
| location | geo:json (Point) | 現在位置 [経度, 緯度] |
| speed | Number | 移動速度 (m/s) |
| accuracy | Number | GPS 精度 (m) |
| tracking | Boolean | トラッキング中フラグ |

- fiware-service: `gpsroute`
- fiware-servicepath: `/routes`
- PostgreSQL テーブル: `gpsroute.routes`

---

## API 仕様

### middleware（ポート 3001）

| メソッド | パス | 内容 |
|----------|------|------|
| POST | `/webhook` | LINE Webhook 受信 |
| POST | `/upload` | PiCar-X からの写真プッシュ受信 |
| GET | `/photos/:filename` | 写真ファイル配信 |
| GET | `/test?text=xxx` | Google Home 読み上げテスト |

### PiCar-X camera_server.py（ポート 5000）

| メソッド | パス | 内容 |
|----------|------|------|
| GET | `/photo` | JPEG 写真を返す（93KB 程度） |
| POST | `/command` | 移動指示（実装予定） |

### gps-tracker（ポート 3003）

| メソッド | パス | 内容 |
|----------|------|------|
| GET | `/` | GPS トラッキング UI（Leaflet マップ） |
| POST | `/location` | 位置情報受信 `{lat, lng, speed, accuracy}` |
| POST | `/tracking` | トラッキング開始/停止 `{active: bool}` |

---

## 環境変数

### middleware（`.env`）

| 変数 | 説明 | 既定値 |
|------|------|--------|
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Messaging API トークン | （要設定） |
| `GOOGLE_HOME_IP` | Google Home Mini の LAN IP | `192.168.3.11` |
| `ORION_URL` | FIWARE Orion エンドポイント | `http://orion:3226` |
| `PICARX_URL` | PiCar-X カメラサーバー URL | `http://192.168.3.XX:5000` |
| `PHOTO_BASE_URL` | 写真配信の公開 URL ベース | Cloudflare URL/line-picarx/photos |
| `FIWARE_SERVICE` | Orion fiware-service ヘッダー | `linepicarx` |
| `FIWARE_SERVICEPATH` | Orion fiware-servicepath ヘッダー | `/picarx` |
| `PORT` | サーバーポート | `3001` |

---

## 実装状況

| 機能 | 状態 | 備考 |
|------|------|------|
| LINE → Google Home 読み上げ | ✅ 完了 | 動作確認済み |
| Google Home 音量コントロール | ✅ 完了 | !音量XX/+/- |
| PiCar-X カメラ撮影 API | ✅ 完了 | camera_server.py |
| !写真 → LINE 返信 | ✅ 実装済み | Channel Access Token 未設定 |
| GPS トラッキング UI | ✅ 完了 | gps-tracker |
| Orion → PostgreSQL パイプライン | ✅ 完了 | Draco サブスクリプション済み |
| Grafana GPS ルートマップ | ✅ 完了 | markers 表示 |
| 画像 AI 解析（LLM） | 〇 予定 | Mac mini 到着後 |
| スマートホーム制御（Tuya） | 〇 予定 | |
| PiCar-X 移動制御 | 〇 予定 | |

---

## 依存ライブラリ

### middleware

| パッケージ | 用途 |
|-----------|------|
| express | HTTP サーバー |
| axios | HTTP クライアント（Orion / PiCar-X 呼び出し） |
| google-home-player | Google Home TTS |
| castv2-client | Google Home 音量制御（Chromecast プロトコル） |

### PiCar-X（camera_server.py）

| パッケージ | 用途 |
|-----------|------|
| flask | HTTP サーバー |
| vilib | SunFounder カメラライブラリ（picamera2 ラッパー） |
