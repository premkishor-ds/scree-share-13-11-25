// broadcast.js
const socket = io();
let localStream = null;
const peers = {}; // peer connections keyed by watcher socket id
let mediaRecorder = null;
let recordedChunks = [];
let isBroadcasting = false;
let recordingResultSent = false;
let cameraStream = null; // separate camera stream


const shareBtn = document.getElementById('shareBtn');
const status = document.getElementById('status');
const recordingLinksSection = document.getElementById('recordingLinks');
const downloadLink = document.getElementById('recordingDownloadLink');
const recordingUrlLink = document.getElementById('recordingUrlLink');


shareBtn.onclick = () => {
    if (isBroadcasting) {
        return;
    }


    startScreenShare();
};


socket.on('watcher', handleWatcher);
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
    closePeer(id);
});


socket.on('broadcaster-stopped', () => {
    status.innerText = 'Broadcast stopped.';
});


async function startScreenShare() {
    shareBtn.disabled = true;
    status.innerText = 'Requesting screen capture...';


    try {
        localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        // Also request camera/mic as a separate stream
        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        } catch (camErr) {
            console.warn('Camera/mic permission denied or unavailable:', camErr);
            cameraStream = null;
        }
    } catch (err) {
        status.innerText = 'Screen share permission denied or not supported: ' + err.message;
        shareBtn.disabled = false;
        return;
    }


    isBroadcasting = true;
    shareBtn.innerText = 'Sharing...';
    status.innerText = 'Broadcasting. Open /view.html to watch.';
    recordingLinksSection.hidden = true;
    resetRecordingLinks();
    recordingResultSent = false;


    socket.emit('broadcaster');


    const [videoTrack] = localStream.getVideoTracks();
    if (videoTrack) {
        try { videoTrack.contentHint = 'screen'; } catch {}
        videoTrack.addEventListener('ended', handleScreenShareEnded, { once: true });
    }

    // Tag camera and mic tracks for the viewer to route appropriately
    if (cameraStream) {
        const camVideo = cameraStream.getVideoTracks()[0];
        if (camVideo) { try { camVideo.contentHint = 'camera'; } catch {} }
        const mic = cameraStream.getAudioTracks()[0];
        if (mic) { try { mic.contentHint = 'mic'; } catch {} }
    }


    startRecording();
}


async function handleWatcher(watcherId) {
    if (!localStream) {
        return;
    }


    console.log('Watcher connected:', watcherId);
    const pc = new RTCPeerConnection();
    peers[watcherId] = pc;


    // Add screen tracks (video + possibly system audio)
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    // Add camera video and mic audio as a separate stream so the viewer can render separately
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => pc.addTrack(track, cameraStream));
    }


    pc.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('candidate', watcherId, event.candidate);
        }
    };


    pc.oniceconnectionstatechange = () => {
        if (['disconnected', 'failed', 'closed'].includes(pc.iceConnectionState)) {
            closePeer(watcherId);
        }
    };


    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', watcherId, pc.localDescription);
}


function closePeer(id) {
    const pc = peers[id];
    if (pc) {
        pc.close();
        delete peers[id];
    }
}


function handleScreenShareEnded() {
    stopBroadcast('Screen share stopped.');
}


function stopBroadcast(message) {
    if (!isBroadcasting) {
        status.innerText = message;
        return;
    }


    isBroadcasting = false;
    status.innerText = message;
    shareBtn.disabled = false;
    shareBtn.innerText = 'Share screen';


    socket.emit('stop-broadcast');


    if (!mediaRecorder && !recordingResultSent) {
        socket.emit('recording-ready', { fileUrl: null });
        recordingResultSent = true;
    }


    Object.keys(peers).forEach(closePeer);


    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try {
            mediaRecorder.stop();
        } catch (err) {
            console.error('Failed to stop MediaRecorder:', err);
        }
    }


    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
}


function startRecording() {
    recordedChunks = [];


    if (typeof MediaRecorder === 'undefined') {
        console.warn('MediaRecorder not supported in this browser. Recording disabled.');
        status.innerText = 'Broadcasting (no recording support in this browser).';
        return;
    }


    try {
        mediaRecorder = new MediaRecorder(localStream, { mimeType: 'video/webm;codecs=vp9' });
    } catch (err) {
        try {
            mediaRecorder = new MediaRecorder(localStream, { mimeType: 'video/webm' });
        } catch (fallbackErr) {
            console.error('Unable to start MediaRecorder:', fallbackErr);
            status.innerText = 'Broadcasting (recording unavailable).';
            mediaRecorder = null;
            return;
        }
    }


    mediaRecorder.ondataavailable = event => {
        if (event.data && event.data.size) {
            recordedChunks.push(event.data);
        }
    };


    mediaRecorder.onstop = () => {
        processRecording();
    };

    mediaRecorder.start(1000);
}


function processRecording() {
    const chunks = recordedChunks.slice();
    recordedChunks = [];
    mediaRecorder = null;


    if (!chunks.length) {
        status.innerText = 'Screen share stopped. No recording captured.';
        if (!recordingResultSent) {
            socket.emit('recording-ready', { fileUrl: null });
            recordingResultSent = true;
        }
        return;
    }


    const blob = new Blob(chunks, { type: 'video/webm' });
    const downloadName = `screen-recording-${Date.now()}.webm`;


    triggerBrowserDownload(blob, downloadName);
    status.innerText = 'Uploading recording...';


    uploadRecording(blob, downloadName)
        .then(({ fileUrl }) => {
            status.innerText = 'Recording saved. Links below.';
            const localUrl = URL.createObjectURL(blob);
            downloadLink.href = localUrl;
            downloadLink.download = downloadName;
            downloadLink.textContent = 'Download recording';
            recordingUrlLink.href = fileUrl;
            recordingUrlLink.textContent = fileUrl;
            recordingLinksSection.hidden = false;
            socket.emit('recording-ready', { fileUrl });
            setTimeout(() => URL.revokeObjectURL(localUrl), 60000);
            recordingResultSent = true;
        })
        .catch(err => {
            console.error('Failed to upload recording:', err);
            status.innerText = 'Recording upload failed: ' + err.message;
            if (!recordingResultSent) {
                socket.emit('recording-ready', { fileUrl: null });
                recordingResultSent = true;
            }
        });
}


function triggerBrowserDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
}


async function uploadRecording(blob, fileName) {
    const formData = new FormData();
    formData.append('recording', blob, fileName);


    const response = await fetch('/api/recordings', {
        method: 'POST',
        body: formData,
    });


    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to upload recording');
    }


    return response.json();
}


function resetRecordingLinks() {
    downloadLink.href = '#';
    downloadLink.removeAttribute('download');
    downloadLink.textContent = '';
    recordingUrlLink.href = '#';
    recordingUrlLink.textContent = '';
}
