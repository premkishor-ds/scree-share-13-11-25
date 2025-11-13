// viewer.js
const socket = io();
const video = document.getElementById('remoteVideo');
const info = document.getElementById('info');
const recordingInfo = document.getElementById('recordingInfo');
let pc = null;


socket.on('connect', () => {
    socket.emit('watcher');
    recordingInfo.textContent = '';
});


socket.on('no-broadcaster', () => {
    info.innerText = 'No broadcaster is currently streaming.';
    recordingInfo.textContent = '';
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
    recordingInfo.textContent = '';
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
    recordingInfo.textContent = 'If a recording was saved, the link will appear here shortly.';
});


socket.on('recording-ready', ({ fileUrl }) => {
    info.innerText = 'Broadcast finished.';
    if (fileUrl) {
        recordingInfo.textContent = 'Recording available: ';
        const link = document.createElement('a');
        link.href = fileUrl;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = fileUrl;
        recordingInfo.appendChild(link);
    } else {
        recordingInfo.textContent = 'Broadcast ended without a saved recording.';
    }
});