// ============================================================
//  TRỢ LÝ GIÁM THỊ AI — script.js  v3.0
//  Cải tiến: Toast premium, animation, fixes all known bugs
// ============================================================

// --- CONFIG & CONSTANTS ---
const CLASS_PASSWORDS = {
    '12A1': '1231', '12A2': '1232', '12A3': '1233',
    '12A4': '1234', '12A5': '1235', '12A6': '1236',
    '11B1': '1131', '10C3': '1013'
};

const VIOLATION_MAP = {
    'KHONG_MANG_THE':    { label: 'Không mang thẻ học viên',      keys: ['the', 'khong mang the', 'deo the', 'quang the', 'quen the', 'k the', 'ko the', 'mat the'] },
    'KHONG_MAC_AO_DAI':  { label: 'Không mặc áo dài',            keys: ['ao dai', 'aodai', 'aod', 'khong mac ao dai', 'mac sai ao dai', 'k ao dai', 'thieu ao dai'] },
    'KHONG_MAC_AO_DOAN': { label: 'Không mặc áo đoàn',            keys: ['ao doan', 'aodoan', 'doan', 'khong mac ao doan', 'k ao doan', 'thieu ao doan'] },
    'DI_XE_50CC':        { label: 'Đi xe trên 50cc',              keys: ['xe', 'may', '50cc', 'phan khoi', 'xe may', 'xe to'] },
    'NHUOM_TOC':         { label: 'Nhuộm tóc / Đầu tóc',         keys: ['toc', 'nhuom', 'dau toc', 'toc tai', 'nhuom toc'] },
    'KHONG_DONG_THUNG':  { label: 'Không đóng thùng (Sơ vin)',    keys: ['thung', 'so vin', 'bo ao', 'khong dong thung', 'dong thung', 'chua so vin'] },
    'MANG_DEP_LE':       { label: 'Mang dép lê',                  keys: ['dep', 'dep le', 'mang dep', 'di dep', 'le'] },
    'DI_HOC_MUON':       { label: 'Đi học muộn',                  keys: ['muon', 'tre', 'di muon', 'di tre'] },
    'KHONG_TRUC_NHAT':   { label: 'Không trực nhật',              keys: ['truc nhat', 've sinh', 'quet lop'] },
    'SU_DUNG_DIEN_THOAI':{ label: 'Sử dụng điện thoại',          keys: ['dien thoai', 'dien thoai trong lop', 'choi dien thoai', 'dt'] }
};

const CLIENT_SESSION_KEY = 'GiamThiAI_v3_Client';
const HOST_SESSION_KEY   = 'GiamThiAI_v3_Host';
const HOST_DATA_KEY      = 'GiamThiAI_v3_Data';

// Broker pool - tự động fallback nếu 1 bị lỗi
const MQTT_BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://test.mosquitto.org:8081/mqtt'
];

// --- GLOBAL STATE ---
let mqttClient    = null;
let roomTopic     = '';
let myClientId    = 'client_' + Math.random().toString(16).substring(2, 10);
let connections   = [];
let myId          = '';
let hostId        = '';
let currentUser   = { name: '', role: '' };
let violationsData = [];
let isHost        = false;
let currentBrokerIdx = 0;
let toastTimer    = null;

// Display settings
let displaySettings = { time: true, name: true, class: true, reporter: true };

// ============================================================
//  TOAST – Premium notification
// ============================================================
const TOAST_ICONS = {
    info:    { icon: 'fa-circle-info',      color: 'text-blue-400',   bar: 'bg-blue-500',    cls: 'toast-info' },
    success: { icon: 'fa-circle-check',     color: 'text-green-400',  bar: 'bg-green-500',   cls: 'toast-success' },
    error:   { icon: 'fa-circle-xmark',     color: 'text-red-400',    bar: 'bg-red-500',     cls: 'toast-error' },
    warning: { icon: 'fa-triangle-exclamation', color: 'text-yellow-400', bar: 'bg-yellow-500', cls: 'toast-warning' }
};

function showToast(title, message, type = 'info', duration = 3500) {
    const t       = document.getElementById('toast');
    const iconEl  = document.getElementById('toast-icon');
    const titleEl = document.getElementById('toast-title');
    const msgEl   = document.getElementById('toast-message');
    const barEl   = document.getElementById('toast-progress');

    const cfg = TOAST_ICONS[type] || TOAST_ICONS.info;

    // Update content
    titleEl.textContent = title;
    msgEl.textContent   = message;
    iconEl.className    = `${cfg.color} mt-0.5 text-sm shrink-0`;
    iconEl.innerHTML    = `<i class="fa-solid ${cfg.icon}"></i>`;

    // Update bar color
    barEl.className = `toast-progress ${cfg.bar}`;

    // Reset animation tricks
    t.className = `${cfg.cls}`;
    barEl.style.animation = 'none';
    barEl.offsetHeight; // reflow
    barEl.style.animation = `toastProgress ${duration}ms linear forwards`;

    // Show
    requestAnimationFrame(() => t.classList.add('show'));

    // Auto-hide
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), duration);
}

// ============================================================
//  UI UTILITIES
// ============================================================
function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    ['create', 'join'].forEach(t => {
        document.getElementById(`form-${t}`).classList.toggle('d-none', t !== tab);
    });
}

function togglePasswordInput() {
    const role          = document.getElementById('join-role').value;
    const passField     = document.getElementById('password-field');
    const guestField    = document.getElementById('guest-name-field');

    guestField.classList.toggle('d-none', !role);
    passField.classList.toggle('d-none', !CLASS_PASSWORDS.hasOwnProperty(role));
}

function updateStatus(statusText, color = 'green') {
    const text = document.getElementById('connection-status-text');
    const dot  = document.getElementById('connection-status-dot');
    text.textContent = statusText;
    dot.className = `status-dot ${color === 'green' ? 'online' : color === 'red' ? 'offline' : 'pending'}`;
}

