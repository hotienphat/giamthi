'use strict';

const CONFIG = window.GIAMTHI_CONFIG || {};
const BROKERS = Array.isArray(CONFIG.brokers) ? CONFIG.brokers : ['wss://broker.emqx.io:8084/mqtt'];
const LIMITS = Object.assign({
    maxRecords: 10000,
    maxItemsPerOperation: 200,
    maxPayloadBytes: 262144,
    maxExcelBytes: 10485760,
    maxImageBytes: 10485760,
    maxJsonBytes: 10485760,
    maxRosterStudents: 5000
}, CONFIG.limits || {});

const STORAGE_PREFIX = 'giamthi:v4';
const LEGACY_DATA_KEY = 'GiamThiAI_v3_Data';
const LEGACY_MIGRATION_KEY = `${STORAGE_PREFIX}:migration:v3`;
const DISPLAY_KEY = `${STORAGE_PREFIX}:display`;
const DB_NAME = CONFIG.indexedDB?.name || 'GiamThiDB_v4';
const DB_VERSION = 2;

const CLASS_PASSWORDS = {
    '12A1': '1231', '12A2': '1232', '12A3': '1233', '12A4': '1234',
    '12A5': '1235', '12A6': '1236', '11B1': '1131', '10C3': '1013'
};

const VIOLATION_MAP = {
    KHONG_MANG_THE: { label: 'Không mang thẻ học viên', keys: ['khong mang the', 'quen the', 'khong deo the', 'deo the', 'quang the', 'k the', 'ko the', 'mat the', 'thieu the', 'the hoc vien', 'the hoc sinh', 'the hs'] },
    KHONG_PHU_HIEU: { label: 'Không đeo phù hiệu', keys: ['khong phu hieu', 'k phu hieu', 'ko phu hieu', 'phu hieu', 'quen phu hieu', 'thieu phu hieu'] },
    SAI_DONG_PHUC: { label: 'Sai đồng phục', keys: ['sai dong phuc', 'khong dong phuc', 'k dong phuc', 'ko dong phuc', 'k dp', 'ko dp', 'dong phuc', 'dp', 'sai quan', 'sai ao', 'ao thun', 'quan jean'] },
    KHONG_MAC_AO_DAI: { label: 'Không mặc áo dài', keys: ['khong mac ao dai', 'mac sai ao dai', 'thieu ao dai', 'k ao dai', 'ko ao dai', 'ao dai', 'aodai', 'aod'] },
    KHONG_MAC_AO_DOAN: { label: 'Không mặc áo đoàn', keys: ['khong mac ao doan', 'thieu ao doan', 'k ao doan', 'ko ao doan', 'ao doan', 'aodoan'] },
    VI_PHAM_ATGT: { label: 'Vi phạm ATGT (Mũ / Xe)', keys: ['khong mu bao hiem', 'k mu bao hiem', 'ko mu bao hiem', 'k mu', 'ko mu', 'k non', 'ko non', 'mu bao hiem', 'non bao hiem', 'chay xe', 'tren 50cc', '50cc', 'phan khoi', 'xe may', 'xe to', 'xe phan khoi lon'] },
    DI_XE_50CC: { label: 'Đi xe trên 50cc', keys: ['tren 50cc', '50cc', 'phan khoi', 'xe may', 'xe to', 'xe phan khoi lon'] },
    NHUOM_TOC: { label: 'Nhuộm tóc / Đầu tóc', keys: ['nhuom toc', 'dau toc', 'toc tai', 'toc nhuom', 'nhuom'] },
    KHONG_DONG_THUNG: { label: 'Không đóng thùng (Sơ vin)', keys: ['khong dong thung', 'chua so vin', 'khong so vin', 'k so vin', 'ko so vin', 'k dong thung', 'ko dong thung', 'dong thung', 'so vin', 'bo ao'] },
    MANG_DEP_LE: { label: 'Mang dép lê', keys: ['mang dep', 'di dep', 'dep le', 'di dep le', 'khong mang giay', 'k giay', 'ko giay', 'dep to ong'] },
    DI_HOC_MUON: { label: 'Đi học muộn', keys: ['di hoc muon', 'di muon', 'di tre', 'hoc muon', 'muon', 'tre'] },
    KHONG_TRUC_NHAT: { label: 'Không trực nhật', keys: ['khong truc nhat', 'truc nhat', 've sinh', 'quet lop', 'chua truc nhat'] },
    SU_DUNG_DIEN_THOAI: { label: 'Sử dụng điện thoại', keys: ['dien thoai trong lop', 'choi dien thoai', 'dung dien thoai', 'dien thoai', 'dt trong lop'] }
};

const CLASS_REGEX = /\b(10|11|12)[A-Z][0-9]{1,2}\b/i;
const ROOM_CODE_ALPHABET = '0123456789';
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

let mqttClient = null;
let room = null;
let currentUser = { name: '', role: '' };
let isHost = false;
let records = [];
let queue = [];
let connections = new Map();
let processedOperations = new Set();
let snapshots = [];
let cryptoKey = null;
let encryptionEnabled = false;
let joined = false;
let handshakeTimer = null;
let heartbeatTimer = null;
let staleTimer = null;
let lastHostSeen = 0;
let syncBuffers = new Map();
let toastTimer = null;
let reconnectNoticeAt = 0;
let flushTimer = null;
let renderTimer = null;
let syncBroadcastTimer = null;
let displaySettings = loadJson(DISPLAY_KEY, { time: true, name: true, class: true, reporter: true });

// PWA & Offline
let deferredPrompt = null;

// IndexedDB instance & Roster cache
let idbInstance = null;
let schoolRoster = [];

// WebRTC P2P DataChannel state
let clientPeerConnection = null;
let clientDataChannel = null;
let hostPeerConnections = new Map(); // clientId -> RTCPeerConnection
let hostDataChannels = new Map();    // clientId -> RTCDataChannel
let isP2PConnected = false;

// Auto backup tracking
let lastAutoBackupTime = Date.now();
let unbackedOperationsCount = 0;

function byId(id) {
    return document.getElementById(id);
}

function roomKey(kind) {
    return `${STORAGE_PREFIX}:${kind}:${room.id}`;
}

function utf8Size(value) {
    return textEncoder.encode(typeof value === 'string' ? value : JSON.stringify(value)).byteLength;
}

function randomBytes(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
}

function randomId(prefix = 'id') {
    return `${prefix}_${base64Url(randomBytes(16))}`;
}

function base64Url(bytes) {
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
    return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function loadJson(key, fallback) {
    try {
        const value = JSON.parse(localStorage.getItem(key));
        return value ?? fallback;
    } catch (error) {
        console.warn('[Storage]', error);
        return fallback;
    }
}

function saveJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (error) {
        showToast('Bộ nhớ trình duyệt đầy', 'Dữ liệu đã được lưu vào IndexedDB an toàn.', 'warning');
        return false;
    }
}

/* =========================================================
   1. INDEXEDDB STORAGE ENGINE (0 VNĐ - CAPACITY 500MB+)
   ========================================================= */

function openIndexedDB() {
    if (idbInstance) return Promise.resolve(idbInstance);
    return new Promise(resolve => {
        if (!window.indexedDB) {
            console.warn('[IndexedDB] Không hỗ trợ, dùng localStorage');
            return resolve(null);
        }
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = event => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('records')) {
                const recordStore = db.createObjectStore('records', { keyPath: 'id' });
                recordStore.createIndex('class', 'class', { unique: false });
                recordStore.createIndex('violation', 'violation', { unique: false });
                recordStore.createIndex('time', 'time', { unique: false });
            }
            if (!db.objectStoreNames.contains('meta')) {
                db.createObjectStore('meta', { keyPath: 'key' });
            }
            if (!db.objectStoreNames.contains('roster')) {
                const rosterStore = db.createObjectStore('roster', { keyPath: 'id' });
                rosterStore.createIndex('class', 'class', { unique: false });
                rosterStore.createIndex('cleanName', 'cleanName', { unique: false });
            }
        };
        request.onsuccess = event => {
            idbInstance = event.target.result;
            resolve(idbInstance);
        };
        request.onerror = event => {
            console.warn('[IndexedDB error]', event.target.error);
            resolve(null);
        };
    });
}

async function idbGet(storeName, key) {
    const db = await openIndexedDB();
    if (!db) return null;
    return new Promise(resolve => {
        try {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result ? (req.result.value ?? req.result) : null);
            req.onerror = () => resolve(null);
        } catch (e) {
            resolve(null);
        }
    });
}

async function idbSet(storeName, item) {
    const db = await openIndexedDB();
    if (!db) return false;
    return new Promise(resolve => {
        try {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            store.put(item);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        } catch (e) {
            resolve(false);
        }
    });
}

async function idbGetAll(storeName) {
    const db = await openIndexedDB();
    if (!db) return [];
    return new Promise(resolve => {
        try {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        } catch (e) {
            resolve([]);
        }
    });
}

async function idbBulkSet(storeName, items) {
    const db = await openIndexedDB();
    if (!db || !Array.isArray(items)) return false;
    return new Promise(resolve => {
        try {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            items.forEach(item => store.put(item));
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        } catch (e) {
            resolve(false);
        }
    });
}

async function idbClear(storeName) {
    const db = await openIndexedDB();
    if (!db) return false;
    return new Promise(resolve => {
        try {
            const tx = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).clear();
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        } catch (e) {
            resolve(false);
        }
    });
}

async function idbDelete(storeName, key) {
    const db = await openIndexedDB();
    if (!db) return false;
    return new Promise(resolve => {
        try {
            const tx = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).delete(key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        } catch (e) {
            resolve(false);
        }
    });
}

/* =========================================================
   2. WEBRTC P2P DATACHANNEL (0 VNĐ PEER-TO-PEER BACKUP)
   ========================================================= */

const P2P_ICE_SERVERS = (CONFIG.webrtc?.iceServers) || [{ urls: 'stun:stun.l.google.com:19302' }];

function updateTransportUI(mode) {
    const badge = byId('transport-badge');
    if (!badge) return;

    if (mode === 'P2P') {
        isP2PConnected = true;
        badge.className = 'transport-badge transport-p2p';
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-bolt';
        badge.replaceChildren(icon, document.createTextNode(' P2P Direct'));
        badge.title = 'Kênh truyền trực tiếp P2P (WebRTC DataChannel) siêu tốc độ 0 VNĐ';
    } else {
        isP2PConnected = false;
        badge.className = 'transport-badge transport-mqtt';
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-tower-broadcast';
        badge.replaceChildren(icon, document.createTextNode(' MQTT'));
        badge.title = 'Kênh truyền WebSocket MQTT công cộng';
    }
}

function initClientP2P() {
    if (!window.RTCPeerConnection || isHost || !room?.clientId) return;
    
    try {
        if (clientPeerConnection) {
            clientPeerConnection.close();
        }

        clientPeerConnection = new RTCPeerConnection({ iceServers: P2P_ICE_SERVERS });
        clientDataChannel = clientPeerConnection.createDataChannel('gt4-p2p', { ordered: true });

        setupDataChannel(clientDataChannel, 'host');

        clientPeerConnection.onicecandidate = event => {
            if (event.candidate) {
                publish(clientTopic(), {
                    type: 'P2P_SIGNAL',
                    subtype: 'CANDIDATE',
                    candidate: event.candidate,
                    clientId: room.clientId
                }, true);
            }
        };

        clientPeerConnection.createOffer().then(offer => {
            return clientPeerConnection.setLocalDescription(offer).then(() => {
                publish(clientTopic(), {
                    type: 'P2P_SIGNAL',
                    subtype: 'OFFER',
                    sdp: offer,
                    clientId: room.clientId
                }, true);
            });
        }).catch(err => console.warn('[P2P Client Offer]', err));

    } catch (error) {
        console.warn('[P2P Init Client]', error);
    }
}

