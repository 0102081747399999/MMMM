// server.js - Lightweight local HTTP server for RED MAGIC POS (Zero dependencies)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 3000;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// In-memory SMS queue for real-time mobile sync
let receivedSmsQueue = [];
const SMS_LOG_FILE = path.join(__dirname, 'sms_inbox_log.json');
const POS_DATA_FILE = path.join(__dirname, 'pos_data.json');

// In-memory cache for POS data
let localPosData = {
  products: [],
  salesInvoices: [],
  drawer: null,
  vodafoneLines: [],
  vodafoneTransactions: [],
  lastUpdated: null
};

// Load existing POS data if present on disk
try {
  if (fs.existsSync(POS_DATA_FILE)) {
    const rawData = fs.readFileSync(POS_DATA_FILE, 'utf8');
    localPosData = JSON.parse(rawData);
    console.log(`📦 تم تحميل بيانات المخزن والمبيعات من القرص (${(localPosData.products || []).length} صنف بالمخزن، ${(localPosData.salesInvoices || []).length} فاتورة مبيعات)`);
  }
} catch (e) {
  console.warn('⚠️ يتعذر قراءة pos_data.json، سيتم إنشاء ملف جديد عند الحفظ:', e.message);
}

function savePosData(data) {
  try {
    if (!data || typeof data !== 'object') return;
    localPosData = {
      ...localPosData,
      ...data,
      lastUpdated: new Date().toISOString()
    };
    // Safe write
    const tempFile = POS_DATA_FILE + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(localPosData, null, 2), 'utf8');
    fs.renameSync(tempFile, POS_DATA_FILE);
  } catch (err) {
    console.error('Failed to save POS data to disk:', err);
  }
}

// Load existing SMS log if present
try {
  if (fs.existsSync(SMS_LOG_FILE)) {
    const raw = fs.readFileSync(SMS_LOG_FILE, 'utf8');
    receivedSmsQueue = JSON.parse(raw);
  }
} catch (e) {
  receivedSmsQueue = [];
}

function saveSmsLog() {
  try {
    fs.writeFileSync(SMS_LOG_FILE, JSON.stringify(receivedSmsQueue.slice(0, 100), null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to write SMS log:', e);
  }
}

function getLanIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name in interfaces) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURI(urlObj.pathname);

  // ==========================================
  // API ENDPOINT: SMS Webhook (Android Forwarder)
  // ==========================================
  if (pathname === '/api/sms-webhook' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        let payload = {};
        if (body.startsWith('{')) {
          payload = JSON.parse(body);
        } else {
          // urlencoded or plain text
          try {
            const params = new URLSearchParams(body);
            params.forEach((v, k) => { payload[k] = v; });
          } catch(err) {
            payload = { message: body };
          }
        }

        const sender = payload.from || payload.sender || payload.phone_number || payload.address || 'VF-Cash';
        const message = payload.message || payload.body || payload.text || payload.content || body;
        const sim = payload.sim || payload.slot || payload.sim_slot || payload.sim_number || '';
        const timestamp = payload.timestamp || new Date().toISOString();

        const smsItem = {
          id: 'sms_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          sender,
          message,
          sim,
          receivedAt: new Date().toISOString(),
          timestamp
        };

        receivedSmsQueue.unshift(smsItem);
        if (receivedSmsQueue.length > 200) receivedSmsQueue.pop();
        saveSmsLog();

        console.log(`\n📩 [SMS وارد جديد] من: ${sender} | الشريحة: ${sim}`);
        console.log(`   نص الرسالة: ${message}\n`);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, received: true, id: smsItem.id }));
      } catch (err) {
        console.error('Error handling SMS webhook:', err);
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // ==========================================
  // API ENDPOINT: Get Recent SMS Messages
  // ==========================================
  if (pathname === '/api/recent-sms' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      shop: 'سنترال حلمي',
      sms: receivedSmsQueue.slice(0, 50)
    }));
    return;
  }

  // ==========================================
  // API ENDPOINT: Clear SMS Log
  // ==========================================
  if (pathname === '/api/clear-sms' && req.method === 'POST') {
    receivedSmsQueue = [];
    saveSmsLog();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, message: 'SMS log cleared' }));
    return;
  }

  // ==========================================
  // API ENDPOINT: POS Data Storage (Products, Sales, Drawer, Lines)
  // ==========================================
  if (pathname === '/api/pos-data' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      shop: 'سنترال حلمي',
      data: localPosData
    }));
    return;
  }

  if (pathname === '/api/pos-data' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        savePosData(payload);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, message: 'POS data saved successfully to disk' }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // ==========================================
  // API ENDPOINT: Network Info (IPs for Mobile)
  // ==========================================
  if (pathname === '/api/network-info' && req.method === 'GET') {
    const ips = getLanIPs();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      shop: 'سنترال حلمي',
      port: PORT,
      ips,
      urls: ips.map(ip => `http://${ip}:${PORT}`)
    }));
    return;
  }

  // ==========================================
  // STATIC FILE SERVING
  // ==========================================
  let reqPath = pathname;
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

  const fullPath = path.join(__dirname, reqPath);

  fs.stat(fullPath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(fullPath).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('========================================================');
  console.log('  نظام ريد ماجيك سنترال وموبايل (RED MAGIC POS) يعمل بنجاح! ');
  console.log('========================================================');
  console.log(`- افتح من هذا الجهاز:         http://localhost:${PORT}`);
  
  const ips = getLanIPs();
  ips.forEach(ip => {
    console.log(`- افتح من الموبايل أو أي جهاز: http://${ip}:${PORT}`);
  });
  console.log(`- رابط استلام رسائل الكاش:   http://${ips[0] || 'localhost'}:${PORT}/api/sms-webhook`);
  console.log('========================================================');
});
