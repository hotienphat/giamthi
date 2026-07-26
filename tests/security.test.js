'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const config = fs.readFileSync(path.join(root, 'app-config.js'), 'utf8');

assert(!/\son[a-z]+\s*=/i.test(html), 'HTML must not contain inline event handlers');
assert(!/\.innerHTML\s*=/.test(script), 'Application must not render with innerHTML');
assert(!/Math\.random\s*\(/.test(script), 'IDs and secrets must not use Math.random');
assert(/crypto\.getRandomValues/.test(script), 'Secure random generation is required');
assert(/AES-GCM/.test(script), 'AES-GCM support is required');
assert(/ROOM_CODE_ALPHABET/.test(script) && /SHA-256/.test(script), 'Short room codes must derive encryption material');
assert(/operationId/.test(script) && /type: 'ACK'/.test(script), 'Operation ACK protocol is required');
assert(/SYNC_CHUNK/.test(script), 'Large sync must be chunked');
assert(/Content-Security-Policy/.test(html), 'A CSP must be present');
assert(/maxRecords/.test(config) && /maxPayloadBytes/.test(config), 'Config limits must be declared');

console.log('security.test.js: all assertions passed');
