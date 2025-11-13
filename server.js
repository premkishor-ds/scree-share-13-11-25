// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');


const app = express();
const server = http.createServer(app);
const io = new Server(server);


app.use(express.static('public'));


// Simple signaling: broadcaster announces itself, watchers ask to view
let BROADCASTER_ID = null;


io.on('connection', socket => {
console.log('Client connected:', socket.id);


socket.on('broadcaster', () => {
BROADCASTER_ID = socket.id;
console.log('Broadcaster is:', BROADCASTER_ID);
socket.broadcast.emit('broadcaster');
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


socket.on('disconnect', () => {
console.log('Client disconnected:', socket.id);
if (socket.id === BROADCASTER_ID) {
BROADCASTER_ID = null;
socket.broadcast.emit('broadcaster-stopped');
console.log('Broadcaster stopped');
} else {
socket.to(BROADCASTER_ID).emit('disconnectPeer', socket.id);
}
});
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));