function switchToMainApp(pin) {
    document.getElementById('login-screen').classList.add('d-none');
    const app = document.getElementById('main-app');
    app.classList.remove('d-none');
    app.classList.remove('app-hidden');
    requestAnimationFrame(() => setTimeout(() => app.classList.add('app-visible'), 50));

    const nameEl = document.getElementById('display-name');
    const roleEl = document.getElementById('display-role');

    nameEl.textContent = currentUser.name || currentUser.role;
    roleEl.textContent = currentUser.role;
    roleEl.className = 'role-badge role-badge-host';

    // Adjust role badge for non-host
    if (currentUser.role !== 'HOST') {
        roleEl.style.background = 'linear-gradient(135deg, #059669, #047857)';
        roleEl.style.boxShadow = '0 2px 8px rgba(5, 150, 105, 0.4)';
    }

    if (pin) {
        document.getElementById('display-pin').textContent = pin;
        document.getElementById('pin-container').classList.remove('d-none');
    }

    if (currentUser.role === 'HOST') {
        document.getElementById('clear-all-btn').classList.remove('d-none');
        document.getElementById('connected-users-bubble').classList.remove('d-none');
    }

    // Populate datalist
    const dataList = document.getElementById('violation-suggestions');
    if (dataList) {
        dataList.innerHTML = Object.values(VIOLATION_MAP)
            .map(v => `<option value="${v.label}">`)
            .join('');
    }

    // Auto set Enter-to-send
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const toggle = document.getElementById('enter-to-send');
    if (toggle) toggle.checked = !isMobile;
}

function copyPin() {
    const pin = document.getElementById('display-pin').textContent;
    navigator.clipboard.writeText(pin).then(() => {
        showToast('Đã sao chép!', `Mã phòng ${pin} đã được copy`, 'success', 2000);
    }).catch(() => {
        showToast('Lỗi', 'Không thể copy tự động', 'error');
    });
}

function logout() {
    if (confirm('Bạn có chắc muốn thoát?\nKết nối sẽ bị ngắt và phiên làm việc sẽ bị xóa.')) {
        if (mqttClient) mqttClient.end(true);
        localStorage.removeItem(CLIENT_SESSION_KEY);
        localStorage.removeItem(HOST_SESSION_KEY);
        localStorage.removeItem(HOST_DATA_KEY);
        location.reload();
    }
}

// ============================================================
//  HOST BUBBLE — Connected users
// ============================================================
function toggleUserList() {
    const pop = document.getElementById('user-list-popover');
    pop.classList.toggle('d-none');
}

function updateUserListUI() {
    const badge  = document.getElementById('user-count-badge');
    const listUl = document.getElementById('user-list-ul');
    badge.textContent = connections.length;

    if (connections.length === 0) {
        listUl.innerHTML = '<li class="text-slate-500 text-xs text-center py-4 italic">Chưa có máy nào kết nối...</li>';
        return;
    }

    listUl.innerHTML = connections.map(conn => {
        const meta = conn.metadata || { name: 'Không tên', role: '?' };
        let icon = 'fa-user', colorClass = 'text-slate-400';
        if (/^\d{2}[A-Z]\d*$/.test(meta.role)) { icon = 'fa-users'; colorClass = 'text-blue-400'; }
        else if (meta.role === 'MONITOR') { icon = 'fa-user-shield'; colorClass = 'text-green-400'; }
        return `
        <li class="user-list-item">
            <div class="flex items-center gap-2.5 overflow-hidden">
                <div class="user-avatar ${colorClass}">
                    <i class="fa-solid ${icon} text-xs"></i>
                </div>
                <div class="min-w-0">
                    <p class="text-xs font-bold text-slate-200 truncate">${escapeHtml(meta.name)}</p>
                    <p class="text-[10px] font-mono text-slate-500">${escapeHtml(meta.role)}</p>
                </div>
            </div>
            <span class="status-dot online shrink-0" title="Online"></span>
        </li>`;
    }).join('');
}

// ============================================================
//  MQTT / P2P LOGIC
// ============================================================
function createRoom() {
    const name = document.getElementById('host-name').value.trim();
    if (!name) return showToast('Thiếu thông tin', 'Vui lòng chọn danh tính giám thị', 'error');

    currentUser = { name, role: 'HOST' };
    isHost = true;

    const pin = Math.floor(100000 + Math.random() * 900000);
    myId = hostId = `GT-${pin}`;
    roomTopic = `giamthi_room_${pin}`;

    localStorage.setItem(HOST_SESSION_KEY, JSON.stringify({ name, role: 'HOST', pin }));
    initMQTT(true);
}

function joinRoom() {
    const pin       = document.getElementById('join-pin').value.trim();
    const role      = document.getElementById('join-role').value;
    const inputName = document.getElementById('guest-name').value.trim();

    if (!pin || pin.length !== 6) return showToast('Lỗi mã phòng', 'Mã phòng phải gồm đúng 6 chữ số', 'error');
    if (!role) return showToast('Thiếu vai trò', 'Vui lòng chọn lớp / vai trò', 'error');
    if (!inputName) return showToast('Thiếu tên', 'Vui lòng nhập tên người trực', 'error');

    if (CLASS_PASSWORDS.hasOwnProperty(role)) {
        const pass = document.getElementById('join-password').value;
        if (pass !== CLASS_PASSWORDS[role])
            return showToast('Sai mật khẩu', 'Mật khẩu lớp không đúng!', 'error');
    }

    currentUser = { name: inputName, role };
    isHost = false;
    hostId = `GT-${pin}`;
    roomTopic = `giamthi_room_${pin}`;

    localStorage.setItem(CLIENT_SESSION_KEY, JSON.stringify({ pin, name: inputName, role }));
    initMQTT(false);
}

