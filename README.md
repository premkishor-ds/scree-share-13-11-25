# Quiz Screen Sharing & Recording System

A Node.js-based WebRTC screen sharing and recording solution tailored for online tests and quizzes. It supports multiple users, multiple quizzes, and independent question-by-question video recordings with automatic background transcoding from WebM to MP4 using FFmpeg.

---

## Features

- **Live WebRTC Screen Sharing:** Broadcasters can stream their screen to peers in real time using a Socket.io signaling channel.
- **Multi-Quiz & Multi-User Organization:** Automatically organizes recorded clips into nested subfolders on the server by `userId` and `quizId`.
- **Question-by-Question Recording:** Broadcasters can start and stop recordings per question (e.g. `q1`, `q2`, `q3`) sequentially without having to restart the browser screen-share stream or re-request browser permissions.
- **Reliable Chunked Uploads:** Stream recordings are uploaded incrementally in 1MB chunks to the server to prevent timeouts and memory bloat on large files.
- **Automatic FFmpeg Transcoding:** The server converts uploaded WebM streams to standardized web-compatible H.264/AAC MP4 files asynchronously and polls conversion progress.
- **Automatic Retention Cleanup:** Automatically purges recording files older than 15 days to save storage space.

---

## Directory Structure

```text
├── recordings/
│   └── screen/
│       └── [username]/              # User folder (e.g., user-01)
│           └── [quizId]/            # Quiz folder (e.g., math-101)
│               ├── question-[questionId]-[timestamp].webm  # Raw chunk upload
│               └── question-[questionId]-[timestamp].mp4   # Transcoded target
├── public/
│   ├── index.html                   # Entry page
│   ├── test.html                    # Broadcaster console (test panel)
│   ├── view.html                    # Watcher page
│   ├── viewer.js                    # WebRTC viewer script
├── server.js                        # Express and Socket.io server
├── package.json
└── README.md
```

---

## Setup & Running

### 1. Requirements
Ensure you have **Node.js** (>=16) and **FFmpeg** installed on your system. FFmpeg and FFprobe must be available in your system's global PATH so the server can spawn conversion commands.

### 2. Install Dependencies
Install all package dependencies:
```bash
npm install
```

### 3. Start the Server
Start the development server (automatically reloads with nodemon if installed):
```bash
npm start
```
The server will start running at **`http://localhost:3000`**.

---

## Testing Guide

### 1. Broadcaster Console
To test the screen recording and multi-question flow:
1. Open the Broadcaster Console at **`http://localhost:3000/test.html`**.
2. Input a **User ID** (e.g., `user-01`) and select a quiz (e.g., `Mathematics (math-101)`).
3. Click **Start Share & Broadcast** to capture your screen.
4. Select a question (e.g., `Q1: Geometry & Shapes`), click **Record Question**, perform some actions on the screen, then click **Stop & Upload Q**.
5. The console will upload the recorded segment in chunks, transcode it to MP4 in the background, and log the final MP4 video link.
6. Simply switch the question dropdown to the next question (e.g., `Q2`) and click **Record Question** to record the next segment.

### 2. Watcher Live View
To view the broadcast live:
* Open the **Watcher Link** generated on the broadcaster console (e.g., `http://localhost:3000/view/user-01.html`).
* The WebRTC stream will connect automatically and display the live screen share.

---

## API Documentation

### 1. Chunked Upload
- **Endpoint:** `POST /api/recordings/screen/chunk`
- **Content-Type:** `multipart/form-data`
- **Fields:**
  - `recording`: Video Blob (chunk)
  - `uploadId`: Unique session identifier
  - `index`: Index of the current chunk (0-indexed)
  - `isLast`: `"true"` if this is the final chunk (triggers FFmpeg transcoding)
  - `username`: User ID
  - `quizId`: Quiz ID
  - `questionId`: Question ID

### 2. Conversion Status
- **Endpoint:** `GET /api/conversion-status/:jobId`
- **Response:**
  ```json
  {
    "jobId": "uuid-string",
    "status": "processing | done | failed",
    "progress": 85,
    "webmUrl": "/recordings/screen/user-01/math-101/question-q1-timestamp.webm",
    "mp4Url": "/recordings/screen/user-01/math-101/question-q1-timestamp.mp4",
    "error": null
  }
  ```
