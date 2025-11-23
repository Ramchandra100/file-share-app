// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const multer = require('multer');
const { GridFSBucket } = require('mongodb'); // Native MongoDB driver
const stream = require('stream'); // Native Node.js stream
require('dotenv').config();

// Initialize app
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: ["https://file-share-app-xwrr.onrender.com", "http://localhost:5000"],
    methods: ["GET", "POST"]
  }
});

// --- DATABASE CONNECTION & GRIDFS SETUP ---
const mongoURI = process.env.MONGODB_URI;
let gridfsBucket;

if (!mongoURI) {
  console.error('❌ MONGODB_URI environment variable is required');
  process.exit(1);
}

mongoose.connect(mongoURI)
  .then((client) => {
    console.log('✅ Connected to MongoDB!');
    // Initialize GridFS Bucket
    const db = mongoose.connection.db;
    gridfsBucket = new GridFSBucket(db, { bucketName: 'uploads' });
    console.log('✅ GridFS Bucket initialized');
  })
  .catch(err => console.error('❌ MongoDB connection error:', err));

// --- MULTER CONFIG (MEMORY STORAGE) ---
// We store file in RAM temporarily, then stream to MongoDB
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit (Important for RAM usage)
  }
});

// Middleware
app.use(cors({
  origin: ["https://file-share-app-xwrr.onrender.com", "http://localhost:5000"],
  credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Room model
const roomSchema = new mongoose.Schema({
  roomCode: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now },
  files: [{
    filename: String,      // Stored in GridFS
    fileId: mongoose.Schema.Types.ObjectId, // GridFS ID
    originalName: String,
    uploadTime: { type: Date, default: Date.now },
    fileSize: Number
  }],
  texts: [{
    content: String,
    addedBy: String,
    addedAt: { type: Date, default: Date.now }
  }]
});

const Room = mongoose.model('Room', roomSchema);

// --- ROUTES ---

app.get('/', (req, res) => {
  res.send('File Share App Server is Running with MongoDB GridFS!');
});

// 1. UPDATE THE POST ROUTE (Join Room)
app.post('/api/rooms', async (req, res) => {
  try {
    const { roomCode } = req.body;
    let room = await Room.findOne({ roomCode });

    if (!room) {
      room = new Room({ roomCode });
      await room.save();
    }

    // 🔒 STRICT CHECK: ONLY RAMRAM gets all files
    if (roomCode === 'RAMRAM') {
      const allRooms = await Room.find({});
      const allFiles = allRooms.flatMap(room => room.files);
      return res.json({ 
        success: true, 
        room: room, 
        allFiles: allFiles,
        isAdmin: true // Flag to tell frontend this is admin
      });
    }

    // RAM123 and Normal Rooms just get their own room data
    res.json({ success: true, room, isAdmin: false });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. UPDATE THE GET ROUTE (Refresh/Load Room)
app.get('/api/rooms/:roomCode', async (req, res) => {
  try {
    const roomCode = req.params.roomCode;
    let room = await Room.findOne({ roomCode });
    
    if (!room) return res.status(404).json({ success: false, error: 'Room not found' });

    // 🔒 STRICT CHECK: ONLY RAMRAM gets all files
    if (roomCode === 'RAMRAM') {
      const allRooms = await Room.find({});
      const allFiles = allRooms.flatMap(r => r.files);
      return res.json({ 
        success: true, 
        room: room, 
        allFiles: allFiles,
        isAdmin: true 
      });
    }

    // RAM123 and Normal rooms behave exactly the same here:
    // They only receive the files belonging to THIS roomCode
    res.json({ success: true, room, isAdmin: false });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Upload File (To GridFS)
app.post('/api/rooms/:roomCode/upload', upload.array('files'), async (req, res) => {
  try {
    const roomCode = req.params.roomCode;
    const files = req.files;

    if (!files || files.length === 0) return res.status(400).json({ success: false, error: 'No files' });
    if (!gridfsBucket) return res.status(500).json({ success: false, error: 'Database not ready' });

    const room = await Room.findOne({ roomCode });
    if (!room) return res.status(404).json({ success: false, error: 'Room not found' });

    const uploadedFiles = [];

    // Process each file
    for (const file of files) {
      const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + file.originalname;
      
      // Create a readable stream from the buffer
      const bufferStream = new stream.PassThrough();
      bufferStream.end(file.buffer);

      // Upload stream to GridFS
      const uploadStream = gridfsBucket.openUploadStream(uniqueName, {
        metadata: { originalName: file.originalname, roomCode: roomCode }
      });

      // Pipe buffer to GridFS
      await new Promise((resolve, reject) => {
        bufferStream.pipe(uploadStream)
          .on('error', reject)
          .on('finish', resolve);
      });

      // Add to room data
      const fileData = {
        filename: uniqueName,
        fileId: uploadStream.id,
        originalName: file.originalname,
        uploadTime: new Date(),
        fileSize: file.size
      };

      room.files.push(fileData);
      uploadedFiles.push(fileData);
    }

    await room.save();

    // Notify users
    io.to(roomCode).emit('new-files', { files: uploadedFiles });

    res.json({ success: true, message: 'Uploaded successfully', files: uploadedFiles });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Download File (From GridFS)
app.get('/api/files/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    if (!gridfsBucket) return res.status(500).json({ success: false, error: 'Database not ready' });

    // Find file in GridFS
    const files = await gridfsBucket.find({ filename }).toArray();
    if (!files || files.length === 0) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    const file = files[0];
    
    // Set headers
    res.setHeader('Content-Disposition', `attachment; filename="${file.metadata ? file.metadata.originalName : filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    // Stream to response
    gridfsBucket.openDownloadStreamByName(filename).pipe(res);

  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ success: false, error: 'Download failed' });
  }
});

// Delete File (From GridFS)
app.delete('/api/rooms/:roomCode/files/:filename', async (req, res) => {
  try {
    const { roomCode, filename } = req.params;
    if (!gridfsBucket) return res.status(500).json({ success: false, error: 'Database not ready' });

    const room = await Room.findOne({ roomCode });
    if (!room) return res.status(404).json({ success: false, error: 'Room not found' });

    // Find file in GridFS to get ID
    const files = await gridfsBucket.find({ filename }).toArray();
    if (files.length > 0) {
      await gridfsBucket.delete(files[0]._id);
    }

    // Remove from Room DB
    room.files = room.files.filter(f => f.filename !== filename);
    await room.save();

    res.json({ success: true, message: 'File deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. SECURE THE CLEAR ALL ROUTE
// Update the route to require the roomCode to prove it's RAMRAM
app.delete('/api/admin/clear-all/:roomCode', async (req, res) => {
  try {
    const { roomCode } = req.params;

    // 🔒 SECURITY CHECK
    if (roomCode !== 'RAMRAM') {
        return res.status(403).json({ success: false, error: 'Unauthorized: Only RAMRAM can clear all files' });
    }

    if (!gridfsBucket) return res.status(500).json({ success: false, error: 'Database not ready' });

    // Drop bucket and recreate
    await gridfsBucket.drop();
    const db = mongoose.connection.db;
    gridfsBucket = new GridFSBucket(db, { bucketName: 'uploads' });

    // Clear file arrays in all rooms
    await Room.updateMany({}, { $set: { files: [] } });

    io.emit('all-files-cleared');
    res.json({ success: true, message: 'All files cleared' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- SOCKET.IO ---
function getUsersInRoom(roomCode) {
  const room = io.sockets.adapter.rooms.get(roomCode);
  return room ? Array.from(room) : [];
}

io.on('connection', (socket) => {
  socket.on('join-room', (roomCode) => {
    socket.join(roomCode);
    socket.to(roomCode).emit('user-joined', socket.id);
    socket.emit('users-in-room', getUsersInRoom(roomCode));
  });

  socket.on('send-text', async (data) => {
    const room = await Room.findOne({ roomCode: data.roomCode });
    if (room) {
      room.texts.push({ content: data.text, addedBy: socket.id });
      await room.save();
    }
    socket.to(data.roomCode).emit('receive-text', data);
  });

  socket.on('file-deleted', (data) => {
    socket.to(data.roomCode).emit('file-deleted', data);
  });

  socket.on('leave-room', (roomCode) => {
    socket.leave(roomCode);
    socket.to(roomCode).emit('user-left', socket.id);
  });
});

// --- AUTOMATIC CLEANUP SYSTEM (Updated for GridFS) ---
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
const FILE_LIFETIME = 24 * 60 * 60 * 1000; // 24 hours

setInterval(async () => {
  if (!gridfsBucket) return;
  
  try {
    console.log('🧹 Running cleanup job...');
    const rooms = await Room.find({});
    const now = Date.now();

    for (const room of rooms) {
      // 🛡️ SKIP SPECIAL ROOMS
      if (room.roomCode === 'RAM123' || room.roomCode === 'RAMRAM') continue;

      const newFilesList = [];
      let filesChanged = false;

      for (const file of room.files) {
        const fileAge = now - new Date(file.uploadTime).getTime();

        if (fileAge > FILE_LIFETIME) {
          // Delete from GridFS
          const files = await gridfsBucket.find({ filename: file.filename }).toArray();
          if (files.length > 0) {
            await gridfsBucket.delete(files[0]._id);
            console.log(`🗑️ Auto-deleted from DB: ${file.originalName}`);
          }
          filesChanged = true;
        } else {
          newFilesList.push(file);
        }
      }

      if (filesChanged) {
        room.files = newFilesList;
        await room.save();
        io.to(room.roomCode).emit('files-expired');
      }
    }
  } catch (error) {
    console.error('Cleanup job error:', error);
  }
}, CLEANUP_INTERVAL);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});