const { createCipheriv, createDecipheriv, randomBytes } = require('crypto');
const { createLogger } = require('./logger');

const ALGORITHM = 'aes-256-gcm';
const ENC_PREFIX = 'ENC:v1:';
const log = createLogger('crypto');

function _getKey() {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) return null;
  return Buffer.from(keyHex, 'hex');
}

// Returns the ciphertext string, or plaintext if key not configured.
function encryptToken(plaintext) {
  if (!plaintext) return plaintext;
  if (String(plaintext).startsWith(ENC_PREFIX)) return plaintext; // already encrypted
  const key = _getKey();
  if (!key) return plaintext;

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

// Returns decrypted plaintext, or the original value if not encrypted.
// Returns null and logs an error if decryption fails.
function decryptToken(value) {
  if (!value) return value;
  if (!String(value).startsWith(ENC_PREFIX)) return value; // plaintext passthrough (legacy data)

  const key = _getKey();
  if (!key) {
    log.error({ action: 'decrypt', outcome: 'failure', err: 'ENCRYPTION_KEY not set — cannot decrypt stored token' });
    return null;
  }

  try {
    const parts = String(value).slice(ENC_PREFIX.length).split(':');
    if (parts.length !== 3) throw new Error('malformed ciphertext');
    const [ivHex, tagHex, ciphertextHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (err) {
    log.error({ action: 'decrypt', outcome: 'failure', err: err.message });
    return null;
  }
}

// Log a startup warning when no key is configured so operators notice.
function warnIfNoKey(serviceName) {
  if (!_getKey()) {
    log.warn({ action: 'startup_check', service: serviceName, outcome: 'warning', err: 'ENCRYPTION_KEY is not set — tokens will be stored in plaintext. Generate a key with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"' });
  }
}

module.exports = { encryptToken, decryptToken, warnIfNoKey };