function handleHostP2PSignal(packet) {
    if (!isHost || !packet?.clientId || !window.RTCPeerConnection) return;
    const clientId = packet.clientId;

    if (packet.subtype === 'OFFER' && packet.sdp) {
        try {
            const pc = new RTCPeerConnection({ iceServers: P2P_ICE_SERVERS });
            hostPeerConnections.set(clientId, pc);

            pc.ondatachannel = event => {
                setupDataChannel(event.channel, clientId);
            };

            pc.onicecandidate = event => {
                if (event.candidate) {
                    publish(hostTopic(clientId), {
                        type: 'P2P_SIGNAL',
                        subtype: 'CANDIDATE',
                        candidate: event.candidate,
                        clientId
                    }, true);
                }
            };

            pc.setRemoteDescription(new RTCSessionDescription(packet.sdp)).then(() => {
                return pc.createAnswer();
            }).then(answer => {
                return pc.setLocalDescription(answer).then(() => {
                    publish(hostTopic(clientId), {
                        type: 'P2P_SIGNAL',
                        subtype: 'ANSWER',
                        sdp: answer,
                        clientId
                    }, true);
                });
            }).catch(err => console.warn('[P2P Host Answer]', err));

        } catch (err) {
            console.warn('[P2P Host Setup]', err);
        }
        return;
    }

    if (packet.subtype === 'CANDIDATE' && packet.candidate) {
        const pc = hostPeerConnections.get(clientId);
        if (pc) {
            pc.addIceCandidate(new RTCIceCandidate(packet.candidate)).catch(e => console.warn('[P2P Add ICE]', e));
        }
        return;
    }
}

function handleClientP2PSignal(packet) {
    if (isHost || !clientPeerConnection) return;

    if (packet.subtype === 'ANSWER' && packet.sdp) {
        clientPeerConnection.setRemoteDescription(new RTCSessionDescription(packet.sdp))
            .catch(err => console.warn('[P2P Client Remote Desc]', err));
        return;
    }

    if (packet.subtype === 'CANDIDATE' && packet.candidate) {
        clientPeerConnection.addIceCandidate(new RTCIceCandidate(packet.candidate))
            .catch(e => console.warn('[P2P Client Add ICE]', e));
    }
}

function setupDataChannel(channel, peerId) {
    if (!channel) return;

    channel.onopen = () => {
        if (isHost) {
            hostDataChannels.set(peerId, channel);
            updateTransportUI('P2P');
        } else {
            updateTransportUI('P2P');
            showToast('Kênh truyền P2P', 'Đã thiết lập kết nối trực tiếp WebRTC không độ trễ.', 'success', 4000);
        }
    };

    channel.onclose = () => {
        if (isHost) {
            hostDataChannels.delete(peerId);
            if (!hostDataChannels.size) updateTransportUI('MQTT');
        } else {
            updateTransportUI('MQTT');
        }
    };

    channel.onerror = () => {
        updateTransportUI('MQTT');
    };

    channel.onmessage = async event => {
        try {
            const packet = await decodePacket(event.data);
            if (isHost) {
                handleHostPacket(packet);
            } else {
                handleClientPacket(packet);
            }
        } catch (err) {
            console.warn('[P2P DataChannel Message Error]', err);
        }
    };
}

/* =========================================================
   3. TEXT, VALIDATION, UTILS & CRYPTO
   ========================================================= */

function cleanText(value, maxLength) {
    return String(value ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function validClass(value, allowUnknown = false) {
    const result = cleanText(value, 8).toUpperCase();
    return (allowUnknown && result === '?') || /^(10|11|12)[A-Z][0-9]{1,2}$/.test(result) ? result : '';
}

function normalizeRecord(input) {
    if (!input || typeof input !== 'object') return null;
    
    const name = cleanText(input.name, 100);
    const className = validClass(input.class, true);
    const violation = cleanText(input.violation, 120);
    const reporter = cleanText(input.reporter, 100);
    const time = Number.isFinite(Date.parse(input.time)) ? new Date(input.time).toISOString() : new Date().toISOString();
    
    if (!name || !className || !violation) return null;
    
    return {
        id: cleanText(input.id, 80) || randomId('row'),
        name,
        class: className,
        violation,
        reporter,
        time
    };
}

function dedupeAndLimit(items) {
    const ids = new Set();
    const output = [];
    
    for (const raw of Array.isArray(items) ? items : []) {
        const item = normalizeRecord(raw);
        if (item && !ids.has(item.id)) {
            ids.add(item.id);
            output.push(item);
        }
        if (output.length >= LIMITS.maxRecords) break;
    }
    
    return output;
}

function showToast(title, message, type = 'info', duration = 4000) {
    const toast = byId('toast');
    const icons = { info: 'fa-circle-info', success: 'fa-circle-check', error: 'fa-circle-xmark', warning: 'fa-triangle-exclamation' };
    
    byId('toast-title').textContent = cleanText(title, 80);
    byId('toast-message').textContent = cleanText(message, 300);
    
    const icon = document.createElement('i');
    icon.className = `fa-solid ${icons[type] || icons.info}`;
    byId('toast-icon').replaceChildren(icon);
    
    toast.className = `toast-${type}`;
    byId('toast-progress').style.animation = 'none';
    
    void byId('toast-progress').offsetHeight; // trigger reflow
    
    byId('toast-progress').style.animation = `toastProgress ${duration}ms linear forwards`;
    requestAnimationFrame(() => toast.classList.add('show'));
    
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

function updateStatus(text, color = 'green') {
    byId('connection-status-text').textContent = text;
    byId('connection-status-dot').className = `status-dot ${color === 'green' ? 'online' : color === 'red' ? 'offline' : 'pending'}`;
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(button => {
        button.classList.toggle('active', button.dataset.tab === tab);
    });
    
    ['create', 'join'].forEach(name => {
        byId(`form-${name}`).classList.toggle('d-none', name !== tab);
    });
}

function togglePasswordInput() {
    const role = byId('join-role').value;
    byId('guest-name-field').classList.toggle('d-none', !role);
    byId('password-field').classList.toggle('d-none', !Object.hasOwn(CLASS_PASSWORDS, role));
}

function switchToMainApp() {
    if (joined) return;
    joined = true;
    
    byId('login-screen').classList.add('d-none');
    byId('main-app').classList.remove('d-none', 'app-hidden');
    requestAnimationFrame(() => byId('main-app').classList.add('app-visible'));
    
    byId('display-name').textContent = currentUser.name;
    byId('display-role').textContent = currentUser.role === 'MONITOR' ? 'Giám thị phụ' : currentUser.role;
    byId('display-role').className = `role-badge ${isHost ? 'role-badge-host' : 'role-badge-client'}`;
    
    if (isHost) {
        byId('pin-container').classList.remove('d-none');
        byId('display-pin').textContent = room.invite.startsWith('GT4.') ? `${room.invite.slice(0, 12)}...` : room.invite;
        byId('clear-all-btn').classList.remove('d-none');
        byId('connected-users-bubble').classList.remove('d-none');
    }
    
    for (const [key, value] of Object.entries(displaySettings)) {
        const input = byId(`show-${key}`);
        if (input) {
            input.checked = Boolean(value);
        }
    }
    
    const datalist = byId('violation-suggestions');
    datalist.replaceChildren(...Object.values(VIOLATION_MAP).map(value => {
        const option = document.createElement('option');
        option.value = value.label;
        return option;
    }));
    
    byId('enter-to-send').checked = !matchMedia('(max-width: 768px)').matches;
    renderReport();
    loadRoster();
}

function createLegacyInvite(roomInfo) {
    const payload = {
        v: 4,
        r: roomInfo.id,
        b: roomInfo.brokerIndex,
        s: roomInfo.secret
    };
    return `GT4.${base64Url(textEncoder.encode(JSON.stringify(payload)))}`;
}

function createRoomCode(brokerIndex) {
    const values = randomBytes(12);
    const characters = [ROOM_CODE_ALPHABET[brokerIndex]];
    
    for (let index = 1; index < 12; index++) {
        characters.push(ROOM_CODE_ALPHABET[values[index] % ROOM_CODE_ALPHABET.length]);
    }
    
    return characters.join('').replace(/(.{4})(?=.)/g, '$1-');
}

function normalizeRoomCode(value) {
    return String(value).replace(/[^0-9]/g, '');
}

async function roomFromCode(value) {
    const compact = normalizeRoomCode(value);
    
    if (compact.length !== 12 || [...compact].some(character => !ROOM_CODE_ALPHABET.includes(character))) {
        return null;
    }
    
    const brokerIndex = ROOM_CODE_ALPHABET.indexOf(compact[0]);
    if (!BROKERS[brokerIndex]) return null;
    
    const digest = crypto.subtle
        ? new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(`giamthi:v4:${compact}`)))
        : textEncoder.encode(compact.padEnd(32, compact));
        
    return {
        id: compact.toLowerCase(),
        brokerIndex,
        secret: base64Url(digest),
        invite: compact.replace(/(.{4})(?=.)/g, '$1-')
    };
}

async function parseInvite(value) {
    const shortRoom = await roomFromCode(value);
    if (shortRoom) return shortRoom;
    
    try {
        if (!/^GT4\.[A-Za-z0-9_-]{30,220}$/.test(value)) {
            throw new Error('format');
        }
        
        const data = JSON.parse(textDecoder.decode(fromBase64Url(value.slice(4))));
        
        if (data.v !== 4 || 
            !/^[A-Za-z0-9_-]{12,40}$/.test(data.r) || 
            !Number.isInteger(data.b) || 
            !BROKERS[data.b] || 
            !/^[A-Za-z0-9_-]{40,50}$/.test(data.s)) {
            throw new Error('fields');
        }
        
        return {
            id: data.r,
            brokerIndex: data.b,
            secret: data.s,
            invite: value
        };
    } catch (error) {
        return null;
    }
}

async function setupCrypto() {
    encryptionEnabled = Boolean(window.isSecureContext && crypto.subtle);
    
    if (!encryptionEnabled) {
        cryptoKey = null;
        showToast(
            'Cảnh báo bảo mật',
            'Web Crypto không khả dụng. Payload sẽ không mã hóa; chỉ nên chạy qua HTTPS hoặc localhost.',
            'warning',
            9000
        );
        return;
    }
    
    cryptoKey = await crypto.subtle.importKey(
        'raw',
        fromBase64Url(room.secret),
        'AES-GCM',
        false,
        ['encrypt', 'decrypt']
    );
}

async function encodePacket(packet) {
    const raw = textEncoder.encode(JSON.stringify(packet));
    
    if (raw.byteLength > LIMITS.maxPayloadBytes) {
        throw new Error('Payload vượt giới hạn');
    }
    
    if (!encryptionEnabled) {
        return JSON.stringify({ v: 4, plaintext: packet });
    }
    
    const iv = randomBytes(12);
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: textEncoder.encode(room.id) },
        cryptoKey,
        raw
    );
    
    return JSON.stringify({
        v: 4,
        iv: base64Url(iv),
        data: base64Url(new Uint8Array(encrypted))
    });
}

async function decodePacket(message) {
    if (message.length > LIMITS.maxPayloadBytes * 2) {
        throw new Error('Message quá lớn');
    }
    
    const envelope = JSON.parse(message);
    
    if (envelope.v !== 4) {
        throw new Error('Sai protocol');
    }
    
    if (envelope.plaintext && !encryptionEnabled) {
        return envelope.plaintext;
    }
    
    if (!encryptionEnabled || !envelope.iv || !envelope.data) {
        throw new Error('Sai chế độ mã hóa');
    }
    
    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64Url(envelope.iv), additionalData: textEncoder.encode(room.id) },
        cryptoKey,
        fromBase64Url(envelope.data)
    );
    
    return JSON.parse(textDecoder.decode(decrypted));
}

/* Dual-Channel Publisher (WebRTC DataChannel first, MQTT fallback) */
async function publish(topic, packet, forceMqttOnly = false) {
    try {
        const encoded = await encodePacket(packet);

        // Try direct WebRTC P2P DataChannel if available
        if (!forceMqttOnly) {
            if (!isHost && clientDataChannel?.readyState === 'open') {
                try {
                    clientDataChannel.send(encoded);
                    return true;
                } catch (e) {
                    // Fall back to MQTT
                }
            } else if (isHost) {
                const match = topic.match(/host\/([^/]+)$/);
                if (match && hostDataChannels.has(match[1])) {
                    const chan = hostDataChannels.get(match[1]);
                    if (chan?.readyState === 'open') {
                        try {
                            chan.send(encoded);
                            return true;
                        } catch (e) {
                            // Fall back to MQTT
                        }
                    }
                }
            }
        }

        // MQTT transport
        if (!mqttClient?.connected) return false;
        mqttClient.publish(topic, encoded, { qos: 1, retain: false });
        return true;
    } catch (error) {
        console.warn('[Publish]', error);
        showToast('Không thể gửi', error.message, 'error');
        return false;
    }
}

