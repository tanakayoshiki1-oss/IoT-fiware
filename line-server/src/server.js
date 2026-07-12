const express = require('express');
const path = require('path');
const fs = require('fs');
const { say, handleVolumeCommand } = require('./googleHome');
const { replyText, replyImage } = require('./lineApi');
const { updatePhoto } = require('./orion');
const picarx = require('./picarx');
const localllm = require('./localllm');

const app = express();
const PORT = process.env.PORT || 3001;
const PHOTO_BASE_URL = process.env.PHOTO_BASE_URL || `http://localhost:${PORT}/photos`;
const PHOTOS_DIR = path.join('/app/photos');

app.use(express.json());
app.use('/photos', express.static(PHOTOS_DIR));

// LINE Webhook
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  const events = req.body.events || [];
  for (const event of events) {
    if (event.type !== 'message' || event.message.type !== 'text') continue;

    const raw = event.message.text;
    const text = raw.replace(/^！/, '!');
    const replyToken = event.replyToken;
    const userId = event.source.userId;
    console.log(`[${new Date().toLocaleString('ja-JP')}] ${userId}: ${raw}`);

    if (text === '!写真') {
      await handlePhotoCommand(replyToken);
    } else if (text.startsWith('!')) {
      handleVolumeCommand(text)
        .catch(err => console.error('コマンドエラー:', err));
    } else {
      handleAgentChat(text, replyToken)
        .catch(err => console.error('agentチャットエラー:', err.message));
    }
  }
});

async function handleAgentChat(text, replyToken) {
  let answer;
  try {
    const response = await localllm.chat(text);
    answer = response.data && response.data.answer
      ? response.data.answer
      : '(localllmから応答がありませんでした)';
  } catch (err) {
    console.error('localllm呼び出しエラー:', err.message);
    await replyText(replyToken, 'すみません、応答できませんでした。しばらくしてからもう一度お試しください。')
      .catch(replyErr => console.error('エラー通知の返信にも失敗:', replyErr.message));
    return;
  }

  try {
    await replyText(replyToken, answer);
    console.log(`agent応答: ${answer}`);
  } catch (err) {
    console.error('LINE返信エラー:', err.message);
  }
}

async function handlePhotoCommand(replyToken) {
  try {
    const response = await picarx.takePhoto();
    const filename = `photo_${Date.now()}.jpg`;
    const filepath = path.join(PHOTOS_DIR, filename);
    fs.writeFileSync(filepath, response.data);

    const photoUrl = `${PHOTO_BASE_URL}/${filename}`;
    await updatePhoto(photoUrl);
    await replyImage(replyToken, photoUrl);
    console.log(`写真送信完了: ${photoUrl}`);
  } catch (err) {
    console.error('写真エラー:', err.message);
    await replyText(replyToken, `写真の取得に失敗しました: ${err.message}`);
  }
}

// PiCar-X からの写真アップロード受信（プッシュ型の場合）
app.post('/upload', express.raw({ type: 'image/jpeg', limit: '10mb' }), async (req, res) => {
  const filename = `photo_${Date.now()}.jpg`;
  const filepath = path.join(PHOTOS_DIR, filename);
  fs.writeFileSync(filepath, req.body);
  const photoUrl = `${PHOTO_BASE_URL}/${filename}`;
  await updatePhoto(photoUrl);
  res.json({ url: photoUrl });
  console.log(`写真アップロード受信: ${photoUrl}`);
});

// 動作確認用
app.get('/test', (req, res) => {
  const text = req.query.text || 'テスト。聞こえますか？';
  say(text)
    .then(() => res.send(`読み上げ完了: ${text}`))
    .catch(err => res.status(500).send(`エラー: ${err.message}`));
});

app.listen(PORT, () => {
  console.log(`サーバー起動: http://localhost:${PORT}`);
});
