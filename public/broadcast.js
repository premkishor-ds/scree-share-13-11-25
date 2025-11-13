// broadcast.js
const socket = io();
let localStream = null;
const peers = {}; // peer connections keyed by watcher socket id


const shareBtn = document.getElementById('shareBtn');
const status = document.getElementById('status');


shareBtn.onclick = async () => {
try {
localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
} catch (err) {
status.innerText = 'Screen share permission denied or not supported: ' + err.message;
return;
}


socket.emit('broadcaster');
status.innerText = 'Broadcasting. Open /view.html to watch.';


socket.on('watcher', async watcherId => {
console.log('Watcher connected:', watcherId);
const pc = new RTCPeerConnection();
peers[watcherId] = pc;


// add local tracks to peer
localStream.getTracks().forEach(track => pc.addTrack(track, localStream));


// forward any ICE candidates to watcher
pc.onicecandidate = event => {
if (event.candidate) {
socket.emit('candidate', watcherId, event.candidate);
}
};


// create offer
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);
socket.emit('offer', watcherId, pc.localDescription);
});


socket.on('answer', (watcherId, description) => {
const pc = peers[watcherId];
if (pc) {
pc.setRemoteDescription(description).catch(console.error);
}
});


socket.on('candidate', (id, candidate) => {
const pc = peers[id];
if (pc) pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
});


socket.on('disconnectPeer', id => {
if (peers[id]) {
peers[id].close();
delete peers[id];
}
});


socket.on('broadcaster-stopped', () => {
status.innerText = 'Broadcaster stopped.';
});
};