function clientTopic() {
    return `giamthi/v4/${room.id}/client`;
}

function hostTopic(clientId = '') {
    return `giamthi/v4/${room.id}/host${clientId ? `/${clientId}` : ''}`;
}

async function sendSync(clientId = '') {
    const topic = hostTopic(clientId);
    
    if (utf8Size({ type: 'SYNC', records }) <= LIMITS.maxPayloadBytes) {
        return publish(topic, { type: 'SYNC', records, ack: true, at: Date.now() });
    }
    
    const syncId = randomId('sync');
    const chunks = [];
    
    for (let index = 0; index < records.length; index += 100) {
        chunks.push(records.slice(index, index + 100));
    }
    
    for (let index = 0; index < chunks.length; index++) {
        const sent = await publish(topic, {
            type: 'SYNC_CHUNK',
            syncId,
            index,
            total: chunks.length,
            records: chunks[index],
            at: Date.now()
        });
        if (!sent) return false;
    }
    
    return true;
}

async function createRoom() {
    const name = cleanText(byId('host-name').value, 100);
    if (!name) {
        return showToast('Thiếu thông tin', 'Vui lòng chọn danh tính giám thị.', 'error');
    }
    
    if (!window.crypto?.getRandomValues || !window.mqtt?.connect) {
        return showToast('Thiếu thư viện', 'Trình duyệt thiếu Crypto hoặc thư viện MQTT chưa tải được.', 'error');
    }
    
    const maxBrokers = Math.min(BROKERS.length, ROOM_CODE_ALPHABET.length);
    let brokerIndex;
    do {
        brokerIndex = randomBytes(1)[0];
    } while (brokerIndex >= Math.floor(256 / maxBrokers) * maxBrokers);
    brokerIndex = brokerIndex % maxBrokers;
    
    room = await roomFromCode(createRoomCode(brokerIndex));
    currentUser = { name, role: 'HOST' };
    isHost = true;
    
    await setupCrypto();
    
    saveJson(roomKey('session-host'), { room, user: currentUser });
    saveJson(roomKey('recovery-host'), { room, user: currentUser });
    localStorage.setItem(`${STORAGE_PREFIX}:last-host`, room.id);
    
    idbSet('meta', { key: roomKey('session-host'), value: { room, user: currentUser } });
    idbSet('meta', { key: roomKey('recovery-host'), value: { room, user: currentUser } });
    
    connectMQTT();
}

async function joinRoom() {
    const invite = cleanText(byId('join-pin').value, 240);
    const parsed = await parseInvite(invite);
    const role = byId('join-role').value;
    const name = cleanText(byId('guest-name').value, 100);
    
    if (!parsed) {
        return showToast('Mã phòng không hợp lệ', 'Nhập mã 12 chữ số do Host cung cấp, ví dụ 0123-4567-8901.', 'error');
    }
    
    if (!role || !name) {
        return showToast('Thiếu thông tin', 'Vui lòng chọn vai trò và nhập tên người trực.', 'error');
    }
    
    if (Object.hasOwn(CLASS_PASSWORDS, role) && byId('join-password').value !== CLASS_PASSWORDS[role]) {
        return showToast('Sai mật khẩu', 'Mật khẩu lớp không đúng.', 'error');
    }
    
    if (!window.crypto?.getRandomValues || !window.mqtt?.connect) {
        return showToast('Thiếu thư viện', 'Trình duyệt thiếu Crypto hoặc thư viện MQTT chưa tải được.', 'error');
    }
    
    room = Object.assign(parsed, { clientId: randomId('client') });
    currentUser = { name, role };
    isHost = false;
    
    await setupCrypto();
    
    saveJson(roomKey('session-client'), { room, user: currentUser });
    localStorage.setItem(`${STORAGE_PREFIX}:last-client`, room.id);
    idbSet('meta', { key: roomKey('session-client'), value: { room, user: currentUser } });
    
    queue = sanitizeQueue(loadJson(roomKey('queue'), []));
    updatePendingBadge();
    
    connectMQTT();
    updateStatus('Đang chờ Host xác nhận...', 'yellow');
    
    handshakeTimer = setTimeout(() => {
        if (!joined) {
            mqttClient?.end(true);
            updateStatus('Host không phản hồi', 'red');
            showToast('Không thể vào phòng', 'Host không ACK/SYNC trong 15 giây. Kiểm tra mã phòng và Host đang mở.', 'error', 9000);
        }
    }, 15000);
}

function connectMQTT() {
    const clientId = `gt4_${base64Url(randomBytes(10))}`;
    room.clientId = room.clientId || clientId;
    
    if (!isHost) {
        queue.forEach(operation => {
            operation.clientId = room.clientId;
        });
        saveQueue();
        saveJson(roomKey('session-client'), { room, user: currentUser });
    }
    
    updateStatus('Đang kết nối MQTT...', 'yellow');
    
    mqttClient = mqtt.connect(BROKERS[room.brokerIndex], {
        clientId,
        keepalive: 20,
        connectTimeout: 10000,
        reconnectPeriod: 3000,
        clean: true
    });
    
    mqttClient.on('connect', () => {
        if (isHost) {
            mqttClient.subscribe(clientTopic(), { qos: 1 });
            loadHostState();
            switchToMainApp();
            updateStatus('Máy chủ đang hoạt động', 'green');
            showToast('Phòng đã mở', `Mã phòng: ${room.invite}`, 'success', 7000);
        } else {
            mqttClient.subscribe([hostTopic(), hostTopic(room.clientId)], { qos: 1 });
            publish(clientTopic(), {
                type: 'HELLO',
                clientId: room.clientId,
                metadata: currentUser,
                sentAt: Date.now()
            });
        }
    });
    
    mqttClient.on('message', async (topic, message) => {
        try {
            const packet = await decodePacket(message.toString());
            if (isHost && topic === clientTopic()) {
                handleHostPacket(packet);
            }
            if (!isHost && (topic === hostTopic() || topic === hostTopic(room.clientId))) {
                handleClientPacket(packet);
            }
        } catch (error) {
            console.warn('[MQTT message rejected]', error);
        }
    });
    
    mqttClient.on('reconnect', () => {
        updateStatus('Đang kết nối lại...', 'yellow');
    });
    
    mqttClient.on('close', () => {
        if (!isP2PConnected) {
            updateStatus('Mất kết nối MQTT, tự thử lại...', 'red');
        }
        if (Date.now() - reconnectNoticeAt > 10000 && !isP2PConnected) {
            reconnectNoticeAt = Date.now();
            showToast('Mất kết nối MQTT', 'Hệ thống tự thử lại; nếu P2P đang mở dữ liệu vẫn thông suốt.', 'warning');
        }
    });
    
    mqttClient.on('error', error => {
        console.warn('[MQTT]', error.message);
    });
    
    startHeartbeat();
}

function startHeartbeat() {
    clearInterval(heartbeatTimer);
    clearInterval(staleTimer);
    
    heartbeatTimer = setInterval(() => {
        if (isHost) {
            publish(hostTopic(), { type: 'HEARTBEAT', at: Date.now() });
        } else {
            publish(clientTopic(), {
                type: 'HEARTBEAT',
                clientId: room.clientId,
                metadata: currentUser,
                at: Date.now()
            });
        }
    }, 10000);
    
    staleTimer = setInterval(() => {
        if (isHost) {
            const cutoff = Date.now() - 30000;
            for (const [id, connection] of connections) {
                if (connection.lastSeen < cutoff) {
                    connections.delete(id);
                }
            }
            updateUserListUI();
        } else if (joined && lastHostSeen && Date.now() - lastHostSeen > 30000 && !isP2PConnected) {
            updateStatus('Host không phản hồi', 'red');
        }
    }, 5000);
}

function handleHostPacket(packet) {
    if (!packet || typeof packet !== 'object') return;
    
    if (packet.type === 'HELLO' || packet.type === 'HEARTBEAT') {
        const clientId = cleanText(packet.clientId, 80);
        if (!clientId) return;
        
        connections.set(clientId, {
            metadata: {
                name: cleanText(packet.metadata?.name, 100),
                role: cleanText(packet.metadata?.role, 20)
            },
            lastSeen: Date.now()
        });
        updateUserListUI();
        
        if (packet.type === 'HELLO') {
            sendSync(clientId);
        }
        return;
    }

    if (packet.type === 'P2P_SIGNAL') {
        handleHostP2PSignal(packet);
        return;
    }
    
    if (packet.type === 'OPERATION') {
        applyHostOperation(packet);
    }
}

function handleClientPacket(packet) {
    if (!packet || typeof packet !== 'object') return;
    lastHostSeen = Date.now();
    
    if (packet.type === 'HEARTBEAT') {
        if (joined) {
            updateStatus(isP2PConnected ? 'Đã kết nối với Host (P2P)' : 'Đã kết nối với Host', 'green');
        }
        return;
    }

    if (packet.type === 'P2P_SIGNAL') {
        handleClientP2PSignal(packet);
        return;
    }
    
    if (packet.type === 'SYNC') {
        acceptSync(packet.records);
        return;
    }
    
    if (packet.type === 'SYNC_CHUNK') {
        const syncId = cleanText(packet.syncId, 80);
        if (!syncId ||
            !Number.isInteger(packet.index) ||
            !Number.isInteger(packet.total) ||
            packet.total < 1 ||
            packet.total > 100 ||
            packet.index < 0 ||
            packet.index >= packet.total ||
            !Array.isArray(packet.records)) {
            return;
        }
        
        const buffer = syncBuffers.get(syncId) || {
            total: packet.total,
            chunks: new Map(),
            createdAt: Date.now()
        };
        
        if (buffer.total !== packet.total) return;
        
        buffer.chunks.set(packet.index, packet.records);
        syncBuffers.set(syncId, buffer);
        
        for (const [id, pending] of syncBuffers) {
            if (Date.now() - pending.createdAt > 30000) {
                syncBuffers.delete(id);
            }
        }
        
        if (buffer.chunks.size === buffer.total) {
            const allRecords = [];
            for (let index = 0; index < buffer.total; index++) {
                allRecords.push(...buffer.chunks.get(index));
            }
            syncBuffers.delete(syncId);
            acceptSync(allRecords);
        }
        return;
    }
    
    if (packet.type === 'ACK') {
        const operation = queue.find(item => item.operationId === packet.operationId);
        queue = queue.filter(item => item.operationId !== packet.operationId);
        
        saveQueue();
        updatePendingBadge();
        
        if (!packet.ok && operation) {
            showToast('Host từ chối thao tác', cleanText(packet.error, 200), 'error');
            requestSync();
        }
        return;
    }
}

function acceptSync(syncedRecords) {
    records = dedupeAndLimit(syncedRecords);
    
    clearTimeout(handshakeTimer);
    switchToMainApp();
    updateStatus(isP2PConnected ? 'Đã kết nối với Host (P2P)' : 'Đã kết nối với Host', 'green');
    
    reconcileQueue();
    renderReport();
    flushQueue();

    // Initiate WebRTC DataChannel P2P with Host
    if (!isP2PConnected) {
        initClientP2P();
    }
}

function validateOperation(operation) {
    if (!operation || !/^[A-Za-z0-9_-]{10,80}$/.test(operation.operationId || '')) {
        return 'operationId không hợp lệ';
    }
    
    if (!['ADD', 'UPDATE', 'REMOVE'].includes(operation.action)) {
        return 'Loại thao tác không hợp lệ';
    }
    
    if (utf8Size(operation) > LIMITS.maxPayloadBytes) {
        return 'Payload quá lớn';
    }
    
    if (operation.action === 'ADD') {
        if (!Array.isArray(operation.items) || !operation.items.length || operation.items.length > LIMITS.maxItemsPerOperation) {
            return 'Số dòng thêm không hợp lệ';
        }
        if (records.length + operation.items.length > LIMITS.maxRecords) {
            return `Tối đa ${LIMITS.maxRecords} bản ghi`;
        }
        if (dedupeAndLimit(operation.items).length !== operation.items.length) {
            return 'Dữ liệu thêm không hợp lệ hoặc trùng ID';
        }
    }
    
    if (operation.action !== 'ADD' && !/^[A-Za-z0-9_-]{5,80}$/.test(operation.id || '')) {
        return 'ID bản ghi không hợp lệ';
    }
    
    if (operation.action === 'UPDATE' && !normalizeRecord(Object.assign({}, operation.data, {
        id: operation.id,
        time: operation.data?.time || new Date().toISOString()
    }))) {
        return 'Nội dung sửa không hợp lệ';
    }
    
    return '';
}

