const fs = require('fs');
const https = require('https');

// Path database yang benar sesuai log kamu
const DB_PATH = '/app/data/db/data.sqlite'; 
const REPO_PATH = '/repos/purujawa06-bot/9router/contents/db/data.sqlite';
const TOKEN = process.env.TOKEN_GH;

function isSQLiteValid(filePath) {
    if (!fs.existsSync(filePath)) return false;
    // Cek header SQLite
    const buffer = Buffer.alloc(16);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, 16);
    fs.closeSync(fd);
    return buffer.toString().includes('SQLite format 3');
}

function downloadDatabase() {
    if (isSQLiteValid(DB_PATH)) return;

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
        if (res.statusCode !== 200) return;
        
        // Pastikan folder tujuan ada
        const dir = '/app/data/db';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        
        const tempPath = DB_PATH + '.tmp';
        const file = fs.createWriteStream(tempPath);
        res.pipe(file);
        
        file.on('finish', () => {
            if (isSQLiteValid(tempPath)) {
                fs.renameSync(tempPath, DB_PATH);
                console.log('[Sync] Database berhasil dipulihkan!');
            }
        });
    });
}

function uploadDatabase() {
    if (!isSQLiteValid(DB_PATH)) return;

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

            if (json.content && json.content.replace(/\n/g, '') === localContent) return;

            const body = JSON.stringify({
                message: 'chore: auto-sync database',
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
            console.log('[Sync] Database berhasil di-push.');
        });
    });
}

downloadDatabase();
setInterval(uploadDatabase, 300000);
