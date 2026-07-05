const axios = require('axios');

const ORION = process.env.ORION_URL || 'http://orion:3226';
const SERVICE = process.env.FIWARE_SERVICE || 'linepicarx';
const SERVICEPATH = process.env.FIWARE_SERVICEPATH || '/picarx';

const headers = {
  'fiware-service': SERVICE,
  'fiware-servicepath': SERVICEPATH,
  'Content-Type': 'application/json',
};

async function upsertEntity(entity) {
  try {
    await axios.post(`${ORION}/v2/entities`, entity, { headers });
  } catch (err) {
    if (err.response?.status === 422) {
      const { id, type, ...attrs } = entity;
      await axios.patch(`${ORION}/v2/entities/${id}/attrs`, attrs, { headers });
    } else {
      throw err;
    }
  }
}

async function updatePhoto(photoUrl) {
  const now = new Date().toISOString();
  await upsertEntity({
    id: 'PiCarX:001',
    type: 'PiCarX',
    photo_url: { type: 'Text', value: photoUrl, metadata: {} },
    timestamp: { type: 'DateTime', value: now, metadata: {} },
  });
}

module.exports = { upsertEntity, updatePhoto };
