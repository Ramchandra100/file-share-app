// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

// Initialize our app
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Debug: Check if environment variable is loaded
console.log('MongoDB URI:', process.env.MONGODB_URI ? 'Loaded successfully' : 'NOT LOADED');

// Connect to MongoDB - SIMPLIFIED CONNECTION
console.log('Connecting to MongoDB...');
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB!'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    console.log('Please check:');
    console.log('1. MONGODB_URI in .env file');
    console.log('2. Database user exists in MongoDB Atlas');
    console.log('3. Network Access allows 0.0.0.0/0');
  });

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Create uploads directory if it doesn't exist
    if (!fs.existsSync('uploads')) {
      fs.mkdirSync('uploads');
    }
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    // Create unique filename with timestamp
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + file.originalname;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB file size limit
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Serve uploaded files

// Room model
const roomSchema = new mongoose.Schema({
  roomCode: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now },
  files: [{
    filename: String,
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

// Routes
app.get('/', (req, res) => {
  res.send('File Share App Server is Running with MongoDB!');
});

// Create or join a room
app.post('/api/rooms', async (req, res) => {
  try {
    const { roomCode } = req.body;
    
    let room = await Room.findOne({ roomCode });
    
    if (!room) {
      room = new Room({ roomCode });
      await room.save();
      console.log('New room created:', roomCode);
    }
    
    res.json({ success: true, room });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get room data
app.get('/api/rooms/:roomCode', async (req, res) => {
  try {
    const room = await Room.findOne({ roomCode: req.params.roomCode });
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }
    res.json({ success: true, room });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// File upload route
app.post('/api/rooms/:roomCode/upload', upload.array('files'), async (req, res) => {
  try {
    const roomCode = req.params.roomCode;
    const files = req.files;
    
    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files uploaded' });
    }

    const room = await Room.findOne({ roomCode });
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    // Add files to room
    files.forEach(file => {
      room.files.push({
        filename: file.filename,
        originalName: file.originalname,
        uploadTime: new Date(),
        fileSize: file.size
      });
    });

    await room.save();

    // Notify all users in the room about new files
    io.to(roomCode).emit('new-files', {
      files: files.map(file => ({
        filename: file.filename,
        originalName: file.originalname,
        uploadTime: new Date(),
        fileSize: file.size
      }))
    });

    res.json({ 
      success: true, 
      message: `${files.length} file(s) uploaded successfully`,
      files: files.map(file => ({
        filename: file.filename,
        originalName: file.originalname,
        fileSize: file.size
      }))
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// File download route
app.get('/api/files/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'uploads', filename);
  
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ success: false, error: 'File not found' });
  }
});

// Delete file route (optional - for future enhancement)
app.delete('/api/rooms/:roomCode/files/:filename', async (req, res) => {
  try {
    const { roomCode, filename } = req.params;
    
    const room = await Room.findOne({ roomCode });
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    // Remove file from database
    room.files = room.files.filter(file => file.filename !== filename);
    await room.save();

    // Delete physical file
    const filePath = path.join(__dirname, 'uploads', filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.json({ success: true, message: 'File deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper function to get users in a room
function getUsersInRoom(roomCode) {
  const room = io.sockets.adapter.rooms.get(roomCode);
  return room ? Array.from(room) : [];
}

// Real-time socket connections
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('join-room', (roomCode) => {
    socket.join(roomCode);
    console.log(`User ${socket.id} joined room: ${roomCode}`);
    
    // Notify others in the room
    socket.to(roomCode).emit('user-joined', socket.id);
    
    // Send current users in room to the new user
    const roomUsers = getUsersInRoom(roomCode);
    socket.emit('users-in-room', roomUsers);
  });

  socket.on('send-text', (data) => {
    socket.to(data.roomCode).emit('receive-text', data);
    console.log(`Text received in room ${data.roomCode}`);
  });

  socket.on('leave-room', (roomCode) => {
    socket.leave(roomCode);
    socket.to(roomCode).emit('user-left', socket.id);
    console.log(`User ${socket.id} left room: ${roomCode}`);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Set the port
const PORT = process.env.PORT || 5000;

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});