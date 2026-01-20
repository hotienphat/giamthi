// --- CONFIG & CONSTANTS ---
const CLASS_PASSWORDS = {
    '12A1': '1231', '12A2': '1232', '12A3': '1233', 
    '12A4': '1234', '12A5': '1235', '12A6': '1236'
};
const VIOLATION_MAP = {
    'KHONG_MANG_THE': { label: 'Không mang thẻ học viên', keys: ['the', 'khong mang the', 'deo the', 'quang the', 'quen the', 'k the', 'ko the'] },
    'KHONG_MAC_AO_DOAN': { label: 'Không mặc áo đoàn', keys: ['ao doan', 'doan', 'aodoan', 'khong mac ao doan', 'k ao doan', 'thieu ao doan'] },
    'DI_XE_50CC': { label: 'Đi xe trên 50cc', keys: ['xe', 'may', '50cc', 'phan khoi', 'xe may', 'xe to'] },
    'NHUOM_TOC': { label: 'Nhuộm tóc / Đầu tóc', keys: ['toc', 'nhuom', 'dau toc', 'toc tai', 'nhuom toc'] },
    'KHONG_DONG_THUNG': { label: 'Không đóng thùng (Sơ vin)', keys: ['thung', 'so vin', 'bo ao', 'khong dong thung', 'dong thung', 'chua so vin'] },
    'KHONG_MAC_AO_DAI': { label: 'Không mặc áo dài', keys: ['ao dai', 'aod', 'khong mac ao dai', 'mac sai ao dai'] },
    'MANG_DEP_LE': { label: 'Mang dép lê', keys: ['dep', 'dep le', 'mang dep', 'di dep', 'le'] },
    'DI_HOC_MUON': { label: 'Đi học muộn', keys: ['muon', 'tre', 'di muon', 'di tre'] },
    'KHONG_TRUC_NHAT': { label: 'Không trực nhật', keys: ['truc nhat', 've sinh', 'quet lop'] }
};

// --- GLOBAL STATE ---
let peer = null;
let conn = null; // Client connection to host
let connections = []; // Host connections to clients (store objects with metadata)
let myId = '';
let hostId = '';
let currentUser = { name: '', role: '' };
let violationsData = [];
let isHost = false;

// --- DISPLAY SETTINGS STATE ---
let displaySettings = {
    time: true,
    name: true,
    class: true,
    reporter: true
};

// --- UI UTILS ---
function showToast(title, message, type = 'info') {
    const t = document.getElementById('toast');
    document.getElementById('toast-title').textContent = title;
    document.getElementById('toast-message').textContent = message;
    t.className = `fixed top-4 right-4 bg-gray-800 border-l-4 ${type === 'error' ? 'border-red-500' : 'border-blue-500'} text-white p-4 rounded shadow-2xl transform transition-transform duration-300 z-[100] max-w-sm flex items-start gap-3`;
    t.classList.remove('translate-x-full');
    setTimeout(() => t.classList.add('translate-x-full'), 3000);
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    document.getElementById('form-create').classList.add('hidden');
    document.getElementById('form-join').classList.add('hidden');
    document.getElementById(`form-${tab}`).classList.remove('hidden');
}

function togglePasswordInput() {
    const role = document.getElementById('join-role').value;
    const passField = document.getElementById('password-field');
    const guestNameField = document.getElementById('guest-name-field');
    
    // Luôn hiện ô nhập tên người trực
    guestNameField.classList.remove('hidden');

    if (role.startsWith('12A')) {
        passField.classList.remove('hidden');
    } else {
        passField.classList.add('hidden');
    }
}

function updateStatus(status, color = 'green') {
    const text = document.getElementById('connection-status-text');
    const dot = document.getElementById('connection-status-dot');
    text.textContent = status;
    dot.className = `w-2 h-2 rounded-full ${color === 'green' ? 'bg-green-500' : color === 'red' ? 'bg-red-500' : 'bg-yellow-500'} ${color === 'yellow' ? 'animate-pulse' : ''}`;
}

