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
    origin: ["https://file-share-app-xwrr.onrender.com", "http://localhost:5000"],
    methods: ["GET", "POST"]
  }
});

// Debug: Check if environment variable is loaded
console.log('MongoDB URI from environment:', process.env.MONGODB_URI ? 'Present' : 'NOT FOUND');

// Connect to MongoDB - Use environment variable only
const mongoURI = process.env.MONGODB_URI;
console.log('Connecting to MongoDB with URI:', mongoURI ? 'URI provided' : 'No URI found');

if (!mongoURI) {
  console.error('❌ MONGODB_URI environment variable is required');
  process.exit(1);
}

mongoose.connect(mongoURI)
  .then(() => console.log('✅ Connected to MongoDB!'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    console.log('Please check:');
    console.log('1. MONGODB_URI environment variable');
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

// Middleware - SINGLE CORS CONFIGURATION
app.use(cors({
  origin: ["https://file-share-app-xwrr.onrender.com", "http://localhost:5000"],
  credentials: true
}));
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

    // Special handling for RAMRAM room - load all files
    if (roomCode === 'RAMRAM') {
      const allRooms = await Room.find({});
      const allFiles = allRooms.flatMap(room => room.files);
      
      return res.json({ 
        success: true, 
        room: room,
        allFiles: allFiles // Send all files from all rooms
      });
    }

    res.json({ success: true, room });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get room data
app.get('/api/rooms/:roomCode', async (req, res) => {
  try {
    const roomCode = req.params.roomCode;
    let room = await Room.findOne({ roomCode });
    
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    // Special handling for RAMRAM room - load all files
    if (roomCode === 'RAMRAM') {
      const allRooms = await Room.find({});
      const allFiles = allRooms.flatMap(room => room.files);
      
      return res.json({ 
        success: true, 
        room: room,
        allFiles: allFiles // Send all files from all rooms
      });
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

// File download route with original filename
app.get('/api/files/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'uploads', filename);
  
  if (fs.existsSync(filePath)) {
    // Get original filename from database
    Room.findOne({ 'files.filename': filename })
      .then(room => {
        if (room) {
          const fileData = room.files.find(f => f.filename === filename);
          const originalName = fileData ? fileData.originalName : filename;
          
          // Set headers for download with original filename
          res.setHeader('Content-Disposition', `attachment; filename="${originalName}"`);
          res.sendFile(filePath);
        } else {
          res.download(filePath); // Fallback
        }
      })
      .catch(() => {
        res.download(filePath); // Fallback if database query fails
      });
  } else {
    res.status(404).json({ success: false, error: 'File not found' });
  }
});

// Delete file route
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

// Clear all files (only for RAMRAM room)
app.delete('/api/admin/clear-all', async (req, res) => {
  try {
    // Clear all files from database
    await Room.updateMany({}, { $set: { files: [] } });
    
    // Delete all physical files
    const uploadsDir = path.join(__dirname, 'uploads');
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir);
      files.forEach(file => {
        fs.unlinkSync(path.join(uploadsDir, file));
      });
    }
    
    // Notify all rooms about the clearance
    io.emit('all-files-cleared');
    
    res.json({ success: true, message: 'All files cleared successfully' });
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

  // Save text to database and broadcast
  socket.on('send-text', async (data) => {
    try {
      // Save text to database
      const room = await Room.findOne({ roomCode: data.roomCode });
      if (room) {
        room.texts.push({
          content: data.text,
          addedBy: socket.id,
          addedAt: new Date()
        });
        await room.save();
      }

      // Broadcast to other users in the room
      socket.to(data.roomCode).emit('receive-text', data);
      console.log(`Text saved and broadcast in room ${data.roomCode}`);
    } catch (error) {
      console.error('Error saving text:', error);
    }
  });

  // Handle file deletion notifications
  socket.on('file-deleted', (data) => {
    // Notify other users in the room about file deletion
    socket.to(data.roomCode).emit('file-deleted', data);
    console.log(`File deleted in room ${data.roomCode}: ${data.filename}`);
  });

  // Handle all files cleared notification
  socket.on('all-files-cleared', () => {
    // Notify all users that all files were cleared
    io.emit('all-files-cleared');
    console.log('All files cleared notification sent');
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