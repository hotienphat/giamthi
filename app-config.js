// Có thể thay broker hoặc giới hạn tại một nơi mà không cần build lại dự án.
window.GIAMTHI_CONFIG = Object.freeze({
    version: 5,
    brokers: Object.freeze([
        'wss://broker.emqx.io:8084/mqtt',
        'wss://test.mosquitto.org:8081/mqtt'
    ]),
    webrtc: Object.freeze({
        iceServers: Object.freeze([
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ])
    }),
    indexedDB: Object.freeze({
        name: 'GiamThiDB_v4',
        version: 2
    }),
    backup: Object.freeze({
        autoBackupIntervalMs: 900000, // 15 phút tự động sao lưu cục bộ
        autoBackupThreshold: 20,     // hoặc mỗi 20 bản ghi mới
        googleFolder: 'TroLyGiamThi_Backups'
    }),
    limits: Object.freeze({
        maxRecords: 10000,           // Mở rộng nhờ IndexedDB
        maxItemsPerOperation: 200,
        maxPayloadBytes: 262144,
        maxExcelBytes: 10485760,     // 10 MB
        maxImageBytes: 10485760,     // 10 MB
        maxJsonBytes: 10485760,      // 10 MB
        maxRosterStudents: 5000      // Danh sách học sinh toàn trường
    })
});
