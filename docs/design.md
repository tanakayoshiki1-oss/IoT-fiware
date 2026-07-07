# IoT-fiware システム設計

## アーキテクチャ全体図

```
【外部】
  スマートフォン（GPS / LINE）
       │
       ▼
  Cloudflare Tunnel（cloudflared Windows サービス）
  カスタムドメイン: codinghiker.com
       │
       ▼
  nginx リバースプロキシ（C:\Projects\reverse-proxy、ポート 8081）
       │
       ├─ /gps/          → gps-tracker サーバー（ポート 3003）
       ├─ /line-server/  → line-server（ポート 3001）★ IoT-fiware
       └─ /grafana-fiware/→ Grafana（ポート 4101）
              │
              ▼
       LINE Platform（Webhook POST）
              │
              ▼
       line-server（Node.js / Docker）
              │
       ┌──────┴──────────────┐
       ▼                     ▼
  Google Home Mini      PiCar-X カメラサーバー
  192.168.3.11          192.168.3.17:5000（Flask）
  （TTS / 音量）         （JPEG 撮影）

【データパイプライン】
  GPS スマートフォン → gps-tracker → FIWARE Orion
  PiCar-X 写真 URL  → line-server  → FIWARE Orion
                                         │
                                    FIWARE Draco（Apache NiFi）
                                         │
                                    PostgreSQL（fiware-base）
                                         │
                                    Grafana（grafana-fiware）
```

---

## インフラ構成

### Cloudflare Tunnel

| 項目 | 値 |
|------|-----|
| ドメイン | `codinghiker.com`（Cloudflare Registrar） |
| トンネル名 | `gps` |
| 実行方式 | Windows サービス（cloudflared）自動起動 |
| 実行ファイル | `C:\Projects\cloudflared.exe` |
| 転送先 | `http://localhost:8081`（nginx） |

### nginx リバースプロキシ

| 項目 | 値 |
|------|-----|
| プロジェクト | `C:\Projects\reverse-proxy` |
| コンテナ名 | `reverse-proxy` |
| Docker | Docker Desktop（`restart: unless-stopped`） |
| ポート | `127.0.0.1:8081:8080` |

| 外部パス | 転送先 |
|---------|--------|
| `/gps/` | `localhost:3003` |
| `/line-server/` | `localhost:3001` |
| `/grafana-fiware/` | `localhost:4101` |
| `/plateau-fiware/` | `localhost:4200` |

---

## コンポーネント詳細

### IoT-fiware（本プロジェクト）

| コンポーネント | 場所 | 役割 |
|---------------|------|------|
| line-server | `line-server/` / Docker（ポート 3001） | LINE Webhook 受信、Google Home 制御、PiCar-X 連携、Orion 更新 |
| gps-tracker | `gps-tracker/` / Docker（ポート 3003） | GPS 位置情報受信 Web UI、写真アップロード・地図表示、Orion 更新 |
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
| fiware-base | `C:\Projects\fiware-base` | Orion (ポート 1026) / Draco / PostgreSQL (ポート 4243) |
| grafana-fiware | `C:\Projects\grafana-fiware` | Grafana (ポート 4101) / GPS ダッシュボード |
| reverse-proxy | `C:\Projects\reverse-proxy` | nginx リバースプロキシ（ポート 8081） |

---

## データフロー

### フロー 1: LINE テキスト → Google Home 読み上げ

```
LINE アプリ
  → LINE Platform (Webhook)
  → codinghiker.com/line-server/webhook
  → Cloudflare Tunnel
  → nginx (/line-server/)
  → line-server POST /webhook
  → googleHome.say(text)
  → Google Home Mini TTS
```

### フロー 2: !写真 → LINE 写真返信

```
LINE アプリ（!写真）
  → line-server POST /webhook
  → picarx.takePhoto()  GET http://192.168.3.17:5000/photo
  → 写真保存 /app/photos/photo_TIMESTAMP.jpg
  → orion.updatePhoto(photoUrl)  PATCH Orion PiCarX:001
  → lineApi.replyImage(replyToken, photoUrl)
  → LINE アプリに写真返信
```