function initMQTT(isHostInit, brokerIdx = 0) {
    if (brokerIdx >= MQTT_BROKERS.length) {
        showToast('Lỗi nghiêm trọng', 'Không thể kết nối bất kỳ máy chủ MQTT nào', 'error');
        updateStatus('Lỗi kết nối', 'red');
        return;
    }

    const brokerUrl = MQTT_BROKERS[brokerIdx];
    showToast('Đang kết nối', `Server MQTT (${brokerIdx + 1}/${MQTT_BROKERS.length})...`, 'info', 5000);
    updateStatus('Đang kết nối...', 'yellow');

    const opts = {
        clientId: `giamthi_${myClientId}`,
        keepalive: 60,
        connectTimeout: 10000,
        reconnectPeriod: 0, // disable auto-reconnect, we handle manually
        ...(!isHostInit ? {
            will: {
                topic: `${roomTopic}/client_to_host`,
                payload: JSON.stringify({ type: 'BYE', clientId: myClientId }),
                qos: 0,
                retain: false
            }
        } : {})
    };

    if (mqttClient) { try { mqttClient.end(true); } catch(e) {} }
    mqttClient = mqtt.connect(brokerUrl, opts);

    // Connection timeout
    const connTimeout = setTimeout(() => {
        if (mqttClient && !mqttClient.connected) {
            mqttClient.end(true);
            showToast('Hết thời gian', 'Thử broker dự phòng...', 'warning');
            initMQTT(isHostInit, brokerIdx + 1);
        }
    }, 10000);

    mqttClient.on('connect', () => {
        clearTimeout(connTimeout);
        currentBrokerIdx = brokerIdx;

        if (isHostInit) {
            const pin = hostId.replace('GT-', '');
            switchToMainApp(pin);
            updateStatus('Máy chủ đang hoạt động', 'green');
            loadDataLocal();
            renderReport();
            updateUserListUI();
            mqttClient.subscribe(`${roomTopic}/client_to_host`, { qos: 0 });
            showToast('Phòng đã mở!', `Mã phòng: ${pin} — Chia sẻ cho các lớp`, 'success');
        } else {
            switchToMainApp();
            updateStatus('Đang đồng bộ...', 'yellow');
            mqttClient.subscribe(`${roomTopic}/host_to_client`, { qos: 0 });
            mqttClient.subscribe(`${roomTopic}/host_to_client/${myClientId}`, { qos: 0 });

            // Handshake
            publish(`${roomTopic}/client_to_host`, {
                type: 'HELLO',
                clientId: myClientId,
                metadata: { name: currentUser.name, role: currentUser.role }
            });
        }
    });

    mqttClient.on('message', (topic, message) => {
        try {
            const payload = JSON.parse(message.toString());
            if (isHostInit && topic === `${roomTopic}/client_to_host`) {
                handleHostMessage(payload);
            } else if (!isHostInit && topic.startsWith(`${roomTopic}/host_to_client`)) {
                handleClientMessage(payload);
            }
        } catch (e) {
            console.warn('[MQTT] Lỗi parse message:', e);
        }
    });

    mqttClient.on('error', (err) => {
        clearTimeout(connTimeout);
        console.error('[MQTT] Error:', err);
        updateStatus('Lỗi kết nối', 'red');
        // Try next broker if not yet connected
        if (brokerIdx < MQTT_BROKERS.length - 1) {
            setTimeout(() => initMQTT(isHostInit, brokerIdx + 1), 1000);
        }
    });

    mqttClient.on('close', () => {
        // Only update status if we were connected before
        if (document.getElementById('main-app') && !document.getElementById('main-app').classList.contains('hidden')) {
            updateStatus('Mất kết nối – đang thử lại', 'red');
        }
    });

    mqttClient.on('reconnect', () => {
        updateStatus('Đang kết nối lại...', 'yellow');
    });
}

function handleHostMessage(payload) {
    if (payload.type === 'HELLO') {
        const existing = connections.findIndex(c => c.id === payload.clientId);
        if (existing === -1) {
            connections.push({ id: payload.clientId, metadata: payload.metadata });
            showToast('Kết nối mới 🔗', `${payload.metadata.name} (${payload.metadata.role}) đã vào phòng`, 'success');
            updateStatus(`Đã kết nối ${connections.length} máy`, 'green');
            updateUserListUI();
        }

        // Send full sync to this specific client
        publish(`${roomTopic}/host_to_client/${payload.clientId}`, {
            type: 'SYNC_FULL',
            data: violationsData
        });
    } else if (payload.type === 'BYE') {
        const before = connections.length;
        connections = connections.filter(c => c.id !== payload.clientId);
        if (connections.length < before) {
            updateUserListUI();
            updateStatus(connections.length > 0 ? `Đã kết nối ${connections.length} máy` : 'Máy chủ đang chạy', 'green');
        }
    } else {
        handleDataPacket(payload);
    }
}

function handleClientMessage(payload) {
    if (payload.type === 'SYNC_FULL') {
        const statusText = document.getElementById('connection-status-text').textContent;
        if (statusText.includes('đồng bộ') || statusText.includes('chờ')) {
            updateStatus('Đã kết nối với Giám Thị', 'green');
            showToast('Vào phòng thành công!', 'Dữ liệu đã được đồng bộ', 'success');
        }
    }
    handleDataPacket(payload);
}

function publish(topic, data) {
    if (mqttClient && mqttClient.connected) {
        mqttClient.publish(topic, JSON.stringify(data), { qos: 0 });
    }
}

function broadcast(packet) {
    publish(`${roomTopic}/host_to_client`, packet);
}