function switchToMainApp(pin) {
    document.getElementById('login-screen').classList.add('hidden');
    const app = document.getElementById('main-app');
    app.classList.remove('hidden');
    setTimeout(() => app.classList.remove('opacity-0'), 100);
    
    document.getElementById('display-name').textContent = currentUser.name || currentUser.role;
    document.getElementById('display-role').textContent = currentUser.role;
    
    if(pin) {
        document.getElementById('display-pin').textContent = pin;
        document.getElementById('pin-container').classList.remove('hidden');
    }
    if (currentUser.role === 'HOST') {
        document.getElementById('clear-all-btn').classList.remove('hidden');
        document.getElementById('connected-users-bubble').classList.remove('hidden'); // Show bubble for Host
    }
    
    // Tự động kiểm tra thiết bị để set toggle Enter
    const isMobile = window.innerWidth <= 768;
    document.getElementById('enter-to-send').checked = !isMobile;
}

function copyPin() {
    const pin = document.getElementById('display-pin').textContent;
    navigator.clipboard.writeText(pin);
    showToast('Đã copy', 'Đã sao chép mã phòng');
}

function logout() {
    if(confirm('Bạn có chắc muốn thoát? Kết nối sẽ bị ngắt.')) {
        if(peer) peer.destroy();
        location.reload();
    }
}

// --- HOST UI LOGIC (BUBBLE) ---
function toggleUserList() {
    const popover = document.getElementById('user-list-popover');
    popover.classList.toggle('hidden');
}

function updateUserListUI() {
    const badge = document.getElementById('user-count-badge');
    const listUl = document.getElementById('user-list-ul');
    
    badge.textContent = connections.length;
    
    if (connections.length === 0) {
        listUl.innerHTML = '<li class="text-gray-500 text-xs text-center p-2 italic">Chưa có ai kết nối...</li>';
        return;
    }

    let html = '';
    connections.forEach(conn => {
        const meta = conn.metadata || { name: 'Không tên', role: '?' };
        // Icon based on role
        let icon = 'fa-user';
        let colorClass = 'text-gray-400';
        if (meta.role.startsWith('12A')) { icon = 'fa-users'; colorClass = 'text-blue-400'; }
        else if (meta.role === 'MONITOR') { icon = 'fa-user-shield'; colorClass = 'text-green-400'; }

        html += `
        <li class="flex items-center justify-between p-2 bg-gray-800 rounded border border-gray-700 hover:bg-gray-700 transition-colors">
            <div class="flex items-center gap-2 overflow-hidden">
                <div class="w-8 h-8 rounded-full bg-gray-900 flex items-center justify-center shrink-0 border border-gray-600">
                    <i class="fa-solid ${icon} ${colorClass} text-xs"></i>
                </div>
                <div class="min-w-0">
                    <p class="text-xs font-bold text-gray-200 truncate">${meta.name}</p>
                    <p class="text-[10px] text-gray-400 font-mono">${meta.role}</p>
                </div>
            </div>
            <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" title="Online"></span>
        </li>`;
    });
    listUl.innerHTML = html;
}

// --- P2P LOGIC ---

// 1. CREATE ROOM (HOST)
function createRoom() {
    const name = document.getElementById('host-name').value.trim();
    if (!name) return showToast('Lỗi', 'Nhập tên giám thị', 'error');

    currentUser = { name: name, role: 'HOST' };
    isHost = true;
    
    // Generate a simpler ID for PeerJS
    // Format: GT-XXXXXX (GT = GiamThi)
    const randomPin = Math.floor(100000 + Math.random() * 900000);
    myId = `GT-${randomPin}`;
    hostId = myId; // Set hostId for host so export works

    initPeer(myId);
}

// 2. JOIN ROOM (CLIENT)
function joinRoom() {
    const pin = document.getElementById('join-pin').value.trim();
    const role = document.getElementById('join-role').value;
    const inputName = document.getElementById('guest-name').value.trim();
    
    if (!pin || pin.length !== 6) return showToast('Lỗi', 'Mã PIN gồm 6 số', 'error');
    if (!role) return showToast('Lỗi', 'Chọn vai trò', 'error');
    if (!inputName) return showToast('Lỗi', 'Vui lòng nhập tên người trực', 'error');

    let finalName = inputName;
    
    // Password check for classes
    if (role.startsWith('12A')) {
        const pass = document.getElementById('join-password').value;
        if (pass !== CLASS_PASSWORDS[role]) return showToast('Lỗi', 'Sai mật khẩu lớp!', 'error');
    }

    currentUser = { name: finalName, role: role };
    isHost = false;
    hostId = `GT-${pin}`;
    
    // Client gets a random ID
    initPeer();
}

