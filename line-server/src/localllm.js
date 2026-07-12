const axios = require('axios');

const LOCALLLM_URL = process.env.LOCALLLM_URL || 'http://192.168.3.5:8001';

// ローカルLLM (Gemma4 e4b) の生成に30秒前後かかることを実測済みのため、
// LINE の reply token 有効期限を優先しつつ余裕を持たせて45秒に設定。
function chat(message) {
  return axios.post(`${LOCALLLM_URL}/api/agent/chat`, { message }, { timeout: 45000 });
}

module.exports = { chat };