// ============================================================
//  DATA HANDLING
// ============================================================
function handleDataPacket(packet) {
    switch (packet.type) {
        case 'SYNC_FULL':
            violationsData = Array.isArray(packet.data) ? packet.data : [];
            renderReport();
            if (isHost) saveDataLocal();
            break;
        case 'ADD_ITEMS':
            if (Array.isArray(packet.items)) {
                violationsData = [...violationsData, ...packet.items];
                renderReport();
                if (isHost) { saveDataLocal(); broadcast({ type: 'SYNC_FULL', data: violationsData }); }
            }
            break;
        case 'REMOVE_ITEM':
            violationsData = violationsData.filter(v => v.id !== packet.id);
            renderReport();
            if (isHost) { saveDataLocal(); broadcast({ type: 'SYNC_FULL', data: violationsData }); }
            break;
        case 'UPDATE_ITEM': {
            const idx = violationsData.findIndex(v => v.id === packet.data.id);
            if (idx !== -1) {
                violationsData[idx] = { ...violationsData[idx], ...packet.data };
                renderReport();
                if (isHost) { saveDataLocal(); broadcast({ type: 'SYNC_FULL', data: violationsData }); }
            }
            break;
        }
        case 'CLEAR_ALL':
            violationsData = [];
            renderReport();
            if (isHost) saveDataLocal();
            break;
    }
}

function sendData(packet) {
    if (isHost) {
        handleDataPacket(packet);
    } else if (mqttClient && mqttClient.connected) {
        publish(`${roomTopic}/client_to_host`, packet);
    } else {
        showToast('Chưa kết nối', 'Vui lòng kết nối lại với máy chủ', 'error');
    }
}

// ============================================================
//  LOCAL STORAGE
// ============================================================
function saveDataLocal() {
    if (isHost) {
        try { localStorage.setItem(HOST_DATA_KEY, JSON.stringify(violationsData)); }
        catch(e) { console.warn('Không thể lưu local storage:', e); }
    }
}

function loadDataLocal() {
    const saved = localStorage.getItem(HOST_DATA_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) violationsData = parsed;
        } catch(e) {
            console.warn('Dữ liệu local storage bị hỏng, xóa...', e);
            localStorage.removeItem(HOST_DATA_KEY);
        }
    }
}

// ============================================================
//  TEXT PROCESSING
// ============================================================
const toTitleCase = str =>
    str.toLowerCase().replace(/(^|\s)\S/g, l => l.toUpperCase());

const removeAccents = str =>
    str.normalize('NFD')
       .replace(/[\u0300-\u036f]/g, '')
       .replace(/đ/g, 'd').replace(/Đ/g, 'D');

const detectViolation = (text) => {
    if (!text || !text.trim()) return 'Chưa xác định';
    const normalized = removeAccents(text.toLowerCase()).trim();
    
    // Find the LONGEST matching key to avoid ambiguity
    // e.g. "ao dai" (6 chars) should beat "ao" (2 chars)
    let bestMatch = null;
    let bestKeyLen = 0;
    
    for (const code in VIOLATION_MAP) {
        for (const key of VIOLATION_MAP[code].keys) {
            if (normalized.includes(key) && key.length > bestKeyLen) {
                bestKeyLen = key.length;
                bestMatch = VIOLATION_MAP[code].label;
            }
        }
    }
    
    return bestMatch || toTitleCase(text.trim());
};

// Regex nhận diện tên lớp (10A1, 11B2, 12A3, v.v.)
const CLASS_REGEX = /\b([1-9][0-2]?[a-zA-Z][0-9]{0,2})\b/i;

const smartParse = (rawText) => {
    const lines   = rawText.split(/\n+/);
    const results = [];
    const now     = new Date().toISOString();

    lines.forEach((line, lineIdx) => {
        line = line.trim().replace(/\s+/g, ' ');
        if (!line) return;

        let name = '', className = '', violation = '';
        const classMatch = line.match(CLASS_REGEX);

        if (classMatch) {
            className = classMatch[0].toUpperCase();
            const pre  = line.substring(0, classMatch.index).replace(/[-–]/g, '').trim();
            const post = line.substring(classMatch.index + classMatch[0].length).replace(/^[-–\s]+/, '').trim();

            if (pre) {
                // Format: "Nguyễn Văn A 12A1 đi muộn"
                name      = pre;
                violation = post;
            } else {
                // Format: "12A1 Nguyễn Văn A - đi muộn" or "12A1 đi muộn Nguyễn Văn A"
                const dashParts = post.split(/[-–;]/);
                if (dashParts.length >= 2) {
                    name      = dashParts[0].trim();
                    violation = dashParts.slice(1).join(',').trim();
                } else {
                    // Keyword search to separate name / violation
                    // Prefer: earliest position first, then longest key at that position
                    const normalizedPost = removeAccents(post.toLowerCase());
                    let bestKeyIdx = Infinity, bestKeyLen = 0, bestKey = '';
                    for (const code in VIOLATION_MAP) {
                        for (const key of VIOLATION_MAP[code].keys) {
                            const idx = normalizedPost.indexOf(key);
                            if (idx !== -1 && (idx < bestKeyIdx || (idx === bestKeyIdx && key.length > bestKeyLen))) {
                                bestKeyIdx = idx; bestKeyLen = key.length; bestKey = key;
                            }
                        }
                    }
                    if (bestKey && bestKeyIdx > 0) {
                        name      = post.substring(0, bestKeyIdx).trim();
                        violation = post.substring(bestKeyIdx).trim();
                    } else if (bestKey && bestKeyIdx === 0) {
                        name = post; violation = '';
                    } else {
                        name = post; violation = 'Chưa xác định';
                    }
                }
            }
        } else {
            const parts = line.split(/[-–,;]/);
            if (parts.length >= 2) {
                name      = parts[0].trim();
                violation = parts[parts.length - 1].trim();
                if (parts.length > 2) className = parts[1].trim().toUpperCase();
            } else {
                name = line; violation = 'Chưa xác định';
            }
        }

        if (!name) return;

        // Handle multiple violations separated by comma
        const vParts = violation
            ? violation.split(',').map(v => v.trim()).filter(v => v.length > 0)
            : ['Chưa xác định'];

        vParts.forEach(vp => {
            results.push({
                id:        `${Date.now()}_${lineIdx}_${Math.random().toString(36).substring(2, 7)}`,
                name:      toTitleCase(name),
                class:     className || '?',
                violation: detectViolation(vp),
                time:      now,
                reporter:  currentUser.name
            });
        });
    });

    return results;
};

