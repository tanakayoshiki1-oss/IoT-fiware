const axios = require('axios');

const PICARX_URL = process.env.PICARX_URL || 'http://192.168.3.XX:5000';

function takePhoto() {
  return axios.get(`${PICARX_URL}/photo`, { responseType: 'arraybuffer', timeout: 10000 });
}

function sendCommand(command) {
  return axios.post(`${PICARX_URL}/command`, { command }, { timeout: 5000 });
}

module.exports = { takePhoto, sendCommand };