async function applyHostOperation(operation) {
    const operationId = cleanText(operation.operationId, 80);
    
    if (processedOperations.has(operationId)) {
        publish(hostTopic(operation.clientId), { type: 'ACK', operationId, ok: true });
        return;
    }
    
    const error = validateOperation(operation);
    if (error) {
        publish(hostTopic(operation.clientId), { type: 'ACK', operationId, ok: false, error });
        return;
    }
    
    applyOperationLocally(operation);
    processedOperations.add(operationId);
    
    if (processedOperations.size > 1000) {
        processedOperations = new Set([...processedOperations].slice(-800));
    }
    
    saveHostState();
    renderReport();
    await publish(hostTopic(operation.clientId), { type: 'ACK', operationId, ok: true });
    
    clearTimeout(syncBroadcastTimer);
    syncBroadcastTimer = setTimeout(() => sendSync(), 500);
}

function applyOperationLocally(operation) {
    if (operation.action === 'ADD') {
        const ids = new Set(records.map(item => item.id));
        const additions = dedupeAndLimit(operation.items).filter(item => !ids.has(item.id));
        records = records.concat(additions).slice(0, LIMITS.maxRecords);
        unbackedOperationsCount += additions.length;
    } else if (operation.action === 'REMOVE') {
        records = records.filter(item => item.id !== operation.id);
        unbackedOperationsCount++;
    } else if (operation.action === 'UPDATE') {
        const index = records.findIndex(item => item.id === operation.id);
        if (index >= 0) {
            records[index] = normalizeRecord(Object.assign({}, records[index], operation.data, {
                id: operation.id
            }));
            unbackedOperationsCount++;
        }
    }
}

function sanitizeQueue(value) {
    const seen = new Set();
    const result = [];
    const operations = Array.isArray(value) ? value : [];
    
    for (const operation of operations) {
        if (!operation) continue;
        if (seen.has(operation.operationId)) continue;
        if (validateQueuedShape(operation)) continue;
        
        seen.add(operation.operationId);
        result.push(operation);
    }
    
    return result.slice(-500);
}

function validateQueuedShape(operation) {
    return (!operation.operationId || !['ADD', 'UPDATE', 'REMOVE'].includes(operation.action)) ? 'invalid' : '';
}

function sendOperation(action, payload) {
    const operation = Object.assign({
        type: 'OPERATION',
        action,
        operationId: randomId('op'),
        clientId: room.clientId || 'host',
        createdAt: Date.now()
    }, payload);
    
    if (isHost) {
        applyHostOperation(operation);
        return;
    }
    
    queue.push(operation);
    saveQueue();
    applyOperationLocally(operation);
    renderReport();
    updatePendingBadge();
    flushQueue();
}

function flushQueue() {
    if (isHost || !joined) return;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
        queue.forEach(operation => publish(clientTopic(), operation));
    }, 300);
}

function reconcileQueue() {
    queue.forEach(operation => applyOperationLocally(operation));
}

function requestSync() {
    publish(clientTopic(), {
        type: 'HELLO',
        clientId: room.clientId,
        metadata: currentUser,
        sentAt: Date.now()
    });
}

function saveQueue() {
    if (!isHost) {
        saveJson(roomKey('queue'), queue);
        idbSet('meta', { key: roomKey('queue'), value: queue });
    }
}

function updatePendingBadge() {
    const badge = byId('pending-badge');
    if (!badge) return;
    
    badge.textContent = `${queue.length} đang chờ ACK`;
    badge.classList.toggle('d-none', !queue.length);
}

async function loadHostState() {
    let state = await idbGet('meta', roomKey('data'));
    if (!state) {
        state = loadJson(roomKey('data'), null);
    }
    
    if (state?.version >= 4) {
        records = dedupeAndLimit(state.records);
        processedOperations = new Set((state.processedOperations || []).slice(-1000));
        snapshots = Array.isArray(state.snapshots) ? state.snapshots.slice(-3) : loadJson(roomKey('snapshots'), []).slice(-3);
    } else {
        const legacy = localStorage.getItem(LEGACY_MIGRATION_KEY) ? [] : loadJson(LEGACY_DATA_KEY, []);
        records = dedupeAndLimit(legacy);
        processedOperations = new Set();
        snapshots = [];
        
        if (records.length) {
            saveJson(LEGACY_MIGRATION_KEY, {
                migratedAt: new Date().toISOString(),
                roomId: room.id,
                records: records.length
            });
            showToast('Đã migration v3', `${records.length} bản ghi cũ đã được sao chép một lần vào phòng này. Dữ liệu gốc vẫn được giữ.`, 'success', 7000);
        }
        saveHostState();
    }
    
    byId('undo-clear-btn').classList.toggle('d-none', !snapshots.length);
}

function saveHostState() {
    if (!isHost) return;
    
    const stateObj = {
        version: 5,
        roomId: room.id,
        updatedAt: new Date().toISOString(),
        records,
        processedOperations: [...processedOperations]
    };
    
    saveJson(roomKey('data'), stateObj);
    saveJson(roomKey('snapshots'), snapshots);

    // Asynchronous IndexedDB write
    idbSet('meta', { key: roomKey('data'), value: stateObj });
    idbSet('meta', { key: roomKey('snapshots'), value: snapshots });
    idbBulkSet('records', records);

    checkAutoBackup();
}

function clearAll() {
    if (!isHost) return;
    if (!records.length) return;
    
    if (!confirm('Xóa tất cả dữ liệu? Hệ thống sẽ tạo snapshot để hoàn tác.')) {
        return;
    }
    
    snapshots.push({
        createdAt: new Date().toISOString(),
        records
    });
    snapshots = snapshots.slice(-3);
    records = [];
    
    saveHostState();
    renderReport();
    byId('undo-clear-btn').classList.remove('d-none');
    sendSync();
    showToast('Đã xóa tất cả', 'Snapshot được giữ trên máy Host để hoàn tác.', 'warning');
}

function undoClear() {
    if (!isHost || !snapshots.length) return;
    
    records = dedupeAndLimit(snapshots.pop().records);
    
    saveHostState();
    renderReport();
    byId('undo-clear-btn').classList.toggle('d-none', !snapshots.length);
    sendSync();
    showToast('Đã phục hồi', 'Dữ liệu từ snapshot gần nhất đã trở lại.', 'success');
}

function removeAccents(value) {
    return String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D');
}

function titleCase(value) {
    return value.toLowerCase().replace(/(^|\s)\S/g, letter => letter.toUpperCase());
}

function keywordIndex(text, keyword) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const match = new RegExp(`(?:^|[^a-z0-9])(${escaped})(?=$|[^a-z0-9])`, 'i').exec(text);
    return match ? match.index + match[0].indexOf(match[1]) : -1;
}

function detectViolation(value) {
    const normalized = removeAccents(cleanText(value, 120).toLowerCase());
    let best = null;
    for (const definition of Object.values(VIOLATION_MAP)) {
        for (const key of definition.keys) {
            const index = keywordIndex(normalized, key);
            if (index >= 0 && (!best || index < best.index || (index === best.index && key.length > best.key.length))) {
                best = { index, key, label: definition.label };
            }
        }
    }
    return best?.label || titleCase(cleanText(value, 120) || 'Chưa xác định');
}

/* =========================================================
   4. LOCAL ON-DEVICE AI (ROSTER, AUTOCOMPLETE & NLP)
   ========================================================= */

async function loadRoster() {
    schoolRoster = await idbGetAll('roster');
    updateRosterStatsUI();
}

function updateRosterStatsUI() {
    const totalCount = schoolRoster.length;
    const classes = new Set(schoolRoster.map(s => s.class)).size;

    const totalEl = byId('roster-total-count');
    const classEl = byId('roster-class-count');
    const chipCountEl = byId('ai-roster-count');

    if (totalEl) totalEl.textContent = String(totalCount);
    if (classEl) classEl.textContent = String(classes);
    if (chipCountEl) chipCountEl.textContent = `${totalCount} HS`;
}

function searchRoster(classQuery, nameQuery) {
    if (!schoolRoster.length) return [];
    const normalizedClass = validClass(classQuery);
    const normalizedName = removeAccents(cleanText(nameQuery, 50).toLowerCase());

    if (!normalizedClass && !normalizedName) return [];

    return schoolRoster.filter(student => {
        const classMatch = !normalizedClass || student.class === normalizedClass;
        const nameMatch = !normalizedName || student.cleanName.includes(normalizedName);
        return classMatch && nameMatch;
    }).slice(0, 6);
}

function handleTextareaAutocomplete(event) {
    const textarea = event.target;
    const text = textarea.value;
    const cursor = textarea.selectionStart;

    // Get the current line up to the cursor
    const lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
    const lineEnd = text.indexOf('\n', cursor);
    const currentLine = text.slice(lineStart, lineEnd >= 0 ? lineEnd : text.length);

    const classMatch = currentLine.match(CLASS_REGEX);
    const bar = byId('ai-autocomplete-bar');
    const list = byId('ai-suggestions-list');

    if (!classMatch || !schoolRoster.length) {
        bar?.classList.add('d-none');
        return;
    }

    const className = validClass(classMatch[0]);
    const afterClass = currentLine.slice(classMatch.index + classMatch[0].length).replace(/^[-–:\s]+/, '').trim();
    const suggestions = searchRoster(className, afterClass);

    if (!suggestions.length) {
        bar?.classList.add('d-none');
        return;
    }

    bar?.classList.remove('d-none');
    list.replaceChildren();

    suggestions.forEach(student => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'ai-suggestion-chip';

        const cls = document.createElement('span');
        cls.className = 'ai-suggestion-class';
        cls.textContent = student.class;

        const name = document.createElement('span');
        name.textContent = student.name;

        chip.append(cls, name);
        if (student.code) {
            const code = document.createElement('span');
            code.className = 'ai-suggestion-code';
            code.textContent = `(${student.code})`;
            chip.append(code);
        }

        chip.addEventListener('click', () => {
            // Replace the partial line with full name
            const beforeClass = currentLine.slice(0, classMatch.index + classMatch[0].length);
            const newLine = `${beforeClass} ${student.name} - `;
            const newText = text.slice(0, lineStart) + newLine + (lineEnd >= 0 ? text.slice(lineEnd) : '');
            textarea.value = newText;
            textarea.focus();
            const newCursor = lineStart + newLine.length;
            textarea.setSelectionRange(newCursor, newCursor);
            bar.classList.add('d-none');
        });

        list.append(chip);
    });
}