// ============================================================
//  RENDER REPORT
// ============================================================
const escapeHtml = str => String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const renderReport = () => {
    const container = document.getElementById('report-container');
    document.getElementById('count-badge').textContent = violationsData.length;

    if (violationsData.length === 0) {
        container.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon"><i class="fa-solid fa-clipboard-check text-blue-400/20"></i></div>
            <p class="text-sm font-semibold text-slate-500">Chưa có vi phạm nào</p>
            <p class="text-xs text-slate-600">Hãy nhập dữ liệu ở bên trái để bắt đầu</p>
        </div>`;
        return;
    }

    // Group by violation type
    const grouped = {};
    violationsData.forEach(s => {
        const key = s.violation || 'Lỗi khác';
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(s);
    });

    // Sort groups by count descending
    const sortedGroups = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length);

    let html = '';
    let stt = 1;

    for (const [vName, students] of sortedGroups) {
        const thead = `
        <thead>
            <tr class="bg-black/10">
                <th class="violation-table-th w-10 text-center">#</th>
                ${displaySettings.time     ? '<th class="violation-table-th w-16 text-center">Giờ</th>' : ''}
                ${displaySettings.name     ? '<th class="violation-table-th">Họ và Tên</th>' : ''}
                ${displaySettings.class    ? '<th class="violation-table-th w-20 text-center">Lớp</th>' : ''}
                ${displaySettings.reporter ? '<th class="violation-table-th w-24 text-right">Người báo</th>' : ''}
                <th class="violation-table-th w-16 text-center">Thao tác</th>
            </tr>
        </thead>`;

        let tbody = '<tbody>';
        students.forEach(s => {
            const timeStr = new Date(s.time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            tbody += `
            <tr class="violation-table-row">
                <td class="td-cell stt-cell">${stt++}</td>
                ${displaySettings.time     ? `<td class="td-cell time-cell text-center">${escapeHtml(timeStr)}</td>` : ''}
                ${displaySettings.name     ? `<td class="td-cell"><span class="student-name">${escapeHtml(s.name)}</span></td>` : ''}
                ${displaySettings.class    ? `<td class="td-cell text-center"><span class="class-badge">${escapeHtml(s.class)}</span></td>` : ''}
                ${displaySettings.reporter ? `<td class="td-cell reporter-cell text-right">${escapeHtml(s.reporter || '')}</td>` : ''}
                <td class="td-cell">
                    <div class="row-actions">
                        <button class="action-btn action-btn-edit" onclick="openEditModal('${escapeHtml(s.id)}')" title="Chỉnh sửa">
                            <i class="fa-solid fa-pen text-[10px]"></i>
                        </button>
                        <button class="action-btn action-btn-delete" onclick="deleteRow('${escapeHtml(s.id)}')" title="Xóa">
                            <i class="fa-solid fa-trash text-[10px]"></i>
                        </button>
                    </div>
                </td>
            </tr>`;
        });
        tbody += '</tbody>';

        html += `
        <div class="violation-group">
            <div class="violation-group-header">
                <div class="violation-group-title">
                    <i class="fa-solid fa-circle-exclamation text-[10px]"></i>
                    ${escapeHtml(vName)}
                </div>
                <span class="group-count-badge">${students.length} HS</span>
            </div>
            <table class="violation-table">${thead}${tbody}</table>
        </div>`;
    }

    container.innerHTML = html;

    // Additional inline styles for table cells (since we're not using tailwind here)
    container.querySelectorAll('.td-cell').forEach(td => {
        td.style.padding = '10px 14px';
        td.style.verticalAlign = 'middle';
        td.style.borderBottom = '1px solid rgba(255,255,255,0.03)';
    });
    container.querySelectorAll('.violation-table-th').forEach(th => {
        th.style.padding = '10px 14px';
        th.style.fontSize = '10px';
        th.style.fontWeight = '700';
        th.style.letterSpacing = '0.08em';
        th.style.textTransform = 'uppercase';
        th.style.color = '#475569';
        th.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
    });
    container.querySelectorAll('.violation-table-row').forEach(tr => {
        tr.classList.add('violation-table-row-hover');
    });
};

// ============================================================
//  EDIT MODAL
// ============================================================
window.openEditModal = (id) => {
    const item = violationsData.find(v => v.id === id);
    if (!item) return showToast('Lỗi', 'Không tìm thấy dòng dữ liệu', 'error');

    document.getElementById('edit-id').value        = id;
    document.getElementById('edit-name').value      = item.name;
    document.getElementById('edit-class').value     = item.class;
    document.getElementById('edit-violation').value = item.violation;

    document.getElementById('edit-modal').classList.remove('d-none');
};

window.closeEditModal = () => {
    document.getElementById('edit-modal').classList.add('d-none');
};

window.saveEdit = () => {
    const id        = document.getElementById('edit-id').value;
    const name      = document.getElementById('edit-name').value.trim();
    const className = document.getElementById('edit-class').value.trim().toUpperCase();
    const violation = document.getElementById('edit-violation').value.trim();

    if (!name || !className || !violation)
        return showToast('Thiếu thông tin', 'Vui lòng điền đầy đủ các trường', 'error');

    sendData({ type: 'UPDATE_ITEM', data: { id, name, class: className, violation: detectViolation(violation) } });
    closeEditModal();
    showToast('Đã cập nhật', 'Thông tin vi phạm đã được sửa', 'success', 2500);
};

window.deleteRow = (id) => {
    if (confirm('Bạn có chắc muốn xóa vi phạm này?')) {
        sendData({ type: 'REMOVE_ITEM', id });
        showToast('Đã xóa', 'Vi phạm đã được loại khỏi danh sách', 'warning', 2500);
    }
};

// ============================================================
//  DISPLAY SETTINGS TOGGLE
// ============================================================
function toggleDisplayMenu() {
    document.getElementById('display-menu').classList.toggle('d-none');
}

document.addEventListener('click', (e) => {
    const menu = document.getElementById('display-menu');
    const btn  = document.getElementById('toggle-display-btn');
    if (menu && !menu.classList.contains('d-none') && !menu.contains(e.target) && !btn.contains(e.target)) {
        menu.classList.add('d-none');
    }
    // Close user list popover if clicking outside
    const popover     = document.getElementById('user-list-popover');
    const bubbleBtn   = document.getElementById('toggle-user-list-btn');
    if (popover && !popover.classList.contains('d-none') && !popover.contains(e.target) && bubbleBtn && !bubbleBtn.contains(e.target)) {
        popover.classList.add('d-none');
    }
});

['time', 'name', 'class', 'reporter'].forEach(key => {
    const el = document.getElementById(`show-${key}`);
    if (el) el.addEventListener('change', e => {
        displaySettings[key] = e.target.checked;
        renderReport();
    });
});

// ============================================================
//  EVENT LISTENERS — BUTTONS
// ============================================================
document.getElementById('btn-create-room').addEventListener('click', createRoom);
document.getElementById('btn-join-room').addEventListener('click', joinRoom);
document.getElementById('btn-logout').addEventListener('click', logout);
document.getElementById('toggle-user-list-btn').addEventListener('click', toggleUserList);
document.getElementById('toggle-display-btn').addEventListener('click', toggleDisplayMenu);
document.getElementById('join-role').addEventListener('change', togglePasswordInput);

document.getElementById('clear-all-btn').addEventListener('click', () => {
    if (confirm('Xóa TẤT CẢ dữ liệu trên mọi máy kết nối?\nHành động này không thể hoàn tác!')) {
        violationsData = [];
        renderReport();
        saveDataLocal();
        broadcast({ type: 'CLEAR_ALL' });
        showToast('Đã xóa tất cả', 'Toàn bộ dữ liệu vi phạm đã được xóa', 'warning');
    }
});

// ============================================================
//  PROCESS INPUT
// ============================================================
document.getElementById('process-btn').addEventListener('click', () => {
    const input = document.getElementById('text-input');
    const raw   = input.value.trim();
    if (!raw) return showToast('Chưa có dữ liệu', 'Hãy nhập nội dung vi phạm trước', 'error');

    const newStudents = smartParse(raw);
    if (newStudents.length > 0) {
        sendData({ type: 'ADD_ITEMS', items: newStudents });
        input.value = '';
        showToast('Đã gửi!', `${newStudents.length} vi phạm đã được thêm vào danh sách`, 'success');
    } else {
        showToast('Không nhận dạng được', 'Hãy kiểm tra lại định dạng nhập', 'warning');
    }
});

document.getElementById('text-input').addEventListener('keydown', (e) => {
    if (document.getElementById('enter-to-send').checked && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        document.getElementById('process-btn').click();
    }
});

// ============================================================
//  EXCEL IMPORT
// ============================================================
document.getElementById('excel-input').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const data     = new Uint8Array(ev.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const ws       = workbook.Sheets[workbook.SheetNames[0]];
            const json     = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

            const now      = new Date().toISOString();
            const newItems = [];

            // Skip header row (row 0)
            for (let i = 1; i < json.length; i++) {
                const row = json[i];
                const nameVal = row[2] ? String(row[2]).trim() : '';
                const vioVal  = row[4] ? String(row[4]).trim() : '';
                if (!nameVal || !vioVal) continue;

                newItems.push({
                    id:        `excel_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
                    time:      now,
                    name:      nameVal,
                    class:     row[3] ? String(row[3]).trim().toUpperCase() : '?',
                    violation: detectViolation(vioVal),
                    reporter:  row[5] ? String(row[5]).trim() : currentUser.name
                });
            }

            if (newItems.length > 0) {
                sendData({ type: 'ADD_ITEMS', items: newItems });
                showToast('Import thành công', `Đã nhập ${newItems.length} dòng từ Excel`, 'success');
            } else {
                showToast('File rỗng', 'Không tìm thấy dữ liệu hợp lệ trong file (kiểm tra cột C và E)', 'error');
            }
        } catch(err) {
            console.error('[Excel Import]', err);
            showToast('Lỗi đọc file', 'File Excel bị hỏng hoặc sai định dạng', 'error');
        } finally {
            this.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
});