function initPeer(customId = null) {
    showToast('Hệ thống', 'Đang khởi tạo kết nối...');
    
    // Config PeerJS
    peer = new Peer(customId); 

    peer.on('open', (id) => {
        console.log('My Peer ID:', id);
        if (isHost) {
            // Host Setup
            const pin = id.replace('GT-', '');
            switchToMainApp(pin);
            updateStatus(`Máy chủ đang chạy`, 'green');
            loadDataLocal(); // Load data saved in Host's browser
            renderReport();
            updateUserListUI();
        } else {
            // Client Setup: Connect to Host
            connectToHost(hostId);
            switchToMainApp();
        }
    });

    peer.on('connection', (conn) => {
        // Only Host receives incoming connections usually
        if (isHost) {
            handleIncomingConnection(conn);
        }
    });

    peer.on('error', (err) => {
        console.error(err);
        if(err.type === 'unavailable-id') {
            alert('Mã phòng này đang được sử dụng hoặc chưa đóng hẳn. Hãy thử lại.');
            location.reload();
        } else if(err.type === 'peer-unavailable') {
            showToast('Lỗi', 'Không tìm thấy phòng! Hãy kiểm tra mã PIN.', 'error');
            updateStatus('Không tìm thấy Host', 'red');
        } else {
            showToast('Lỗi', 'Lỗi kết nối P2P.', 'error');
        }
    });
}

// --- HOST LOGIC ---
function handleIncomingConnection(c) {
    // Khi có kết nối mới, đợi nó mở để lấy metadata
    c.on('open', () => {
        // Thêm vào danh sách connections
        connections.push(c);
        
        // Lấy thông tin từ metadata (nếu có)
        const clientName = c.metadata?.name || 'Ẩn danh';
        const clientRole = c.metadata?.role || 'Unknown';
        
        showToast('Kết nối mới', `${clientName} (${clientRole}) đã vào phòng`);
        updateStatus(`Đã kết nối ${connections.length} máy`, 'green');
        
        // Update danh sách user UI
        updateUserListUI();

        // Gửi dữ liệu hiện tại cho máy mới
        c.send({ type: 'SYNC_FULL', data: violationsData });
    });

    c.on('data', (data) => {
        handleDataPacket(data);
    });

    c.on('close', () => {
        // Xóa khỏi danh sách
        connections = connections.filter(conn => conn !== c);
        updateStatus(`Đã kết nối ${connections.length} máy`, 'green');
        updateUserListUI();
    });
    
    // Xử lý khi mất kết nối đột ngột
    c.on('error', () => {
            connections = connections.filter(conn => conn !== c);
            updateUserListUI();
    });
}

function broadcast(packet) {
    connections.forEach(c => {
        if(c.open) c.send(packet);
    });
}

// --- CLIENT LOGIC ---
function connectToHost(id) {
    updateStatus('Đang tìm máy chủ...', 'yellow');
    
    // Gửi kèm thông tin (metadata) khi kết nối
    conn = peer.connect(id, {
        metadata: {
            name: currentUser.name,
            role: currentUser.role
        }
    });

    conn.on('open', () => {
        updateStatus('Đã kết nối với Giám Thị', 'green');
        showToast('Thành công', 'Đã vào phòng!');
    });

    conn.on('data', (data) => {
        handleDataPacket(data);
    });

    conn.on('close', () => {
        updateStatus('Mất kết nối Host', 'red');
        showToast('Lỗi', 'Host đã thoát hoặc mất mạng.', 'error');
    });
    
    conn.on('error', () => {
        updateStatus('Lỗi kết nối', 'red');
    });
}

// --- DATA HANDLING (BOTH) ---
function handleDataPacket(packet) {
    if (packet.type === 'SYNC_FULL') {
        violationsData = packet.data;
        renderReport();
        if(isHost) saveDataLocal();
    } else if (packet.type === 'ADD_ITEMS') {
        // Received new items
        violationsData = [...violationsData, ...packet.items];
        renderReport();
        
        if (isHost) {
            saveDataLocal();
            broadcast({ type: 'SYNC_FULL', data: violationsData });
        }
    } else if (packet.type === 'REMOVE_ITEM') {
        violationsData = violationsData.filter(v => v.id !== packet.id);
        renderReport();
        if(isHost) {
            saveDataLocal();
            broadcast({ type: 'SYNC_FULL', data: violationsData });
        }
    } else if (packet.type === 'CLEAR_ALL') {
        violationsData = [];
        renderReport();
        if(isHost) saveDataLocal();
    }
}

