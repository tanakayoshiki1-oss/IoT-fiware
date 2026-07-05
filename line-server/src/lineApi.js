const axios = require('axios');

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const BASE = 'https://api.line.me/v2/bot';

const headers = () => ({
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
});

function replyText(replyToken, text) {
  return axios.post(`${BASE}/message/reply`, {
    replyToken,
    messages: [{ type: 'text', text }],
  }, { headers: headers() });
}

function replyImage(replyToken, imageUrl) {
  return axios.post(`${BASE}/message/reply`, {
    replyToken,
    messages: [{
      type: 'image',
      originalContentUrl: imageUrl,
      previewImageUrl: imageUrl,
    }],
  }, { headers: headers() });
}

function pushText(userId, text) {
  return axios.post(`${BASE}/message/push`, {
    to: userId,
    messages: [{ type: 'text', text }],
  }, { headers: headers() });
}

module.exports = { replyText, replyImage, pushText };
