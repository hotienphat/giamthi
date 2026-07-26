// Có thể thay broker hoặc giới hạn tại một nơi mà không cần build lại dự án.
window.GIAMTHI_CONFIG = Object.freeze({
    version: 4,
    brokers: Object.freeze([
        'wss://broker.emqx.io:8084/mqtt',
        'wss://test.mosquitto.org:8081/mqtt'
    ]),
    limits: Object.freeze({
        maxRecords: 3000,
        maxItemsPerOperation: 200,
        maxPayloadBytes: 262144,
        maxExcelBytes: 5242880,
        maxImageBytes: 8388608,
        maxJsonBytes: 5242880
    })
});
