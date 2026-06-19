const fs = require('fs');
const https = require('https');

const DB_PATH = '/app/data/9router.db';
const REPO_PATH = '/repos/purujawa06-bot/9router/contents/9router.db';
const TOKEN = process.env.TOKEN_GH;

function isSQLiteValid(filePath) {
    if (!fs.existsSync(filePath)) return false;
    // SQLite selalu diawali dengan string "SQLite format 3"
    const buffer = Buffer.alloc(16);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, 16);
    fs.closeSync(fd);
    return buffer.toString().includes('SQLite format 3');
}

function downloadDatabase() {
    // 1. Jika database lokal sudah ada dan valid, JANGAN DOWNLOAD
    if (isSQLiteValid(DB_PATH)) {
        console.log('[Sync] Database lokal valid, skip download.');
        return;
    }

    console.log('[Sync] Mendownload database dari GitHub...');
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
        
        const tempPath = DB_PATH + '.tmp';
        const file = fs.createWriteStream(tempPath);
        res.pipe(file);
        
        file.on('finish', () => {
            // 2. Hanya timpa jika hasil download-nya valid format SQLite
            if (isSQLiteValid(tempPath)) {
                fs.renameSync(tempPath, DB_PATH);
                console.log('[Sync] Database berhasil dipulihkan dari GitHub!');
            } else {
                console.log('[Sync] File di GitHub bukan database valid, mengabaikan...');
                fs.unlinkSync(tempPath);
            }
        });
    });
}

function uploadDatabase() {
    if (!isSQLiteValid(DB_PATH)) return; // Jangan upload file rusak

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
