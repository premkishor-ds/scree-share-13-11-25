// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const multer = require('multer');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});

const recordingsDir = path.join(__dirname, 'recordings');
const screenDir = path.join(recordingsDir, 'screen');
[recordingsDir, screenDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const commonFilename = (file, req) => {
    const originalExtension = path.extname(file.originalname) || '.webm';
    const safeExtension = originalExtension.slice(0, 10) || '.webm';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rawUsername = req && req.body && req.body.username ? String(req.body.username) : '';
    const safeUsername = rawUsername.toLowerCase().replace(/[^a-z0-9-_]/g, '') || 'user';
    return `recording-${safeUsername}-${timestamp}${safeExtension}`;
};

const screenStorage = multer.diskStorage({
    destination: screenDir,
    filename: (req, file, cb) => cb(null, commonFilename(file, req)),
});

const uploadScreen = multer({ storage: screenStorage });
const chunkMemoryStorage = multer.memoryStorage();
const uploadScreenChunk = multer({ storage: chunkMemoryStorage });

const chunkSessions = new Map();

app.use(cors({ origin: '*' }));
app.use(express.static('public'));
app.get('/view/:username.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'view.html'));
});
app.use('/recordings', express.static(recordingsDir));
app.use('/recordings/screen', express.static(screenDir));
// no camera static path; broadcaster is served from separate static frontend

// Separate endpoints for screen and camera recordings
app.post('/api/recordings/screen', uploadScreen.single('recording'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No recording file received' });
    res.json({ fileName: req.file.filename, fileUrl: `/recordings/screen/${req.file.filename}` });
});

app.post('/api/recordings/screen/chunk', uploadScreenChunk.single('recording'), (req, res) => {
    try {
        const { uploadId, index, isLast } = req.body || {};
        if (!uploadId) {
            return res.status(400).json({ error: 'Missing uploadId' });
        }
        if (!req.file || !req.file.buffer || !req.file.buffer.length) {
            return res.status(400).json({ error: 'No recording chunk received' });
        }

        let session = chunkSessions.get(uploadId);
        if (!session) {
            const rawUsername = req.body && req.body.username ? String(req.body.username) : '';
            const safeUsername = rawUsername.toLowerCase().replace(/[^a-z0-9-_]/g, '') || 'user';
            const extension = path.extname(req.file.originalname) || '.webm';
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const baseName = `recording-${safeUsername}-${timestamp}${extension}`;
            const filePath = path.join(screenDir, baseName);
            fs.writeFileSync(filePath, req.file.buffer);
            session = { filePath, fileName: baseName };
            chunkSessions.set(uploadId, session);
        } else {
            fs.appendFileSync(session.filePath, req.file.buffer);
        }

        const last = String(isLast).toLowerCase() === 'true' || String(isLast) === '1';
        if (last) {
            chunkSessions.delete(uploadId);
            return res.json({ fileName: session.fileName, fileUrl: `/recordings/screen/${session.fileName}` });
        }

        return res.json({ ok: true, uploadId, index: typeof index !== 'undefined' ? Number(index) : null });
    } catch (err) {
        console.error('Error handling screen chunk upload:', err);
        return res.status(500).json({ error: 'Failed to process recording chunk' });
    }
});

// Simple signaling: broadcaster announces itself, watchers ask to view
// Track both the broadcaster socket id and the logical username of the
// broadcaster so that /view/<username>.html only sees the correct stream.
let BROADCASTER_ID = null;
let BROADCASTER_USERNAME = null;

io.on('connection', socket => {
    console.log('Client connected:', socket.id);


    socket.on('broadcaster', (payload) => {
        const username = payload && typeof payload.username === 'string'
            ? payload.username.trim()
            : '';

        BROADCASTER_ID = socket.id;
        BROADCASTER_USERNAME = username || null;

        console.log('Broadcaster is:', BROADCASTER_ID, 'username:', BROADCASTER_USERNAME);

        // Notify viewers that a broadcaster is available, including username
        socket.broadcast.emit('broadcaster', { username: BROADCASTER_USERNAME });
    });


    socket.on('stop-broadcast', () => {
        if (socket.id === BROADCASTER_ID) {
            BROADCASTER_ID = null;
            BROADCASTER_USERNAME = null;
            socket.broadcast.emit('broadcaster-stopped');
            console.log('Broadcaster stopped via stop-broadcast event');
        }
    });


    socket.on('watcher', (payload) => {
        const requestedUsername = payload && typeof payload.username === 'string'
            ? payload.username.trim()
            : '';

        if (!BROADCASTER_ID) {
            console.log('No broadcaster available for watcher', socket.id);
            socket.emit('no-broadcaster');
            return;
        }

        // If we have an associated broadcaster username, enforce that only
        // viewers for that username can connect to the live stream.
        if (!BROADCASTER_USERNAME || !requestedUsername || requestedUsername !== BROADCASTER_USERNAME) {
            console.log('Watcher', socket.id, 'requested username', requestedUsername,
                'but active broadcaster username is', BROADCASTER_USERNAME, '- denying');
            socket.emit('no-broadcaster');
            return;
        }

        console.log('Watcher', socket.id, '-> notify broadcaster', BROADCASTER_ID, 'for username', requestedUsername);
        socket.to(BROADCASTER_ID).emit('watcher', socket.id);
    });


    socket.on('offer', (id, message) => {
        // message is SDP from broadcaster to a watcher
        console.log('offer from broadcaster ->', id);
        socket.to(id).emit('offer', socket.id, message);
    });


    socket.on('answer', (id, message) => {
        // message is SDP from watcher to broadcaster
        console.log('answer from watcher', socket.id, '-> broadcaster', id);
        socket.to(id).emit('answer', socket.id, message);
    });


    socket.on('candidate', (id, message) => {
        socket.to(id).emit('candidate', socket.id, message);
    });


    socket.on('recording-ready', payload => {
        if (socket.id === BROADCASTER_ID) {
            const enriched = {
                ...(payload || {}),
                username: BROADCASTER_USERNAME || null,
            };
            socket.broadcast.emit('recording-ready', enriched);
            console.log('Notified viewers about recording:', enriched);
        }
    });


    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        if (socket.id === BROADCASTER_ID) {
            BROADCASTER_ID = null;
            BROADCASTER_USERNAME = null;
            socket.broadcast.emit('broadcaster-stopped');
            console.log('Broadcaster stopped');
        } else if (BROADCASTER_ID) {
            socket.to(BROADCASTER_ID).emit('disconnectPeer', socket.id);
        }
    });
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));