function sendData(packet) {
    if (isHost) {
        // If Host generates data, handle locally then broadcast
        handleDataPacket(packet);
    } else {
        // If Client, send to Host
        if (conn && conn.open) {
            conn.send(packet);
        } else {
            showToast('Lỗi', 'Chưa kết nối Host', 'error');
        }
    }
}

// --- STORAGE (HOST ONLY) ---
function saveDataLocal() {
    if(isHost) localStorage.setItem('GiamThiAI_P2P_Data', JSON.stringify(violationsData));
}
function loadDataLocal() {
    const saved = localStorage.getItem('GiamThiAI_P2P_Data');
    if(saved) {
        try { violationsData = JSON.parse(saved); } catch(e) {}
    }
}

// --- PROCESSING LOGIC (SAME AS BEFORE) ---
const toTitleCase = str => str.toLowerCase().replace(/(^|\s)\S/g, l => l.toUpperCase());
const removeAccents = str => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');

const detectViolation = (text) => {
    const normalized = removeAccents(text.toLowerCase()).trim();
    for (const code in VIOLATION_MAP) {
        if (VIOLATION_MAP[code].keys.some(key => normalized.includes(key))) return VIOLATION_MAP[code].label;
    }
    return toTitleCase(text);
};

const smartParse = (rawText) => {
    const lines = rawText.split(/\n+/);
    const results = [];
    const classRegex = /\b([1-9][0-2]?[a-zA-Z][0-9]{0,2})\b/;
    const now = new Date().toISOString(); 
    
    lines.forEach(line => {
        line = line.trim().replace(/\s+/g, ' ');
        if (!line) return;
        let name = '', className = '', violation = '';
        const classMatch = line.match(classRegex);
        
        if (classMatch) {
            className = classMatch[0].toUpperCase();
            name = line.substring(0, classMatch.index).replace(/[-–]/g, '').trim();
            violation = line.substring(classMatch.index + className.length).replace(/[-–]/g, '').trim();
        } else {
            const parts = line.split(/[-–]/);
            if (parts.length >= 2) {
                name = parts[0].trim();
                violation = parts[parts.length - 1].trim();
                if (parts.length > 2) className = parts[1].trim().toUpperCase();
            } else {
                name = line;
                violation = 'Chưa xác định';
            }
        }
        
        if (name) {
            results.push({
                id: Date.now() + Math.random().toString(), 
                name: toTitleCase(name),
                class: className || '?',
                violation: detectViolation(violation),
                time: now,
                reporter: currentUser.name 
            });
        }
    });
    return results;
};