### フロー 3: スマートフォン GPS トラッキング

```
スマートフォン ブラウザ（codinghiker.com/gps/）
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

### 写真データ（ローカル JSON）

FIWARE Orion には保存せず、Docker Volume 内の JSON ファイルで管理。

ファイル: `/app/data/photos-data.json`（Volume: `iot_fiware_gps_data`）

```json
[
  {
    "url": "photos/photo_1234567890.jpg",
    "lat": 43.0646,
    "lng": 141.3468,
    "deviceId": "a3b2c1d0",
    "timestamp": "2026-07-07T09:59:34.000Z",
    "rating": 4,
    "comments": [
      {
        "deviceId": "a3b2c1d0",
        "authorName": "tanaka",
        "text": "コメント本文",
        "timestamp": "2026-07-07T10:00:00.000Z"
      }
    ]
  }
]
```

`deviceId` は `fnv1a(デバイス名 + ":" + PIN)` の 8 桁 hex ハッシュ。生の名前や PIN はサーバーに送らない。

写真ファイル: `/app/public/photos/`（Volume: `iot_fiware_gps_photos`）

---

## API 仕様

### line-server（ポート 3001）

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
| POST | `/location` | 位置情報受信 `{lat, lng, speed, accuracy, deviceId}` |
| POST | `/tracking` | トラッキング開始/停止 `{active: bool, deviceId}` |
| GET | `/last-position?deviceId=` | 最終位置取得（Orion から） |
| POST | `/photo` | 写真アップロード（multipart/form-data: photo, lat, lng, deviceId） |
| GET | `/photos-list?deviceId=` | 写真一覧（deviceId 省略で全件） |
| GET | `/photo-detail?url=` | 写真詳細（評価・コメント含む） |
| PATCH | `/photo-meta` | 星評価更新 `{url, rating, deviceId}`（deviceId 不一致は 403） |
| POST | `/photo-comment` | コメント追加 `{url, deviceId, authorName, text}` |
| GET | `/device-ids` | deviceId 別の写真件数一覧 `[{deviceId, count}]` |
| POST | `/rename-device` | 旧 deviceId → 新 deviceId への写真一括付け替え `{oldId, newId}` |

---

## 環境変数

### line-server（`.env`）

| 変数 | 説明 | 既定値 |
|------|------|--------|
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Messaging API トークン | （要設定） |
| `GOOGLE_HOME_IP` | Google Home Mini の LAN IP | `192.168.3.11` |
| `ORION_URL` | FIWARE Orion エンドポイント | `http://orion:1026` |
| `PICARX_URL` | PiCar-X カメラサーバー URL | `http://192.168.3.17:5000` |
| `PHOTO_BASE_URL` | 写真配信の公開 URL ベース | `https://codinghiker.com/line-server/photos` |
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
| !写真 → LINE 返信 | ✅ 実装済み | PiCar-X 起動時に動作 |
| GPS トラッキング UI | ✅ 完了 | codinghiker.com/gps/ |
| Orion → PostgreSQL パイプライン | ✅ 完了 | Draco サブスクリプション済み |
| Grafana GPS ルートマップ | ✅ 完了 | markers 表示 |
| Cloudflare Tunnel（固定ドメイン） | ✅ 完了 | codinghiker.com / Windows サービス |
| 写真アップロード・地図表示 | ✅ 完了 | 位置情報付き、自分/他者色分け、表示切替 |
| 写真コメント（チャット形式） | ✅ 完了 | デバイス間共有、ポップアップ外ボタンで開閉、投稿者名表示 |
| 写真星評価 | ✅ 完了 | 1〜5 星、本人のみ変更可・他デバイスは参照のみ |
| デバイス認証（名前+PIN） | ✅ 完了 | FNV-1a ハッシュで識別、旧 ID 引き継ぎ、番号選択UI |
| 画像 AI 解析（LLM） | 〇 予定 | Mac mini 到着後 |
| スマートホーム制御（Tuya） | 〇 予定 | |
| PiCar-X 移動制御 | 〇 予定 | |

---

## 依存ライブラリ

### line-server

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