// Drag & drop for Excel
const dropZone = document.getElementById('excel-drop-zone');
if (dropZone) {
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
            const input = document.getElementById('excel-input');
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            input.dispatchEvent(new Event('change'));
        } else {
            showToast('Sai định dạng', 'Chỉ chấp nhận file .xlsx hoặc .xls', 'error');
        }
    });
}

// ============================================================
//  OCR
// ============================================================
document.getElementById('ocr-input').addEventListener('change', async function(e) {
    const file = e.target.files[0];
    if (!file) return;

    const loadingEl  = document.getElementById('ocr-loading');
    const progressEl = document.getElementById('ocr-progress');
    const percentEl  = document.getElementById('ocr-percent');
    const textarea   = document.getElementById('text-input');

    loadingEl.classList.remove('d-none');
    progressEl.style.width = '0%';
    if (percentEl) percentEl.textContent = '0%';

    try {
        const worker = Tesseract.createWorker({
            logger: m => {
                if (m.status === 'recognizing text') {
                    const pct = Math.round(m.progress * 100);
                    progressEl.style.width = `${pct}%`;
                    if (percentEl) percentEl.textContent = `${pct}%`;
                }
            }
        });
        await worker.load();
        await worker.loadLanguage('vie+eng');
        await worker.initialize('vie');

        const { data: { text } } = await worker.recognize(file);
        if (text.trim()) {
            textarea.value += (textarea.value ? '\n' : '') + text.trim();
            showToast('OCR thành công', 'Đã nhận dạng và chèn chữ vào ô nhập', 'success');
        } else {
            showToast('Không nhận được chữ', 'Ảnh không rõ hoặc không có chữ', 'warning');
        }
        await worker.terminate();
    } catch (err) {
        console.error('[OCR]', err);
        showToast('OCR thất bại', 'Không thể nhận dạng ảnh. Thử ảnh khác?', 'error');
    } finally {
        loadingEl.classList.add('d-none');
        this.value = '';
    }
});