const renderReport = () => {
    const container = document.getElementById('report-container');
    document.getElementById('count-badge').textContent = violationsData.length;
    
    if (violationsData.length === 0) {
        container.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-gray-500 opacity-60"><i class="fa-solid fa-clipboard-check text-6xl mb-4"></i><p>Không tìm thấy vi phạm nào</p></div>`;
        return;
    }

    const groupedData = {};
    violationsData.forEach(s => { 
        const v = s.violation || 'Lỗi khác'; 
        if (!groupedData[v]) groupedData[v] = []; 
        groupedData[v].push(s); 
    });

    let html = '';
    let sttTotal = 1;
    
    for (const [vName, students] of Object.entries(groupedData)) {
        html += `
        <div class="mb-6 animate-fade-in">
            <div class="bg-gray-700/50 backdrop-blur-sm p-3 rounded-t-lg border-b border-gray-600 flex justify-between items-center sticky top-0 z-10">
                <h4 class="font-bold text-blue-400 uppercase text-sm flex items-center gap-2"><i class="fa-solid fa-circle-exclamation"></i>${vName}</h4>
                <span class="bg-blue-900/50 text-blue-200 text-xs px-2 py-1 rounded-full font-mono">${students.length}</span>
            </div>
            <table class="w-full text-left border-collapse bg-gray-800/40 rounded-b-lg overflow-hidden">
                <thead class="bg-gray-800/60 text-xs uppercase text-gray-400">
                    <tr>
                        <th class="p-3 w-10 text-center">#</th>
                        ${displaySettings.time ? '<th class="p-3 w-16 text-center">Giờ</th>' : ''}
                        ${displaySettings.name ? '<th class="p-3">Họ và Tên</th>' : ''}
                        ${displaySettings.class ? '<th class="p-3 w-20 text-center">Lớp</th>' : ''}
                        ${displaySettings.reporter ? '<th class="p-3 w-20 text-right text-[10px]">Người báo</th>' : ''}
                        <th class="p-3 w-8"></th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-700/50">`;
        
        students.forEach(s => {
            const timeStr = new Date(s.time).toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit'});
            html += `
            <tr class="hover:bg-gray-700/30 transition-colors group">
                <td class="p-3 text-gray-500 font-mono text-sm text-center">${sttTotal++}</td>
                ${displaySettings.time ? `<td class="p-3 text-gray-400 font-mono text-sm text-center">${timeStr}</td>` : ''}
                ${displaySettings.name ? `<td class="p-3 font-medium text-gray-200">${s.name}</td>` : ''}
                ${displaySettings.class ? `<td class="p-3 text-center"><span class="bg-gray-700 text-yellow-400 px-2 py-1 rounded text-xs font-bold font-mono border border-gray-600">${s.class}</span></td>` : ''}
                ${displaySettings.reporter ? `<td class="p-3 text-right text-gray-500 text-[10px] italic">${s.reporter || ''}</td>` : ''}
                <td class="p-3 text-center">
                    <button onclick="deleteRow('${s.id}')" class="text-gray-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 p-1">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </td>
            </tr>`;
        });
        html += `</tbody></table></div>`;
    }
    container.innerHTML = html;
};

window.deleteRow = (id) => {
    sendData({ type: 'REMOVE_ITEM', id: id });
};

document.getElementById('clear-all-btn').addEventListener('click', () => {
    if(confirm('Xóa TẤT CẢ dữ liệu trên các máy?')) {
        sendData({ type: 'CLEAR_ALL' });
        // If Host, also clear local immediately handled by sendData->handleDataPacket logic if written carefully
            if(isHost) {
                violationsData = [];
                renderReport();
                saveDataLocal();
                broadcast({ type: 'CLEAR_ALL' });
            }
    }
});

// --- DISPLAY SETTINGS LOGIC ---
function toggleDisplayMenu() {
    document.getElementById('display-menu').classList.toggle('hidden');
}

// Close menu when clicking outside
document.addEventListener('click', (e) => {
    const menu = document.getElementById('display-menu');
    const btn = document.getElementById('toggle-display-btn');
    if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target) && !btn.contains(e.target)) {
        menu.classList.add('hidden');
    }
});

// Checkbox listeners
['time', 'name', 'class', 'reporter'].forEach(key => {
    const el = document.getElementById(`show-${key}`);
    if(el) {
        el.addEventListener('change', (e) => {
            displaySettings[key] = e.target.checked;
            renderReport();
        });
    }
});

// --- EVENT LISTENERS ---
// Create & Join buttons need explicit listeners in separated JS if not inline
document.getElementById('btn-create-room').addEventListener('click', createRoom);
document.getElementById('btn-join-room').addEventListener('click', joinRoom);
document.getElementById('btn-logout').addEventListener('click', logout);
document.getElementById('toggle-user-list-btn').addEventListener('click', toggleUserList);
document.getElementById('toggle-display-btn').addEventListener('click', toggleDisplayMenu);
document.getElementById('join-role').addEventListener('change', togglePasswordInput);

document.getElementById('process-btn').addEventListener('click', () => {
    const input = document.getElementById('text-input');
    if (!input.value.trim()) return showToast('Lỗi', 'Nhập dữ liệu!', 'error');
    
    const newStudents = smartParse(input.value);
    if(newStudents.length > 0) {
        sendData({ type: 'ADD_ITEMS', items: newStudents });
        input.value = '';
        showToast('Gửi', `Đã gửi ${newStudents.length} lỗi`);
    } else {
        showToast('Thông tin', 'Không nhận dạng được', 'warning');
    }
});

