// viewer-single.js
const socket = io();
const videoEl = document.getElementById('remoteVideo');
const info = document.getElementById('info');
let pc = null;
let media = null; // MediaStream for this single preview
const MODE = (window.ViewerMode || 'screen').toLowerCase(); // 'screen' | 'camera'
let seenStreams = []; // track unique incoming streams order
let seenVideoCount = 0; // fallback by arrival order of video tracks


socket.on('connect', () => {
  socket.emit('watcher');
});

socket.on('no-broadcaster', () => {
  info.innerText = 'No broadcaster is currently streaming.';
});

socket.on('offer', async (broadcasterId, description) => {
  pc = new RTCPeerConnection();

  pc.ontrack = event => {
    const track = event.track;
    const hint = (track.contentHint || '').toLowerCase();
    if (track.kind === 'video') {
      // Determine stream role by hint or by arrival order
      const [s] = event.streams;
      let role = null; // 'screen' | 'camera'
      if (hint === 'camera') role = 'camera';
      else if (hint === 'screen') role = 'screen';
      else {
        // Fallback: maintain order of unique streams
        const id = s ? s.id : `track-${track.id}`;
        if (!seenStreams.includes(id)) seenStreams.push(id);
        const idx = seenStreams.indexOf(id);
        role = idx === 0 ? 'screen' : 'camera';
        // Additional fallback: if streams are not distinguishing, use arrival count
        if (seenStreams.length === 1) {
          seenVideoCount += 1;
          role = seenVideoCount === 1 ? 'screen' : 'camera';
        }
      }
      const accept = MODE === role;
      if (!accept) return;
      if (!media) media = new MediaStream();
      media.addTrack(track);
      videoEl.srcObject = media;
      // Nudge autoplay
      if (videoEl.play) { try { videoEl.play(); } catch {} }
    } else if (track.kind === 'audio') {
      // Only attach audio for the screen preview (so you hear system/mic via screen player).
      if (MODE !== 'screen') return;
      if (!media) media = new MediaStream();
      media.addTrack(track);
      if (videoEl.srcObject !== media) videoEl.srcObject = media;
      if (videoEl.play) { try { videoEl.play(); } catch {} }
    }
  };

  pc.onicecandidate = event => {
    if (event.candidate) socket.emit('candidate', broadcasterId, event.candidate);
  };

  await pc.setRemoteDescription(description);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('answer', broadcasterId, pc.localDescription);
  info.innerText = MODE === 'camera' ? 'Connected to camera.' : 'Connected to screen.';
});

socket.on('candidate', (id, candidate) => {
  if (pc) pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
});

socket.on('broadcaster-stopped', () => {
  info.innerText = 'Broadcast stopped by broadcaster.';
  if (pc) { pc.close(); pc = null; }
  media = null;
});