// ============================================================
//  SPEECH RECOGNITION
// ============================================================
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const micBtn = document.getElementById('mic-btn');

if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'vi-VN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    let isListening = false;

    micBtn.addEventListener('click', () => {
        if (isListening) {
            recognition.stop();
        } else {
            recognition.start();
        }
    });

    recognition.onstart = () => {
        isListening = true;
        micBtn.classList.add('recording');
        document.querySelector('.mic-pulse').classList.add('active');
        showToast('Đang nghe...', 'Hãy nói tên + lớp + vi phạm', 'info', 8000);
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        const textarea = document.getElementById('text-input');
        textarea.value += (textarea.value ? '\n' : '') + transcript;
        showToast('Đã nhận giọng nói', `"${transcript}"`, 'success');
    };

    recognition.onerror = (event) => {
        let msg = 'Lỗi nhận dạng giọng nói';
        if (event.error === 'not-allowed') msg = 'Cần cấp quyền microphone';
        else if (event.error === 'no-speech') msg = 'Không nghe thấy gì, thử lại';
        showToast('Lỗi micro', msg, 'error');
    };

    recognition.onend = () => {
        isListening = false;
        micBtn.classList.remove('recording');
        document.querySelector('.mic-pulse').classList.remove('active');
    };
} else {
    micBtn.style.display = 'none';
    console.info('[Speech] SpeechRecognition không được hỗ trợ trên trình duyệt này.');
}

// ============================================================
//  EXPORT PNG
// ============================================================
document.getElementById('export-png-btn').addEventListener('click', () => {
    if (violationsData.length === 0)
        return showToast('Chưa có dữ liệu', 'Hãy thêm vi phạm trước khi xuất', 'error');

    showToast('Đang tạo phiếu...', 'Vui lòng chờ trong giây lát', 'info', 8000);

    const exportDiv = document.createElement('div');
    Object.assign(exportDiv.style, {
        position: 'fixed', top: '0', left: '-9999px', zIndex: '9999',
        width: '820px', backgroundColor: '#ffffff', color: '#1a1a1a',
        fontFamily: "'Be Vietnam Pro', sans-serif", padding: '40px',
        boxSizing: 'border-box', borderRadius: '0'
    });

    const grouped = {};
    violationsData.forEach(s => {
        const k = s.violation || 'Lỗi khác';
        if (!grouped[k]) grouped[k] = [];
        grouped[k].push(s);
    });

    const formatTime = iso => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    const dateStr    = new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const roleText   = currentUser.role === 'HOST'
        ? `Giám thị: <strong>${escapeHtml(currentUser.name)}</strong>`
        : `Người xuất: <strong>${escapeHtml(currentUser.name)}</strong> (${escapeHtml(currentUser.role)})`;

    let groupsHtml = '';
    let stt = 1;
    for (const [vName, students] of Object.entries(grouped)) {
        let rows = students.map(s => `
        <tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:9px 12px;color:#64748b;font-weight:700;text-align:center;width:45px;">${stt++}</td>
            <td style="padding:9px 12px;color:#64748b;font-family:monospace;font-size:12px;text-align:center;width:70px;">${formatTime(s.time)}</td>
            <td style="padding:9px 12px;font-weight:700;color:#1e293b;font-size:14px;text-transform:uppercase;">${escapeHtml(s.name)}</td>
            <td style="padding:9px 12px;text-align:center;">
                <span style="display:inline-block;padding:3px 10px;background:#fef3c7;color:#92400e;border-radius:6px;font-weight:700;font-size:11px;font-family:monospace;letter-spacing:1px;">${escapeHtml(s.class)}</span>
            </td>
            <td style="padding:9px 12px;text-align:right;color:#94a3b8;font-style:italic;font-size:11px;">${escapeHtml(s.reporter || '')}</td>
        </tr>`).join('');

        groupsHtml += `
        <div style="margin-bottom:24px;">
            <div style="background:#eff6ff;border-left:4px solid #2563eb;padding:10px 16px;margin-bottom:8px;border-radius:0 6px 6px 0;">
                <h3 style="margin:0;font-size:15px;font-weight:800;color:#1e40af;text-transform:uppercase;">
                    ${escapeHtml(vName)}
                    <span style="font-weight:400;font-size:12px;color:#64748b;margin-left:8px;">(${students.length} học sinh)</span>
                </h3>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead style="background:#f8fafc;">
                    <tr>
                        <th style="padding:8px 12px;text-align:center;color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;">STT</th>
                        <th style="padding:8px 12px;text-align:center;color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;">Giờ</th>
                        <th style="padding:8px 12px;text-align:left;color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;">Họ Tên</th>
                        <th style="padding:8px 12px;text-align:center;color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;">Lớp</th>
                        <th style="padding:8px 12px;text-align:right;color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;">Người báo</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
    }

    exportDiv.innerHTML = `
    <div style="border:1.5px solid #e5e7eb;border-radius:14px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.08);">
        <div style="background:linear-gradient(135deg,#1e3a8a,#1e40af,#2563eb);color:white;padding:28px 24px;text-align:center;">
            <img src="https://files.catbox.moe/jyg7qk.webp" crossorigin="anonymous"
                style="width:70px;height:70px;object-fit:contain;display:block;margin:0 auto 12px;" alt="">
            <p style="margin:0;font-size:12px;font-weight:600;opacity:0.75;letter-spacing:2px;text-transform:uppercase;">TRUNG TÂM GDTX – NN, TH TỈNH LÂM ĐỒNG</p>
            <h1 style="margin:8px 0 0;font-size:26px;font-weight:900;text-transform:uppercase;letter-spacing:1px;">Phiếu Ghi Nhận Vi Phạm</h1>
        </div>
        <div style="padding:16px 24px;background:#f8fafc;border-bottom:1.5px solid #e5e7eb;display:flex;justify-content:space-between;font-size:13px;">
            <div style="line-height:1.8;">
                <div><span style="color:#64748b;font-weight:600;">Ngày:</span> <strong>${dateStr}</strong></div>
                <div><span style="color:#64748b;font-weight:600;">Mã phòng:</span> <strong>#${hostId ? hostId.replace('GT-', '') : 'OFFLINE'}</strong></div>
            </div>
            <div style="text-align:right;line-height:1.8;">
                <div>${roleText}</div>
                <div><span style="color:#64748b;font-weight:600;">Tổng số lỗi:</span> <strong style="color:#dc2626;">${violationsData.length}</strong></div>
            </div>
        </div>
        <div style="padding:28px 24px;">${groupsHtml}</div>
        <div style="background:#f1f5f9;padding:12px 24px;text-align:center;color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0;">
            Xuất tự động từ Hệ Thống Trợ Lý Giám Thị AI v3.0 — ${new Date().toLocaleString('vi-VN')}
        </div>
    </div>`;

    document.body.appendChild(exportDiv);

    setTimeout(() => {
        html2canvas(exportDiv, { scale: 2.5, useCORS: true, backgroundColor: '#ffffff', logging: false })
        .then(canvas => {
            const link = document.createElement('a');
            link.download = `PhieuViPham_${dateStr.replace(/\//g, '-')}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            showToast('Xuất PNG thành công!', 'Phiếu đã được tải về máy', 'success');
        })
        .catch(err => {
            console.error('[Export PNG]', err);
            showToast('Xuất PNG thất bại', 'Lỗi khi tạo ảnh (CORS hoặc thư viện)', 'error');
        })
        .finally(() => {
            if (document.body.contains(exportDiv)) document.body.removeChild(exportDiv);
        });
    }, 600);
});