// --- FIX: Restore Enter to Send functionality with Toggle ---
document.getElementById('text-input').addEventListener('keydown', (e) => {
    // Kiểm tra xem nút gạt có đang bật không
    const enterToSend = document.getElementById('enter-to-send').checked;
    
    // Nếu bật chế độ "Enter gửi" VÀ không giữ phím Shift
    if (enterToSend && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); // Ngăn xuống dòng
        document.getElementById('process-btn').click(); // Gửi luôn
    }
    // Ngược lại (Tắt chế độ hoặc giữ Shift): Mặc định là xuống dòng
});

// OCR & Voice (Same as old logic)
document.getElementById('ocr-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('ocr-loading').classList.remove('hidden');
    try {
        const worker = Tesseract.createWorker({ logger: m => { 
            if(m.status === 'recognizing text') document.getElementById('ocr-progress').style.width = `${Math.round(m.progress * 100)}%`; 
        }});
        await worker.load(); await worker.loadLanguage('eng'); await worker.initialize('eng');
        const { data: { text } } = await worker.recognize(file);
        document.getElementById('text-input').value += '\n' + text;
        await worker.terminate();
    } catch { showToast('Lỗi', 'OCR thất bại', 'error'); } 
    finally { document.getElementById('ocr-loading').classList.add('hidden'); e.target.value = ''; }
});

if ('webkitSpeechRecognition' in window) {
    const recognition = new webkitSpeechRecognition();
    recognition.continuous = false; recognition.lang = 'vi-VN';
    document.getElementById('mic-btn').addEventListener('click', () => {
        recognition.start();
        document.querySelector('.mic-pulse').classList.add('active');
    });
    recognition.onresult = event => document.getElementById('text-input').value += event.results[0][0].transcript + '\n';
    recognition.onend = () => document.querySelector('.mic-pulse').classList.remove('active');
} else { document.getElementById('mic-btn').style.display = 'none'; }

