// viewer.js
const socket = io();
const video = document.getElementById('remoteVideo');
const info = document.getElementById('info');
let pc = null;


socket.on('connect', () => {
socket.emit('watcher');
});


socket.on('no-broadcaster', () => {
info.innerText = 'No broadcaster is currently streaming.';
});


socket.on('offer', async (broadcasterId, description) => {
pc = new RTCPeerConnection();


pc.ontrack = event => {
video.srcObject = event.streams[0];
};


pc.onicecandidate = event => {
if (event.candidate) {
socket.emit('candidate', broadcasterId, event.candidate);
}
};


await pc.setRemoteDescription(description);
const answer = await pc.createAnswer();
await pc.setLocalDescription(answer);
socket.emit('answer', broadcasterId, pc.localDescription);
info.innerText = 'Connected to broadcaster.';
});


socket.on('candidate', (id, candidate) => {
if (pc) pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
});


socket.on('broadcaster-stopped', () => {
info.innerText = 'Broadcast stopped by broadcaster.';
if (pc) {
pc.close();
pc = null;
}
});