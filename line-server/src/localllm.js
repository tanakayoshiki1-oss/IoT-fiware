const axios = require('axios');

const LOCALLLM_URL = process.env.LOCALLLM_URL || 'http://192.168.3.5:8001';

// ローカルLLM (Gemma4 e4b) の生成に30秒前後、speak_google_home が絡む場合は
// Google Home の発話完了待ちがさらに乗る（実測で45秒超がタイムアウトする事例あり）。
// 本回答は reply ではなく push で送るため token 期限の制約はなく、待たせても実害が
// 小さいので余裕を持って90秒に設定。
function chat(message) {
  return axios.post(`${LOCALLLM_URL}/api/agent/chat`, { message }, { timeout: 90000 });
}

module.exports = { chat };