// Export PNG (Fixed)
document.getElementById('export-png-btn').addEventListener('click', () => {
    if (violationsData.length === 0) return showToast('Lỗi', 'Chưa có dữ liệu để xuất', 'error');
    
    showToast('Đang xử lý', 'Đang tạo phiếu báo cáo...');
    
    // 1. Tạo container ẩn để render phiếu
    const exportDiv = document.createElement('div');
    Object.assign(exportDiv.style, { 
        position: 'fixed', top: '0', left: '-9999px', zIndex: '9999', 
        width: '800px', backgroundColor: '#ffffff', color: '#1a1a1a', 
        fontFamily: "'Be Vietnam Pro', sans-serif", padding: '40px', boxSizing: 'border-box' 
    });

    // 2. Chuẩn bị dữ liệu
    const groupedData = {};
    violationsData.forEach(s => { 
        const v = s.violation || 'Lỗi khác'; 
        if (!groupedData[v]) groupedData[v] = []; 
        groupedData[v].push(s); 
    });

    // 3. Render HTML danh sách lỗi
    let groupsHtml = '';
    let sttTotal = 1;
    const formatTime = (iso) => new Date(iso).toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit'});

    for (const [vName, students] of Object.entries(groupedData)) {
        let studentsHtml = '';
        students.forEach(s => {
            studentsHtml += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 10px; color: #64748b; font-weight: 600; text-align: center; width: 50px;">${sttTotal++}</td>
                    <td style="padding: 10px; color: #64748b; font-family: monospace; font-size: 13px; text-align: center; width: 80px;">${formatTime(s.time)}</td>
                    <td style="padding: 10px;"><span style="font-weight: 700; color: #1e293b; text-transform: uppercase; font-size: 14px;">${s.name}</span></td>
                    <td style="padding: 10px; text-align: center;"><span style="background-color: #e2e8f0; color: #475569; padding: 4px 8px; border-radius: 6px; font-weight: 700; font-size: 13px;">${s.class}</span></td>
                    <td style="padding: 10px; text-align: right; color: #94a3b8; font-style: italic; font-size: 12px;">${s.reporter || ''}</td>
                </tr>`;
        });
        groupsHtml += `
            <div style="margin-bottom: 25px;">
                <div style="background-color: #eff6ff; border-left: 5px solid #2563eb; padding: 10px 15px; margin-bottom: 10px;">
                    <h3 style="margin: 0; font-size: 16px; font-weight: 800; color: #1e40af; text-transform: uppercase;">
                        ${vName} <span style="font-weight: normal; font-size: 13px; color: #64748b; margin-left: 5px;">(${students.length} HS)</span>
                    </h3>
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                    <thead style="background-color: #f8fafc; color: #64748b; font-size: 12px; text-transform: uppercase;">
                        <tr>
                            <th style="padding: 8px;">STT</th>
                            <th style="padding: 8px;">Giờ</th>
                            <th style="padding: 8px; text-align: left;">Họ Tên</th>
                            <th style="padding: 8px;">Lớp</th>
                            <th style="padding: 8px; text-align: right;">Người báo</th>
                        </tr>
                    </thead>
                    <tbody>${studentsHtml}</tbody>
                </table>
            </div>`;
    }

    // 4. Render phần Header và Footer
    const logoHtml = `<img src="https://files.catbox.moe/jyg7qk.webp" style="width: 80px; height: 80px; object-fit: contain; display: block; margin: 0 auto 15px;" crossorigin="anonymous">`;
    const dateStr = new Date().toLocaleDateString('vi-VN');
    const roleText = currentUser.role === 'HOST' ? `Giám thị: ${currentUser.name}` : `Người xuất: ${currentUser.name} (${currentUser.role})`;

    exportDiv.innerHTML = `
        <div style="border: 2px solid #e5e7eb; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);">
            <div style="background-color: #0d0deb; color: white; padding: 30px 20px; text-align: center;">
                ${logoHtml}
                <h2 style="margin: 0; font-size: 18px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; opacity: 0.9;">TRUNG TÂM GDTX - NN, TH TỈNH LÂM ĐỒNG</h2>
                <h1 style="margin: 10px 0 0; font-size: 28px; font-weight: 800; text-transform: uppercase;">Phiếu Ghi Nhận Vi Phạm</h1>
            </div>
            <div style="padding: 20px; background-color: #f8fafc; border-bottom: 2px solid #e5e7eb; font-size: 14px; display: flex; justify-content: space-between;">
                <div>
                    <div><span style="color: #64748b; font-weight: 600;">Ngày:</span> <b>${dateStr}</b></div>
                    <div><span style="color: #64748b; font-weight: 600;">Mã phòng:</span> <b>#${hostId.replace('GT-','') || 'OFFLINE'}</b></div>
                </div>
                <div style="text-align: right;">
                        <div>${roleText}</div>
                        <div><span style="color: #64748b; font-weight: 600;">Tổng lỗi:</span> <b style="color: #dc2626;">${violationsData.length}</b></div>
                </div>
            </div>
            <div style="padding: 30px;">${groupsHtml}</div>
            <div style="background-color: #f1f5f9; padding: 15px; text-align: center; color: #64748b; font-size: 12px; border-top: 1px solid #e2e8f0;">
                Phiếu được xuất tự động từ hệ thống Trợ Lý Giám Thị AI
            </div>
        </div>
    `;

    document.body.appendChild(exportDiv);

    // 5. Chụp ảnh bằng html2canvas
    setTimeout(() => {
        html2canvas(exportDiv, { scale: 2, useCORS: true, backgroundColor: '#ffffff' }).then(canvas => {
            const link = document.createElement('a');
            link.download = `Phieu_Vi_Pham_${dateStr.replace(/\//g,'-')}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            document.body.removeChild(exportDiv);
            showToast('Thành công', 'Đã tải phiếu xuống');
        }).catch(err => {
            console.error(err);
            if (document.body.contains(exportDiv)) document.body.removeChild(exportDiv);
            showToast('Lỗi', 'Không thể tạo ảnh (Lỗi CORS hoặc thư viện)', 'error');
        });
    }, 500); // Đợi render xong
});

// Export Excel (Simplified)
document.getElementById('export-excel-btn').addEventListener('click', () => {
    if(violationsData.length === 0) return;
    const wb = XLSX.utils.book_new();
    const wsData = [['STT', 'Thời gian', 'Họ Tên', 'Lớp', 'Lỗi', 'Người báo']];
    violationsData.forEach((s, i) => wsData.push([i+1, new Date(s.time).toLocaleString(), s.name, s.class, s.violation, s.reporter]));
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, "ViPham");
    XLSX.writeFile(wb, `DS_Loi_${hostId || 'Offline'}.xlsx`);
});

// Clock
setInterval(() => document.getElementById('realtime-clock').textContent = new Date().toLocaleTimeString('vi-VN', { hour12: false }), 1000);