function smartParse(rawText) {
    const lines = String(rawText).split(/\n+/).slice(0, LIMITS.maxItemsPerOperation);
    const output = [];
    for (const rawLine of lines) {
        const line = cleanText(rawLine, 300);
        if (!line) continue;
        const classMatch = line.match(CLASS_REGEX);
        if (!classMatch) continue;
        const className = validClass(classMatch[0]);
        if (!className) continue;
        
        let before = line.slice(0, classMatch.index).replace(/[-–]/g, ' ').trim();
        before = before.replace(/^(?:\d+[\.\)\-\:\/]\s*|l[oớ]p(?:\s+|$))+/i, '').trim();
        
        const after = line.slice(classMatch.index + classMatch[0].length).replace(/^[-–:\s]+/, '').trim();
        let name = before;
        let violation = after;
        
        if (!name) {
            let rosterMatched = false;
            if (schoolRoster.length) {
                const classStudents = schoolRoster.filter(s => s.class === className);
                const normAfter = removeAccents(after.toLowerCase());
                classStudents.sort((a, b) => b.cleanName.length - a.cleanName.length);
                for (const student of classStudents) {
                    if (normAfter.startsWith(student.cleanName) || normAfter.startsWith(removeAccents(student.name.toLowerCase()))) {
                        name = student.name;
                        violation = after.slice(student.name.length).replace(/^[-–:,\s]+/, '').trim();
                        rosterMatched = true;
                        break;
                    }
                }
            }

            if (!rosterMatched) {
                const split = after.split(/[-–;:]/, 2);
                if (split.length === 2) {
                    [name, violation] = split.map(value => value.trim());
                } else {
                    const normalized = removeAccents(after.toLowerCase());
                    let found = null;
                    for (const definition of Object.values(VIOLATION_MAP)) {
                        for (const key of definition.keys) {
                            const index = keywordIndex(normalized, key);
                            if (index > 0 && (!found || index < found.index || (index === found.index && key.length > found.key.length))) {
                                found = { index, key };
                            }
                        }
                    }
                    if (found) {
                        name = after.slice(0, found.index).trim();
                        violation = after.slice(found.index).trim();
                    }
                }
            }
        }
        
        name = cleanText(name, 100).replace(/^[-–:.,\s]+|[-–:.,\s]+$/g, '');
        violation = cleanText(violation, 120).replace(/^[-–:.,\s]+|[-–:.,\s]+$/g, '');
        if (!name || !violation) continue;

        // Local AI Fuzzy Match: if exact or near match in Roster for that class, use official student name
        if (schoolRoster.length) {
            const matches = searchRoster(className, name);
            if (matches.length === 1 || (matches[0] && removeAccents(matches[0].cleanName) === removeAccents(name.toLowerCase()))) {
                name = matches[0].name;
            }
        }
        
        for (const part of violation.split(/[,+]/).slice(0, 5)) {
            const cleanedPart = cleanText(part, 120).replace(/^[-–:.,\s]+|[-–:.,\s]+$/g, '');
            if (!cleanedPart) continue;
            output.push(normalizeRecord({
                id: randomId('row'),
                name: titleCase(name),
                class: className,
                violation: detectViolation(cleanedPart),
                reporter: currentUser.name,
                time: new Date().toISOString()
            }));
        }
        if (output.length >= LIMITS.maxItemsPerOperation) break;
    }
    return output.filter(Boolean);
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function getFilteredRecords() {
    const search = removeAccents(byId('search-input').value.toLowerCase());
    const className = byId('class-filter').value;
    const violation = byId('violation-filter').value;
    
    return records.filter(item =>
        (!search || removeAccents(`${item.name} ${item.reporter}`).toLowerCase().includes(search)) &&
        (!className || item.class === className) &&
        (!violation || item.violation === violation)
    );
}

function updateFilters() {
    const classSelect = byId('class-filter');
    const violationSelect = byId('violation-filter');
    
    const oldClass = classSelect.value;
    const oldViolation = violationSelect.value;
    
    const classes = [...new Set(records.map(item => item.class))].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
    classSelect.replaceChildren(
        new Option('Tất cả lớp', ''),
        ...classes.map(value => new Option(value, value))
    );
    
    const violations = [...new Set(records.map(item => item.violation))].sort((a, b) => a.localeCompare(b, 'vi'));
    violationSelect.replaceChildren(
        new Option('Tất cả vi phạm', ''),
        ...violations.map(value => new Option(value, value))
    );
    
    classSelect.value = oldClass;
    violationSelect.value = oldViolation;
}

function renderReport() {
    if (!joined) return;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderReportNow, 60);
}

function renderReportNow() {
    updateFilters();
    updatePendingBadge();
    const filtered = getFilteredRecords();
    const container = byId('report-container');
    container.replaceChildren();
    byId('count-badge').textContent = String(filtered.length);
    const classes = new Set(filtered.map(item => item.class)).size;
    const types = new Set(filtered.map(item => item.violation)).size;
    byId('stats-summary').textContent = `Hiển thị ${filtered.length}/${records.length} | ${classes} lớp | ${types} loại vi phạm`;
    
    if (!filtered.length) {
        const empty = element('div', 'empty-state');
        empty.append(element('p', '', records.length ? 'Không có kết quả phù hợp' : 'Chưa có vi phạm nào'));
        container.append(empty);
        return;
    }

    // AI Repeat Offender Frequency Analyzer
    const studentCounts = new Map();
    records.forEach(item => {
        const key = `${item.name.toLowerCase()}|${item.class}`;
        studentCounts.set(key, (studentCounts.get(key) || 0) + 1);
    });

    const groups = new Map();
    filtered.forEach(item => {
        if (!groups.has(item.violation)) groups.set(item.violation, []);
        groups.get(item.violation).push(item);
    });

    let number = 1;
    [...groups.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([violation, items]) => {
        const group = element('section', 'violation-group');
        const header = element('div', 'violation-group-header');
        header.append(
            element('div', 'violation-group-title', violation),
            element('span', 'group-count-badge', `${items.length} HS`)
        );
        group.append(header);

        const table = element('table', 'violation-table');
        const thead = element('thead');
        const headRow = element('tr');
        
        [
            '#',
            ...(displaySettings.time ? ['Giờ'] : []),
            ...(displaySettings.name ? ['Họ và Tên'] : []),
            ...(displaySettings.class ? ['Lớp'] : []),
            ...(displaySettings.reporter ? ['Người báo'] : []),
            'Thao tác'
        ].forEach(label => headRow.append(element('th', 'violation-table-th', label)));
        
        thead.append(headRow);
        table.append(thead);
        
        const tbody = element('tbody');
        items.forEach(item => {
            const row = element('tr', 'violation-table-row');
            row.append(element('td', 'td-cell stt-cell', String(number++)));
            if (displaySettings.time) {
                row.append(element('td', 'td-cell time-cell', new Date(item.time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })));
            }
            if (displaySettings.name) {
                const cell = element('td', 'td-cell');
                cell.append(element('span', 'student-name', item.name));

                // AI Repeat Offender Badge
                const repKey = `${item.name.toLowerCase()}|${item.class}`;
                const count = studentCounts.get(repKey) || 1;
                if (count >= 3) {
                    const badge = element('span', 'repeat-badge repeat-badge-danger', `Tái phạm ${count}x`);
                    badge.title = `Cảnh báo: Học sinh này đã vi phạm ${count} lần`;
                    cell.append(badge);
                } else if (count === 2) {
                    const badge = element('span', 'repeat-badge repeat-badge-warn', 'Tái phạm 2x');
                    badge.title = 'Học sinh này đã vi phạm 2 lần';
                    cell.append(badge);
                }

                row.append(cell);
            }
            if (displaySettings.class) {
                const cell = element('td', 'td-cell');
                cell.append(element('span', 'class-badge', item.class));
                row.append(cell);
            }
            if (displaySettings.reporter) {
                row.append(element('td', 'td-cell reporter-cell', item.reporter));
            }

            const actionsCell = element('td', 'td-cell');
            const actions = element('div', 'row-actions');
            
            const edit = element('button', 'action-btn action-btn-edit');
            edit.type = 'button';
            edit.dataset.action = 'edit';
            edit.dataset.id = item.id;
            edit.title = 'Chỉnh sửa';
            edit.append(element('i', 'fa-solid fa-pen'));

            const remove = element('button', 'action-btn action-btn-delete');
            remove.type = 'button';
            remove.dataset.action = 'delete';
            remove.dataset.id = item.id;
            remove.title = 'Xóa';
            remove.append(element('i', 'fa-solid fa-trash'));
            
            actions.append(edit, remove);
            actionsCell.append(actions);
            row.append(actionsCell);
            tbody.append(row);
        });
        
        table.append(tbody);
        group.append(table);
        container.append(group);
    });
}

function openEditModal(id) {
    const item = records.find(record => record.id === id);
    if (!item) return;
    byId('edit-id').value = item.id;
    byId('edit-name').value = item.name;
    byId('edit-class').value = item.class;
    byId('edit-violation').value = item.violation;
    byId('edit-modal').classList.remove('d-none');
}

function closeEditModal() {
    byId('edit-modal').classList.add('d-none');
}

function saveEdit() {
    const id = byId('edit-id').value;
    const name = cleanText(byId('edit-name').value, 100);
    const className = validClass(byId('edit-class').value);
    const violation = cleanText(byId('edit-violation').value, 120);
    if (!name || !className || !violation) {
        return showToast('Dữ liệu không hợp lệ', 'Tên, lớp dạng 10A1-12Z99 và vi phạm là bắt buộc.', 'error');
    }
    sendOperation('UPDATE', { id, data: { name, class: className, violation: detectViolation(violation) } });
    closeEditModal();
}

function updateUserListUI() {
    const list = byId('user-list-ul');
    if (!list) return;
    list.replaceChildren();
    byId('user-count-badge').textContent = String(connections.size);
    if (!connections.size) {
        list.append(element('li', 'user-list-empty', 'Chưa có máy nào kết nối...'));
        return;
    }
    for (const [clientId, connection] of connections.entries()) {
        const item = element('li', 'user-list-item');
        const identity = element('div');
        identity.append(
            element('strong', '', connection.metadata.name || 'Không tên'),
            element('small', '', ` (${connection.metadata.role || '?'})`)
        );

        const statusWrap = element('div', 'user-item-status');
        if (hostDataChannels.has(clientId)) {
            const p2pDot = element('span', 'transport-badge transport-p2p', 'P2P');
            statusWrap.append(p2pDot);
        }
        statusWrap.append(element('span', 'status-dot online'));

        item.append(identity, statusWrap);
        list.append(item);
    }
}

function loadLibrary(globalName, src) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.crossOrigin = 'anonymous';
        script.onload = () => window[globalName] ? resolve(window[globalName]) : reject(new Error(`Thiếu global ${globalName}`));
        script.onerror = () => reject(new Error(`Không tải được ${globalName}`));
        document.head.append(script);
    });
}

async function getXlsx() {
    return window.XLSX || loadLibrary('XLSX', 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function exportExcel(template = false) {
    try {
        const XLSX = await getXlsx();
        const rows = template
            ? [['Họ Tên', 'Lớp', 'Lỗi Vi Phạm', 'Người báo'], ['Nguyễn Văn A', '12A1', 'Đi học muộn', 'Tên người trực']]
            : [['STT', 'Thời gian', 'Họ Tên', 'Lớp', 'Lỗi Vi Phạm', 'Người báo'], ...records.map((item, index) => [
                index + 1,
                new Date(item.time).toLocaleString('vi-VN'),
                item.name,
                item.class,
                item.violation,
                item.reporter
            ])];
        
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), template ? 'MauNhap' : 'DanhSachViPham');
        XLSX.writeFile(workbook, template ? 'MauNhapViPham.xlsx' : `DanhSachViPham_${room?.id || 'offline'}.xlsx`);
    } catch (error) {
        showToast('Lỗi Excel', error.message, 'error');
    }
}

/* =========================================================
   5. SMAS / VNEDU EXPORT & CLOUD BACKUP (0 VNĐ)
   ========================================================= */

async function exportSmasExcel() {
    try {
        const XLSX = await getXlsx();
        const rows = [
            ['STT', 'Lớp', 'Họ và tên', 'Nội dung vi phạm', 'Thời gian vi phạm', 'Người ghi nhận', 'Hình thức nhắc nhở / Xử lý'],
            ...records.map((item, index) => [
                index + 1,
                item.class,
                item.name,
                item.violation,
                new Date(item.time).toLocaleString('vi-VN'),
                item.reporter,
                'Nhắc nhở nề nếp'
            ])
        ];
        
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'SoTheoDoiViPham');
        XLSX.writeFile(workbook, `SoTheoDoiViPham_VnEdu_SMAS_${room?.id || 'offline'}.xlsx`);
        showToast('Xuất SMAS/VnEdu thành công', 'File Excel tương thích phần mềm quản lý nhà trường đã được tạo.', 'success');
    } catch (error) {
        showToast('Lỗi xuất SMAS', error.message, 'error');
    }
}

function downloadTimestampedBackup() {
    const roomId = room?.id || 'offline';
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    const backup = { format: 'giamthi-backup', version: 5, exportedAt: now.toISOString(), roomId, records };
    downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), `giamthi-backup-${roomId}-${timestamp}.json`);
    showToast('Tải sao lưu thành công', 'Bản sao lưu kèm dấu thời gian đã được lưu vào máy.', 'success');
}

