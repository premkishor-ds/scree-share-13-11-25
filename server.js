// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { randomUUID } = require('crypto');
const { Server } = require('socket.io');


const app = express();
const server = http.createServer(app);
const io = new Server(server);


const recordingsDir = path.join(__dirname, 'recordings');
if (!fs.existsSync(recordingsDir)) {
    fs.mkdirSync(recordingsDir, { recursive: true });
}


const storage = multer.diskStorage({
    destination: recordingsDir,
    filename: (req, file, cb) => {
        const originalExtension = path.extname(file.originalname) || '.webm';
        const safeExtension = originalExtension.slice(0, 10) || '.webm';
        const filename = `recording-${Date.now()}-${randomUUID()}${safeExtension}`;
        cb(null, filename);
    },
});


const upload = multer({ storage });


app.use(express.static('public'));
app.use('/recordings', express.static(recordingsDir));

app.get('/quiz.html', (req, res) => {
res.sendFile(path.join(__dirname, 'quiz.html'));
});


app.post('/api/recordings', upload.single('recording'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No recording file received' });
    }


    res.json({ fileName: req.file.filename, fileUrl: `/recordings/${req.file.filename}` });
});


// Simple signaling: broadcaster announces itself, watchers ask to view
let BROADCASTER_ID = null;


io.on('connection', socket => {
    console.log('Client connected:', socket.id);


    socket.on('broadcaster', () => {
        BROADCASTER_ID = socket.id;
        console.log('Broadcaster is:', BROADCASTER_ID);
        socket.broadcast.emit('broadcaster');
    });


    socket.on('stop-broadcast', () => {
        if (socket.id === BROADCASTER_ID) {
            BROADCASTER_ID = null;
            socket.broadcast.emit('broadcaster-stopped');
            console.log('Broadcaster stopped via stop-broadcast event');
        }
    });


    socket.on('watcher', () => {
        if (BROADCASTER_ID) {
            console.log('Watcher', socket.id, ' -> notify broadcaster', BROADCASTER_ID);
            socket.to(BROADCASTER_ID).emit('watcher', socket.id);
        } else {
            console.log('No broadcaster available for watcher', socket.id);
            socket.emit('no-broadcaster');
        }
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
            socket.broadcast.emit('recording-ready', payload);
            console.log('Notified viewers about recording:', payload);
        }
    });


    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        if (socket.id === BROADCASTER_ID) {
            BROADCASTER_ID = null;
            socket.broadcast.emit('broadcaster-stopped');
            console.log('Broadcaster stopped');
        } else if (BROADCASTER_ID) {
            socket.to(BROADCASTER_ID).emit('disconnectPeer', socket.id);
        }
    });
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));