// ============================================================
//  EXPORT EXCEL
// ============================================================
document.getElementById('export-excel-btn').addEventListener('click', () => {
    if (violationsData.length === 0)
        return showToast('Chưa có dữ liệu', 'Hãy thêm vi phạm trước khi xuất', 'error');

    const wb     = XLSX.utils.book_new();
    const header = [['STT', 'Thời gian', 'Họ Tên', 'Lớp', 'Lỗi Vi Phạm', 'Người báo']];
    const rows   = violationsData.map((s, i) => [
        i + 1,
        new Date(s.time).toLocaleString('vi-VN'),
        s.name, s.class, s.violation, s.reporter || ''
    ]);
    const ws = XLSX.utils.aoa_to_sheet([...header, ...rows]);

    // Column widths
    ws['!cols'] = [{ wch: 5 }, { wch: 18 }, { wch: 25 }, { wch: 8 }, { wch: 35 }, { wch: 20 }];

    XLSX.utils.book_append_sheet(wb, ws, 'DanhSachViPham');
    XLSX.writeFile(wb, `DanhSachViPham_${hostId || 'Offline'}_${new Date().toLocaleDateString('vi-VN').replace(/\//g, '-')}.xlsx`);
    showToast('Xuất Excel thành công!', `${violationsData.length} dòng đã được xuất`, 'success');
});

// ============================================================
//  REALTIME CLOCK
// ============================================================
function updateClock() {
    const el = document.getElementById('realtime-clock');
    if (el) el.textContent = new Date().toLocaleTimeString('vi-VN', { hour12: false });
}
updateClock();
setInterval(updateClock, 1000);

// ============================================================
//  AUTO-RESTORE SESSION ON PAGE LOAD
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    // Try restore Client session first
    const savedClient = localStorage.getItem(CLIENT_SESSION_KEY);
    if (savedClient) {
        try {
            const sess = JSON.parse(savedClient);
            if (sess && sess.pin && sess.name && sess.role) {
                currentUser = { name: sess.name, role: sess.role };
                isHost      = false;
                hostId      = `GT-${sess.pin}`;
                roomTopic   = `giamthi_room_${sess.pin}`;
                showToast('Khôi phục phiên', `Đang kết nối lại phòng #${sess.pin}...`, 'info');
                initMQTT(false);
                return;
            }
        } catch(e) {
            localStorage.removeItem(CLIENT_SESSION_KEY);
        }
    }

    // Try restore Host session
    const savedHost = localStorage.getItem(HOST_SESSION_KEY);
    if (savedHost) {
        try {
            const sess = JSON.parse(savedHost);
            if (sess && sess.pin && sess.name) {
                currentUser = { name: sess.name, role: 'HOST' };
                isHost      = true;
                myId        = `GT-${sess.pin}`;
                hostId      = myId;
                roomTopic   = `giamthi_room_${sess.pin}`;
                showToast('Khôi phục phòng', `Đang khôi phục máy chủ phòng #${sess.pin}...`, 'info');
                initMQTT(true);
            }
        } catch(e) {
            localStorage.removeItem(HOST_SESSION_KEY);
        }
    }
});