function checkAutoBackup() {
    const now = Date.now();
    const interval = CONFIG.backup?.autoBackupIntervalMs || 900000;
    const threshold = CONFIG.backup?.autoBackupThreshold || 20;

    if (now - lastAutoBackupTime > interval || unbackedOperationsCount >= threshold) {
        lastAutoBackupTime = now;
        unbackedOperationsCount = 0;
        
        snapshots.push({ createdAt: new Date().toISOString(), records });
        snapshots = snapshots.slice(-5);
        idbSet('meta', { key: roomKey('snapshots'), value: snapshots });

        const timeStr = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        byId('auto-backup-badge').textContent = `Auto-Backup: ${timeStr}`;
    }
}

async function uploadToGoogleDrive() {
    const clientId = cleanText(byId('gdrive-client-id').value, 200);
    if (!clientId) {
        return showToast('Google Client ID', 'Vui lòng nhập Client ID của bạn để sao lưu trực tiếp vào Drive, hoặc bấm "Tải Bản Sao Lưu" bên dưới (0 VNĐ).', 'info', 7000);
    }

    try {
        // Load GIS client
        await loadLibrary('google', 'https://accounts.google.com/gsi/client');
        if (!window.google?.accounts?.oauth2) {
            throw new Error('Google Identity Services chưa sẵn sàng');
        }

        const tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: 'https://www.googleapis.com/auth/drive.file',
            callback: async response => {
                if (response.error) {
                    return showToast('Lỗi đăng nhập Google', response.error, 'error');
                }

                showToast('Đang tải lên Drive', 'Đang gửi file sao lưu lên Google Drive...', 'info');

                const roomId = room?.id || 'offline';
                const backupData = JSON.stringify({
                    format: 'giamthi-backup',
                    version: 5,
                    exportedAt: new Date().toISOString(),
                    roomId,
                    records
                }, null, 2);

                const metadata = {
                    name: `GiamThi_Backup_${roomId}_${new Date().toISOString().slice(0, 10)}.json`,
                    mimeType: 'application/json'
                };

                const form = new FormData();
                form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
                form.append('file', new Blob([backupData], { type: 'application/json' }));

                const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${response.access_token}` },
                    body: form
                });

                if (res.ok) {
                    showToast('Đã lưu lên Google Drive', 'File sao lưu đã được tải trực tiếp lên Google Drive cá nhân của bạn.', 'success');
                    byId('gdrive-modal').classList.add('d-none');
                } else {
                    const err = await res.json();
                    showToast('Lỗi Drive API', err.error?.message || 'Không thể lưu lên Google Drive', 'error');
                }
            }
        });

        tokenClient.requestAccessToken();

    } catch (err) {
        showToast('Lỗi Google Drive', err.message, 'error');
    }
}

/* =========================================================
   6. EXCEL IMPORT & BACKUP
   ========================================================= */

function normalizeHeader(value) {
    return removeAccents(cleanText(value, 80).toLowerCase()).replace(/[^a-z0-9]/g, '');
}

async function importExcel(file) {
    if (!file || file.size > LIMITS.maxExcelBytes) {
        return showToast('File không hợp lệ', `Excel tối đa ${Math.round(LIMITS.maxExcelBytes / 1048576)} MB.`, 'error');
    }
    
    try {
        const XLSX = await getXlsx();
        const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '', raw: false });
        
        if (!rows.length || rows.length > LIMITS.maxRecords + 20) {
            throw new Error('File rỗng hoặc quá nhiều dòng');
        }
        
        const aliases = {
            name: ['hoten', 'hovaten', 'tenhocsinh', 'name'],
            class: ['lop', 'class'],
            violation: ['loivipham', 'vipham', 'loi', 'violation'],
            reporter: ['nguoibao', 'nguoitruc', 'reporter'],
            time: ['thoigian', 'ngaygio', 'time']
        };
        
        let headerRow = -1;
        let indexes = {};
        
        for (let rowIndex = 0; rowIndex < Math.min(rows.length, 10); rowIndex++) {
            const normalized = rows[rowIndex].map(normalizeHeader);
            const candidate = {};
            for (const [field, names] of Object.entries(aliases)) {
                candidate[field] = normalized.findIndex(header => names.includes(header));
            }
            if (candidate.name >= 0 && candidate.class >= 0 && candidate.violation >= 0) {
                headerRow = rowIndex;
                indexes = candidate;
                break;
            }
        }
        
        if (headerRow < 0) throw new Error('Không tìm thấy header Họ tên, Lớp, Lỗi vi phạm');
        
        const items = rows.slice(headerRow + 1, headerRow + 1 + LIMITS.maxItemsPerOperation)
            .map(row => normalizeRecord({
                id: randomId('row'),
                name: row[indexes.name],
                class: row[indexes.class],
                violation: detectViolation(row[indexes.violation]),
                reporter: indexes.reporter >= 0 ? row[indexes.reporter] : currentUser.name,
                time: indexes.time >= 0 ? row[indexes.time] : new Date().toISOString()
            }))
            .filter(Boolean);
            
        if (!items.length) throw new Error('Không có dòng hợp lệ');
        
        sendOperation('ADD', { items });
        showToast('Import thành công', `Đã nhập ${items.length} dòng hợp lệ.`, 'success');
    } catch (error) {
        showToast('Lỗi import Excel', error.message, 'error');
    }
}

async function importRoster(file) {
    if (!file) return;
    try {
        const XLSX = await getXlsx();
        const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '', raw: false });

        if (!rows.length) throw new Error('File rỗng');

        let headerRow = -1;
        let colClass = -1;
        let colName = -1;
        let colCode = -1;

        for (let i = 0; i < Math.min(rows.length, 10); i++) {
            const headers = rows[i].map(normalizeHeader);
            const classIdx = headers.findIndex(h => ['lop', 'class'].includes(h));
            const nameIdx = headers.findIndex(h => ['hoten', 'hovaten', 'tenhocsinh', 'name'].includes(h));
            const codeIdx = headers.findIndex(h => ['mahs', 'mahocsinh', 'code', 'stt'].includes(h));

            if (classIdx >= 0 && nameIdx >= 0) {
                headerRow = i;
                colClass = classIdx;
                colName = nameIdx;
                colCode = codeIdx;
                break;
            }
        }

        if (headerRow < 0) throw new Error('Cần có cột "Lớp" và "Họ và tên"');

        const newStudents = [];
        for (let i = headerRow + 1; i < rows.length; i++) {
            const row = rows[i];
            const cls = validClass(row[colClass]);
            const name = titleCase(cleanText(row[colName], 100));
            const code = colCode >= 0 ? cleanText(row[colCode], 30) : '';

            if (cls && name) {
                newStudents.push({
                    id: randomId('stu'),
                    class: cls,
                    name,
                    cleanName: removeAccents(name.toLowerCase()),
                    code
                });
            }
            if (newStudents.length >= LIMITS.maxRosterStudents) break;
        }

        if (!newStudents.length) throw new Error('Không có dòng học sinh hợp lệ');

        await idbClear('roster');
        await idbBulkSet('roster', newStudents);
        await loadRoster();

        showToast('Nạp danh sách thành công', `Đã lưu ${newStudents.length} học sinh vào AI Roster cục bộ.`, 'success');
    } catch (err) {
        showToast('Lỗi nạp danh sách', err.message, 'error');
    }
}

function backupJson() {
    const roomId = room?.id || 'offline';
    const backup = { format: 'giamthi-backup', version: 5, exportedAt: new Date().toISOString(), roomId, records };
    downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), `giamthi-backup-${roomId}.json`);
}

async function restoreJson(file) {
    if (!isHost) return showToast('Không đủ quyền', 'Chỉ Host được phục hồi backup.', 'error');
    if (!file || file.size > LIMITS.maxJsonBytes) return showToast('File không hợp lệ', 'Backup JSON quá lớn.', 'error');
    
    try {
        const backup = JSON.parse(await file.text());
        if (backup.format !== 'giamthi-backup' || (backup.version !== 4 && backup.version !== 5) || !Array.isArray(backup.records)) {
            throw new Error('Sai định dạng backup');
        }
        
        const restored = dedupeAndLimit(backup.records);
        if (!restored.length && backup.records.length) throw new Error('Không có bản ghi hợp lệ');
        
        snapshots.push({ createdAt: new Date().toISOString(), records });
        snapshots = snapshots.slice(-3);
        records = restored;
        
        saveHostState();
        renderReport();
        byId('undo-clear-btn').classList.remove('d-none');
        sendSync();
        showToast('Đã phục hồi', `${records.length} bản ghi từ backup.`, 'success');
    } catch (error) {
        showToast('Không thể phục hồi', error.message, 'error');
    }
}

async function runOcr(file) {
    if (!file || !file.type.startsWith('image/') || file.size > LIMITS.maxImageBytes) {
        return showToast('Ảnh không hợp lệ', 'Chỉ nhận ảnh tối đa 10 MB.', 'error');
    }
    
    const loading = byId('ocr-loading');
    loading.classList.remove('d-none');
    
    try {
        const Tesseract = await loadLibrary('Tesseract', 'https://unpkg.com/tesseract.js@v2.1.0/dist/tesseract.min.js');
        const worker = Tesseract.createWorker({
            logger: event => {
                if (event.status === 'recognizing text') {
                    const percent = Math.round(event.progress * 100);
                    byId('ocr-percent').textContent = `${percent}%`;
                    byId('ocr-progress').style.width = `${percent}%`;
                }
            }
        });
        
        await worker.load();
        await worker.loadLanguage('vie+eng');
        await worker.initialize('vie');
        const result = await worker.recognize(file);
        await worker.terminate();
        
        byId('text-input').value = `${byId('text-input').value}${byId('text-input').value ? '\n' : ''}${result.data.text.trim()}`.slice(0, 30000);
    } catch (error) {
        showToast('OCR thất bại', error.message, 'error');
    } finally {
        loading.classList.add('d-none');
    }
}

function buildExportTable(items, startStt, isCompact = false) {
    const table = document.createElement('table');
    table.className = 'export-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');

    const headers = [
        { text: 'STT', width: '42px' },
        { text: 'Giờ', width: '70px' },
        { text: 'Họ và Tên', width: isCompact ? '180px' : '240px' },
        { text: 'Lớp', width: '65px' },
        { text: 'Lỗi vi phạm', width: '' },
        { text: 'Người báo', width: isCompact ? '110px' : '140px' }
    ];

    headers.forEach(h => {
        const th = document.createElement('th');
        th.textContent = h.text;
        if (h.width) th.style.width = h.width;
        headRow.append(th);
    });
    thead.append(headRow);
    table.append(thead);

    const tbody = document.createElement('tbody');
    items.forEach((item, index) => {
        const row = document.createElement('tr');

        const stt = document.createElement('td');
        stt.className = 'text-center';
        stt.textContent = String(startStt + index);

        const time = document.createElement('td');
        time.className = 'text-center';
        time.textContent = new Date(item.time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

        const name = document.createElement('td');
        name.textContent = item.name;

        const cls = document.createElement('td');
        cls.className = 'text-center';
        cls.textContent = item.class;

        const violation = document.createElement('td');
        violation.textContent = item.violation;

        const reporter = document.createElement('td');
        reporter.textContent = item.reporter;

        row.append(stt, time, name, cls, violation, reporter);
        tbody.append(row);
    });

    table.append(tbody);
    return table;
}

async function exportPng(format = 'landscape') {
    const filtered = getFilteredRecords();
    if (!filtered.length) return showToast('Chưa có dữ liệu', 'Không có nội dung để xuất.', 'error');

    byId('png-export-modal')?.classList.add('d-none');
    showToast('Đang tạo ảnh...', 'Đang render bảng vi phạm độ phân giải cao.', 'info', 3000);

    try {
        const html2canvas = window.html2canvas || await loadLibrary('html2canvas', 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
        const exportTemplate = byId('export-template');
        const container = byId('export-tables-container');
        const pageInfo = byId('export-page-info');

        const now = new Date();
        byId('export-time').textContent = `Lâm Đồng, ngày ${String(now.getDate()).padStart(2, '0')} tháng ${String(now.getMonth() + 1).padStart(2, '0')} năm ${now.getFullYear()}`;

        // Ensure logo uses Base64 Data URI to prevent canvas tainting (especially under file:// or offline)
        const logo = exportTemplate.querySelector('.export-logo');
        if (logo && window.APP_LOGO_DATA_URL) {
            if (logo.src !== window.APP_LOGO_DATA_URL) {
                logo.src = window.APP_LOGO_DATA_URL;
            }
            if (logo.decode) {
                try {
                    await logo.decode();
                } catch (_) {}
            }
        } else if (logo && !logo.complete) {
            await new Promise(resolve => {
                const timer = setTimeout(resolve, 800);
                logo.onload = () => { clearTimeout(timer); resolve(); };
                logo.onerror = () => { clearTimeout(timer); resolve(); };
            });
        }

        async function renderToUrl() {
            exportTemplate.classList.add('export-active');
            let canvas;
            const h2cOptions = {
                backgroundColor: '#ffffff',
                scale: 2,
                useCORS: true,
                allowTaint: false,
                logging: false,
                scrollX: 0,
                scrollY: 0,
                x: 0,
                y: 0,
                width: exportTemplate.offsetWidth,
                height: exportTemplate.offsetHeight,
                windowWidth: Math.max(document.documentElement.scrollWidth, exportTemplate.scrollWidth, 1400),
                windowHeight: Math.max(document.documentElement.scrollHeight, exportTemplate.scrollHeight, 2000)
            };

            try {
                canvas = await html2canvas(exportTemplate, h2cOptions);
                canvas.toDataURL('image/png');
            } catch (renderError) {
                // If anything fails (e.g. image taint), fallback by ignoring images
                canvas = await html2canvas(exportTemplate, {
                    ...h2cOptions,
                    ignoreElements: el => el.classList?.contains('export-logo') || el.tagName === 'IMG'
                });
            }
            exportTemplate.classList.remove('export-active');

            let blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            let url = null;
            if (!blob) {
                // Fallback if toBlob returned null
                try {
                    const dataUrl = canvas.toDataURL('image/png');
                    const res = await fetch(dataUrl);
                    blob = await res.blob();
                    url = URL.createObjectURL(blob);
                } catch (_) {
                    url = canvas.toDataURL('image/png');
                }
            } else {
                url = URL.createObjectURL(blob);
            }
            return { blob, url };
        }

        function showMultiDownloadModal(images) {
            const listContainer = byId('multi-download-list');
            if (!listContainer) return;
            
            listContainer.innerHTML = '';
            byId('multi-download-count').textContent = images.length;
            
            images.forEach(img => {
                const btn = document.createElement('button');
                btn.className = 'btn btn-primary btn-full';
                btn.innerHTML = `<i class="fa-solid fa-download"></i> ${img.label}`;
                btn.onclick = () => {
                    const a = document.createElement('a');
                    a.href = img.url;
                    a.download = img.filename;
                    document.body.append(a);
                    a.click();
                    a.remove();
                };
                listContainer.appendChild(btn);
            });
            
            byId('multi-download-modal').classList.remove('d-none');
            showToast('Tạo ảnh hoàn tất', `Đã tạo ${images.length} trang ảnh. Hãy bấm vào từng nút để tải về máy!`, 'success', 6000);
        }

        if (format === 'landscape') {
            exportTemplate.classList.add('export-landscape');
            const rowsSelect = byId('png-rows-per-page');
            const rowsPerCol = rowsSelect ? parseInt(rowsSelect.value, 10) || 10 : 10;
            const pageSize = rowsPerCol * 2; // Ví dụ: 10 dòng/cột x 2 cột = 20 HS/trang (chuẩn khổ ngang 16:9)
            const totalPages = Math.ceil(filtered.length / pageSize);

            if (totalPages <= 1) {
                // Toàn bộ học sinh vừa vặn trong 1 trang ngang duy nhất
                pageInfo.classList.add('d-none');
                container.replaceChildren();

                if (filtered.length <= 10) {
                    container.className = 'export-tables-container';
                    container.append(buildExportTable(filtered, 1, false));
                } else {
                    container.className = 'export-tables-container two-columns';
                    const mid = Math.ceil(filtered.length / 2);
                    const leftSlice = filtered.slice(0, mid);
                    const rightSlice = filtered.slice(mid);

                    const col1 = document.createElement('div');
                    col1.className = 'export-table-col';
                    col1.append(buildExportTable(leftSlice, 1, true));

                    const col2 = document.createElement('div');
                    col2.className = 'export-table-col';
                    col2.append(buildExportTable(rightSlice, mid + 1, true));

                    container.append(col1, col2);
                }

                const res = await renderToUrl();
                const filename = `DanhSachViPham_Ngang_Zalo_${room?.id || 'offline'}.png`;
                if (res.blob) {
                    downloadBlob(res.blob, filename);
                    try {
                        if (navigator.clipboard && window.ClipboardItem) {
                            await navigator.clipboard.write([new ClipboardItem({ 'image/png': res.blob })]);
                        }
                    } catch (_) {}
                } else {
                    const a = document.createElement('a');
                    a.href = res.url;
                    a.download = filename;
                    document.body.append(a);
                    a.click();
                    a.remove();
                }
                showToast('Xuất ảnh thành công', 'Đã tải bản PNG ngang 2 cột và lưu tạm vào Clipboard! Bạn có thể dán (Ctrl+V) trực tiếp vào Zalo/Messenger.', 'success', 5000);
            } else {
                // Danh sách dài: Cứ đúng rowsPerCol dòng mỗi cột
                pageInfo.classList.remove('d-none');
                container.className = 'export-tables-container two-columns';
                
                let generatedImages = [];

                for (let p = 0; p < totalPages; p++) {
                    const startIdx = p * pageSize;
                    const endIdx = Math.min(startIdx + pageSize, filtered.length);
                    const pageSlice = filtered.slice(startIdx, endIdx);

                    pageInfo.textContent = `(Trang ${p + 1}/${totalPages})`;
                    container.replaceChildren();

                    const startStt = startIdx + 1;
                    const mid = Math.ceil(pageSlice.length / 2);
                    const leftSlice = pageSlice.slice(0, mid);
                    const rightSlice = pageSlice.slice(mid);

                    const col1 = document.createElement('div');
                    col1.className = 'export-table-col';
                    col1.append(buildExportTable(leftSlice, startStt, true));

                    const col2 = document.createElement('div');
                    col2.className = 'export-table-col';
                    col2.append(buildExportTable(rightSlice, startStt + mid, true));

                    container.append(col1, col2);

                    const res = await renderToUrl();
                    generatedImages.push({
                        filename: `DanhSachViPham_Ngang_Zalo_Trang_${p + 1}_cua_${totalPages}_${room?.id || 'offline'}.png`,
                        url: res.url,
                        label: `Tải Trang ${p + 1} (Ngang Zalo)`
                    });
                }
                
                showMultiDownloadModal(generatedImages);
            }

        } else if (format === 'paginated') {
            exportTemplate.classList.remove('export-landscape');
            container.className = 'export-tables-container';
            pageInfo.classList.remove('d-none');

            const pageSize = 35;
            const totalPages = Math.ceil(filtered.length / pageSize);
            let generatedImages = [];

            for (let p = 0; p < totalPages; p++) {
                const pageSlice = filtered.slice(p * pageSize, (p + 1) * pageSize);
                pageInfo.textContent = `(Trang ${p + 1}/${totalPages})`;
                container.replaceChildren(buildExportTable(pageSlice, p * pageSize + 1, false));

                const res = await renderToUrl();
                generatedImages.push({
                    filename: `DanhSachViPham_Trang_${p + 1}_cua_${totalPages}_${room?.id || 'offline'}.png`,
                    url: res.url,
                    label: `Tải Trang ${p + 1} (A4)`
                });
            }
            
            if (totalPages > 1) {
                showMultiDownloadModal(generatedImages);
            } else {
                const a = document.createElement('a');
                a.href = generatedImages[0].url;
                a.download = generatedImages[0].filename;
                document.body.append(a);
                a.click();
                a.remove();
                showToast('Xuất ảnh thành công', 'Đã tải ảnh chuẩn A4.', 'success');
            }

        } else {
            // Vertical continuous
            exportTemplate.classList.remove('export-landscape');
            container.className = 'export-tables-container';
            pageInfo.classList.add('d-none');
            container.replaceChildren(buildExportTable(filtered, 1, false));

            const res = await renderToUrl();
            const filename = `DanhSachViPham_Doc_${room?.id || 'offline'}.png`;
            if (res.blob) {
                downloadBlob(res.blob, filename);
            } else {
                const a = document.createElement('a');
                a.href = res.url;
                a.download = filename;
                document.body.append(a);
                a.click();
                a.remove();
            }
            showToast('Xuất ảnh thành công', 'Đã tải về bảng danh sách vi phạm dọc liên tục.', 'success');
        }

    } catch (error) {
        showToast('Xuất PNG thất bại', error.message, 'error');
        byId('export-template')?.classList.remove('export-active');
    }
}

async function logout() {
    if (!confirm('Thoát phiên hiện tại? Dữ liệu Host vẫn được lưu an toàn trong IndexedDB trên trình duyệt này.')) return;
    mqttClient?.end(true);
    clientPeerConnection?.close();
    hostPeerConnections.forEach(pc => pc.close());
    clearInterval(heartbeatTimer);
    clearInterval(staleTimer);
    const sKey = roomKey(isHost ? 'session-host' : 'session-client');
    localStorage.removeItem(sKey);
    await idbDelete('meta', sKey);
    if (!isHost) {
        localStorage.removeItem(`${STORAGE_PREFIX}:last-client`);
        await idbDelete('meta', `${STORAGE_PREFIX}:last-client`);
    }
    location.reload();
}

async function resumeLastHost() {
    const roomId = localStorage.getItem(`${STORAGE_PREFIX}:last-host`);
    let session = roomId ? await idbGet('meta', `${STORAGE_PREFIX}:recovery-host:${roomId}`) : null;
    if (!session) {
        session = roomId ? loadJson(`${STORAGE_PREFIX}:recovery-host:${roomId}`, null) : null;
    }
    if (!session?.room || !session?.user) return showToast('Không thể khôi phục', 'Không tìm thấy thông tin phòng Host.', 'error');
    if (!session.room.invite && session.room.secret) session.room.invite = createLegacyInvite(session.room);
    room = session.room; currentUser = session.user; isHost = true;
    saveJson(roomKey('session-host'), session);
    await setupCrypto();
    connectMQTT();
}

/* =========================================================
   7. EVENT LISTENERS & SETUP
   ========================================================= */

document.querySelectorAll('[data-tab]').forEach(button => {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
});

byId('btn-create-room').addEventListener('click', () => {
    createRoom().catch(error => showToast('Không thể tạo phòng', error.message, 'error'));
});

byId('resume-host-btn').addEventListener('click', () => {
    resumeLastHost().catch(error => showToast('Không thể khôi phục', error.message, 'error'));
});

byId('btn-join-room').addEventListener('click', () => {
    joinRoom().catch(error => showToast('Không thể kết nối', error.message, 'error'));
});

byId('join-role').addEventListener('change', togglePasswordInput);

byId('join-pin').addEventListener('input', event => {
    if (event.target.value.trim().toUpperCase().startsWith('GT4.')) return;
    event.target.value = normalizeRoomCode(event.target.value).slice(0, 12).replace(/(.{4})(?=.)/g, '$1-');
});

byId('btn-logout').addEventListener('click', logout);

byId('pin-container').addEventListener('click', () => {
    if (!room?.invite) return;
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(room.invite)
            .then(() => showToast('Đã sao chép', 'Mã phòng đã được sao chép.', 'success'))
            .catch(() => fallbackCopy(room.invite));
    } else {
        fallbackCopy(room.invite);
    }
});

function fallbackCopy(text) {
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.append(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
        showToast('Đã sao chép', 'Mã phòng đã được sao chép.', 'success');
    } catch (err) {
        showToast('Không thể sao chép', 'Trình duyệt chặn clipboard.', 'error');
    }
}

byId('toast-close-btn').addEventListener('click', () => {
    byId('toast').classList.remove('show');
});

byId('toggle-user-list-btn').addEventListener('click', () => {
    byId('user-list-popover').classList.toggle('d-none');
});

byId('toggle-display-btn').addEventListener('click', () => {
    byId('display-menu').classList.toggle('d-none');
});

byId('cancel-edit-btn').addEventListener('click', closeEditModal);
byId('save-edit-btn').addEventListener('click', saveEdit);

byId('edit-modal').addEventListener('click', event => {
    if (event.target === byId('edit-modal')) {
        closeEditModal();
    }
});

document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
        closeEditModal();
        byId('roster-modal')?.classList.add('d-none');
        byId('gdrive-modal')?.classList.add('d-none');
        byId('png-export-modal')?.classList.add('d-none');
    }
});

['edit-name', 'edit-class', 'edit-violation'].forEach(id => {
    byId(id)?.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            saveEdit();
        }
    });
});

byId('clear-all-btn').addEventListener('click', clearAll);
byId('undo-clear-btn').addEventListener('click', undoClear);

byId('report-container').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    
    if (button.dataset.action === 'edit') {
        openEditModal(button.dataset.id);
    }
    
    if (button.dataset.action === 'delete' && confirm('Xóa vi phạm này?')) {
        sendOperation('REMOVE', { id: button.dataset.id });
    }
});

['time', 'name', 'class', 'reporter'].forEach(key => {
    byId(`show-${key}`).addEventListener('change', event => {
        displaySettings[key] = event.target.checked;
        saveJson(DISPLAY_KEY, displaySettings);
        renderReport();
    });
});

['search-input', 'class-filter', 'violation-filter'].forEach(id => {
    byId(id).addEventListener(id === 'search-input' ? 'input' : 'change', renderReport);
});

byId('process-btn').addEventListener('click', () => {
    const input = byId('text-input');
    if (input.value.length > 30000) {
        return showToast('Dữ liệu quá dài', 'Ô nhập tối đa 30.000 ký tự.', 'error');
    }
    const items = smartParse(input.value);
    if (!items.length) {
        return showToast('Không nhận dạng được', 'Mỗi dòng cần lớp hợp lệ, tên và vi phạm.', 'warning');
    }
    sendOperation('ADD', { items });
    input.value = '';
    byId('ai-autocomplete-bar')?.classList.add('d-none');
});

byId('text-input').addEventListener('input', handleTextareaAutocomplete);

byId('text-input').addEventListener('keydown', event => {
    if (byId('enter-to-send').checked && event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        byId('process-btn').click();
    }
});

byId('excel-input').addEventListener('change', event => {
    importExcel(event.target.files[0]);
    event.target.value = '';
});

byId('template-excel-btn').addEventListener('click', () => exportExcel(true));
byId('export-excel-btn').addEventListener('click', () => exportExcel(false));
byId('export-png-btn').addEventListener('click', () => {
    byId('png-export-modal').classList.remove('d-none');
});
byId('btn-opt-landscape').addEventListener('click', () => exportPng('landscape'));
byId('btn-opt-paginated').addEventListener('click', () => exportPng('paginated'));
byId('btn-opt-vertical').addEventListener('click', () => exportPng('vertical'));
byId('btn-close-png-modal').addEventListener('click', () => byId('png-export-modal').classList.add('d-none'));
byId('png-export-modal').addEventListener('click', event => {
    if (event.target === byId('png-export-modal')) {
        byId('png-export-modal').classList.add('d-none');
    }
});
byId('btn-close-multi-download')?.addEventListener('click', () => byId('multi-download-modal').classList.add('d-none'));
byId('multi-download-modal')?.addEventListener('click', event => {
    if (event.target === byId('multi-download-modal')) {
        byId('multi-download-modal').classList.add('d-none');
    }
});
byId('export-smas-btn').addEventListener('click', exportSmasExcel);

byId('backup-json-btn').addEventListener('click', backupJson);

byId('restore-json-input').addEventListener('change', event => {
    restoreJson(event.target.files[0]);
    event.target.value = '';
});

byId('ocr-input').addEventListener('change', event => {
    runOcr(event.target.files[0]);
    event.target.value = '';
});

// Drop zones
const dropZone = byId('excel-drop-zone');
dropZone.addEventListener('dragover', event => {
    event.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', event => {
    event.preventDefault();
    dropZone.classList.remove('drag-over');
    importExcel(event.dataTransfer.files[0]);
});

// Roster Modal & Drop Zone
function openRosterModal() {
    byId('roster-modal').classList.remove('d-none');
    updateRosterStatsUI();
}

byId('btn-open-roster').addEventListener('click', openRosterModal);
byId('ai-status-chip')?.addEventListener('click', openRosterModal);

byId('btn-close-roster').addEventListener('click', () => {
    byId('roster-modal').classList.add('d-none');
});

byId('roster-modal').addEventListener('click', event => {
    if (event.target === byId('roster-modal')) {
        byId('roster-modal').classList.add('d-none');
    }
});

byId('roster-file-input').addEventListener('change', event => {
    importRoster(event.target.files[0]);
    event.target.value = '';
});

const rosterDropZone = byId('roster-drop-zone');
rosterDropZone.addEventListener('dragover', event => {
    event.preventDefault();
    rosterDropZone.classList.add('drag-over');
});

rosterDropZone.addEventListener('dragleave', () => {
    rosterDropZone.classList.remove('drag-over');
});

rosterDropZone.addEventListener('drop', event => {
    event.preventDefault();
    rosterDropZone.classList.remove('drag-over');
    importRoster(event.dataTransfer.files[0]);
});

byId('btn-clear-roster').addEventListener('click', async () => {
    if (!confirm('Xóa toàn bộ danh sách học sinh AI đã nạp?')) return;
    await idbClear('roster');
    schoolRoster = [];
    updateRosterStatsUI();
    showToast('Đã xóa danh sách', 'Dữ liệu học sinh đã được dọn sạch.', 'info');
});

byId('btn-download-roster-template').addEventListener('click', async () => {
    try {
        const XLSX = await getXlsx();
        const rows = [
            ['STT', 'Lớp', 'Họ và tên', 'Mã học sinh'],
            [1, '12A1', 'Nguyễn Văn An', 'HS12001'],
            [2, '12A1', 'Trần Thị Bình', 'HS12002'],
            [3, '11B2', 'Lê Hoàng Cúc', 'HS11015']
        ];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'DanhSachMau');
        XLSX.writeFile(wb, 'MauDanhSachHocSinh_AI.xlsx');
    } catch (e) {
        showToast('Lỗi tạo mẫu', e.message, 'error');
    }
});

// Google Drive Modal
byId('btn-open-gdrive').addEventListener('click', () => {
    byId('gdrive-modal').classList.remove('d-none');
});

byId('btn-close-gdrive').addEventListener('click', () => {
    byId('gdrive-modal').classList.add('d-none');
});

byId('gdrive-modal').addEventListener('click', event => {
    if (event.target === byId('gdrive-modal')) {
        byId('gdrive-modal').classList.add('d-none');
    }
});

byId('btn-gdrive-auth-upload').addEventListener('click', uploadToGoogleDrive);
byId('btn-instant-cloud-json').addEventListener('click', downloadTimestampedBackup);

// Popover global click
document.addEventListener('click', event => {
    if (!byId('display-menu').contains(event.target) && !byId('toggle-display-btn').contains(event.target)) {
        byId('display-menu').classList.add('d-none');
    }
    if (!byId('user-list-popover').contains(event.target) && !byId('toggle-user-list-btn').contains(event.target)) {
        byId('user-list-popover').classList.add('d-none');
    }
});

// Speech Recognition (Voice-to-Text)
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.lang = 'vi-VN';
    
    byId('mic-btn').addEventListener('click', () => {
        try {
            recognition.start();
        } catch (e) {
            // Already started
        }
    });
    
    recognition.onstart = () => {
        byId('mic-btn').classList.add('recording');
        byId('mic-btn').querySelector('.mic-pulse')?.classList.add('active');
    };
    
    recognition.onend = () => {
        byId('mic-btn').classList.remove('recording');
        byId('mic-btn').querySelector('.mic-pulse')?.classList.remove('active');
    };
    
    recognition.onresult = event => {
        const value = cleanText(event.results[0][0].transcript, 500);
        byId('text-input').value = `${byId('text-input').value}${byId('text-input').value ? '\n' : ''}${value}`.slice(0, 30000);
        byId('text-input').dispatchEvent(new Event('input'));
    };
    
    recognition.onerror = () => {
        byId('mic-btn').classList.remove('recording');
        byId('mic-btn').querySelector('.mic-pulse')?.classList.remove('active');
        showToast('Lỗi micro', 'Không thể nhận giọng nói hoặc chưa cấp quyền.', 'error');
    };
} else {
    byId('mic-btn').classList.add('d-none');
}

// Clock
setInterval(() => {
    byId('realtime-clock').textContent = new Date().toLocaleTimeString('vi-VN', { hour12: false });
}, 1000);

window.addEventListener('beforeunload', event => {
    if (isHost && connections.size) {
        event.preventDefault();
        event.returnValue = '';
    }
});

// PWA Service Worker & Install Prompt
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(reg => {
            reg.onupdatefound = () => {
                const installing = reg.installing;
                if (installing) {
                    installing.onstatechange = () => {
                        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                            showToast('Bản cập nhật mới', 'Trợ Lý Giám Thị đã được cập nhật phiên bản mới.', 'info');
                        }
                    };
                }
            };
        }).catch(err => console.warn('[PWA Service Worker]', err));
    });
}

window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    byId('pwa-install-btn-login')?.classList.remove('d-none');
    byId('pwa-install-btn-header')?.classList.remove('d-none');
});

function handlePwaInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(choiceResult => {
        if (choiceResult.outcome === 'accepted') {
            showToast('Đã cài đặt ứng dụng', 'Cảm ơn bạn đã cài đặt Trợ Lý Giám Thị PWA.', 'success');
        }
        deferredPrompt = null;
        byId('pwa-install-btn-login')?.classList.add('d-none');
        byId('pwa-install-btn-header')?.classList.add('d-none');
    });
}

byId('pwa-install-btn-login')?.addEventListener('click', handlePwaInstall);
byId('pwa-install-btn-header')?.addEventListener('click', handlePwaInstall);

window.addEventListener('online', () => {
    byId('offline-banner')?.classList.add('d-none');
    showToast('Đã có mạng trở lại', 'Hệ thống tự động tái đồng bộ dữ liệu.', 'success');
    if (!mqttClient?.connected && room) {
        connectMQTT();
    }
});

window.addEventListener('offline', () => {
    byId('offline-banner')?.classList.remove('d-none');
    updateStatus('Chế độ Ngoại tuyến (Offline)', 'yellow');
    showToast('Mất kết nối Internet', 'Dữ liệu được lưu trữ an toàn trong IndexedDB cục bộ.', 'warning');
});

// Session Restore
(async function restoreSession() {
    if (!window.isSecureContext) {
        showToast('Môi trường không an toàn', 'Hãy dùng HTTPS hoặc localhost để bật mã hóa và Clipboard.', 'warning', 8000);
    }

    if (!navigator.onLine) {
        byId('offline-banner')?.classList.remove('d-none');
    }
    
    const clientRoom = localStorage.getItem(`${STORAGE_PREFIX}:last-client`);
    const hostRoom = localStorage.getItem(`${STORAGE_PREFIX}:last-host`);
    
    let clientSession = clientRoom ? await idbGet('meta', `${STORAGE_PREFIX}:session-client:${clientRoom}`) : null;
    if (!clientSession && clientRoom) {
        clientSession = loadJson(`${STORAGE_PREFIX}:session-client:${clientRoom}`, null);
    }

    let hostSession = hostRoom ? await idbGet('meta', `${STORAGE_PREFIX}:session-host:${hostRoom}`) : null;
    if (!hostSession && hostRoom) {
        hostSession = loadJson(`${STORAGE_PREFIX}:session-host:${hostRoom}`, null);
    }

    const recoverySession = hostRoom ? loadJson(`${STORAGE_PREFIX}:recovery-host:${hostRoom}`, null) : null;
    
    const session = clientSession || hostSession;
    
    if (!session?.room || !session?.user) {
        if (recoverySession) {
            byId('resume-host-btn').classList.remove('d-none');
        }
        return;
    }
    
    room = session.room;
    currentUser = session.user;
    isHost = !clientSession;
    
    if (!room.invite && room.secret) {
        room.invite = createLegacyInvite(room);
    }
    
    try {
        await setupCrypto();
        
        if (!isHost) {
            queue = sanitizeQueue(loadJson(roomKey('queue'), []));
            handshakeTimer = setTimeout(() => {
                if (!joined) {
                    showToast('Host không phản hồi', 'Phiên tự khôi phục đã hết thời gian chờ.', 'error');
                }
            }, 15000);
        }
        
        connectMQTT();
    } catch (error) {
        showToast('Không thể khôi phục phiên', error.message, 'error');
    }
}());
