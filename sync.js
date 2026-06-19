const fs = require('fs');
const https = require('https');

const DB_PATH = '/app/data/9router.db';
const REPO_PATH = '/repos/purujawa06-bot/9router/contents/9router.db';
const TOKEN = process.env.TOKEN_GH;

// Fungsi untuk download database dari GitHub ke container saat startup
function downloadDatabase() {
    if (fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).size > 0) {
        console.log('[Sync] Database lokal ditemukan, lanjut start...');
        return;
    }

    console.log('[Sync] Database kosong/tidak ada, mendownload dari GitHub...');
    const options = {
        hostname: 'api.github.com',
        path: REPO_PATH,
        method: 'GET',
        headers: { 
            'Authorization': `token ${TOKEN}`, 
            'User-Agent': 'Node-App',
            'Accept': 'application/vnd.github.v3.raw' 
        }
    };

    https.get(options, (res) => {
        const file = fs.createWriteStream(DB_PATH);
        res.pipe(file);
        file.on('finish', () => console.log('[Sync] Database berhasil didownload!'));
    }).on('error', (err) => console.error('[Sync] Gagal download:', err.message));
}

// Fungsi untuk upload ke GitHub jika ada perubahan
function uploadDatabase() {
    if (!fs.existsSync(DB_PATH)) return;

    // Ambil SHA dari file di GitHub agar bisa di-update
    const optionsGet = {
        hostname: 'api.github.com',
        path: REPO_PATH,
        method: 'GET',
        headers: { 'Authorization': `token ${TOKEN}`, 'User-Agent': 'Node-App' }
    };

    https.get(optionsGet, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            const json = JSON.parse(data);
            const sha = json.sha;
            const localContent = fs.readFileSync(DB_PATH, { encoding: 'base64' });

            // Hanya upload jika isi file berbeda (cek sederhana)
            if (json.content && json.content.replace(/\n/g, '') === localContent) return;

            const body = JSON.stringify({
                message: 'chore: auto-sync 9router.db',
                content: localContent,
                sha: sha
            });

            const optionsPut = {
                hostname: 'api.github.com',
                path: REPO_PATH,
                method: 'PUT',
                headers: { 
                    'Authorization': `token ${TOKEN}`, 
                    'Content-Type': 'application/json', 
                    'User-Agent': 'Node-App' 
                }
            };

            const req = https.request(optionsPut);
            req.write(body);
            req.end();
            console.log('[Sync] Database berhasil di-push ke GitHub.');
        });
    });
}

// Eksekusi Download saat startup
downloadDatabase();

// Polling setiap 5 menit untuk upload
setInterval(uploadDatabase, 300000);
