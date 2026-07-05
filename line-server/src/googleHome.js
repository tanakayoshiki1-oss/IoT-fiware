const GoogleHomePlayer = require('google-home-player');
const castv2 = require('castv2-client');

const IP = process.env.GOOGLE_HOME_IP || '192.168.3.11';
const player = new GoogleHomePlayer(IP, 'ja');

// google-tts-api の TKK キー取得が Google の仕様変更で壊れているため
// TTS URL を直接生成して player.play() に渡す
function say(text) {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=ja&client=tw-ob`;
  return player.play(url);
}

function setVolume(level) {
  return new Promise((resolve, reject) => {
    const client = new castv2.Client();
    client.on('error', err => { client.close(); reject(err); });
    client.connect(IP, () => {
      client.setVolume({ level }, (err, vol) => {
        client.close();
        if (err) reject(err);
        else resolve(vol);
      });
    });
  });
}

function getVolume() {
  return new Promise((resolve, reject) => {
    const client = new castv2.Client();
    client.on('error', err => { client.close(); reject(err); });
    client.connect(IP, () => {
      client.getVolume((err, vol) => {
        client.close();
        if (err) reject(err);
        else resolve(vol);
      });
    });
  });
}

async function handleVolumeCommand(text) {
  if (text === '!音量+' || text === '!ボリューム+') {
    const current = await getVolume();
    const level = Math.min(1.0, current.level + 0.1);
    await setVolume(level);
    console.log(`音量を${Math.round(level * 100)}%に変更`);
    return;
  }
  if (text === '!音量-' || text === '!ボリューム-') {
    const current = await getVolume();
    const level = Math.max(0.0, current.level - 0.1);
    await setVolume(level);
    console.log(`音量を${Math.round(level * 100)}%に変更`);
    return;
  }
  const match = text.match(/^!(音量|ボリューム)(\d+)$/);
  if (match) {
    const pct = Math.min(100, Math.max(0, parseInt(match[2])));
    await setVolume(pct / 100);
    console.log(`音量を${pct}%に設定`);
    return;
  }
  throw new Error(`不明なコマンド: ${text}`);
}

module.exports = { say, handleVolumeCommand };
