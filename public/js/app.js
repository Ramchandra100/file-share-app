// app.js - FRONTEND JAVASCRIPT (runs in browser)
class FileShareApp {
    constructor() {
        this.socket = io();
        this.currentRoom = null;
        
        this.initializeElements();
        this.initializeEventListeners();
        this.initializeSocketEvents();
    }

    initializeElements() {
        // Screens
        this.homeScreen = document.getElementById('homeScreen');
        this.roomScreen = document.getElementById('roomScreen');
        
        // Home screen elements
        this.createRoomBtn = document.getElementById('createRoomBtn');
        this.joinRoomBtn = document.getElementById('joinRoomBtn');
        this.roomCodeInput = document.getElementById('roomCodeInput');
        
        // Room screen elements
        this.roomCodeDisplay = document.getElementById('roomCodeDisplay');
        this.leaveRoomBtn = document.getElementById('leaveRoomBtn');
        this.sharedText = document.getElementById('sharedText');
        this.clearTextBtn = document.getElementById('clearTextBtn');
        this.fileInput = document.getElementById('fileInput');
        this.uploadBtn = document.getElementById('uploadBtn');
        this.fileList = document.getElementById('fileList');
        this.usersList = document.getElementById('usersList');
    }

    initializeEventListeners() {
        // Home screen events
        this.createRoomBtn.addEventListener('click', () => this.createRoom());
        this.joinRoomBtn.addEventListener('click', () => this.joinRoom());
        this.roomCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });

        // Room screen events
        this.leaveRoomBtn.addEventListener('click', () => this.leaveRoom());
        this.clearTextBtn.addEventListener('click', () => this.clearText());
        this.uploadBtn.addEventListener('click', () => this.uploadFiles());
        
        // Real-time text sharing
        this.sharedText.addEventListener('input', (e) => {
            this.socket.emit('send-text', {
                roomCode: this.currentRoom,
                text: e.target.value
            });
        });
    }

    initializeSocketEvents() {
        // Handle incoming real-time text
        this.socket.on('receive-text', (data) => {
            this.sharedText.value = data.text;
        });

        // Handle user connections
        this.socket.on('user-joined', (userId) => {
            this.addUserToList(userId);
        });

        this.socket.on('user-left', (userId) => {
            this.removeUserFromList(userId);
        });

        this.socket.on('users-in-room', (users) => {
            this.updateUsersList(users);
        });

        // Handle real-time file updates
        this.socket.on('new-files', (data) => {
            data.files.forEach(file => {
                this.addFileToList(file.originalName, file.filename);
            });
        });
    }

    generateRoomCode() {
        return Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    async createRoom() {
        const roomCode = this.generateRoomCode();
        await this.joinRoom(roomCode);
    }

    async joinRoom(roomCode = null) {
        const code = roomCode || this.roomCodeInput.value.trim().toUpperCase();
        
        if (!code) {
            alert('Please enter a room code');
            return;
        }

        if (code.length !== 6) {
            alert('Room code must be 6 characters');
            return;
        }

        try {
            const response = await fetch('/api/rooms', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ roomCode: code })
            });

            const data = await response.json();

            if (data.success) {
                this.currentRoom = code;
                this.showRoomScreen();
                this.socket.emit('join-room', code);
                this.loadRoomData(code);
            } else {
                alert('Error: ' + data.error);
            }
        } catch (error) {
            alert('Failed to join room: ' + error.message);
        }
    }

    showRoomScreen() {
        this.homeScreen.classList.remove('active');
        this.roomScreen.classList.add('active');
        this.roomCodeDisplay.textContent = this.currentRoom;
        this.sharedText.value = '';
        this.fileList.innerHTML = '';
        this.usersList.innerHTML = '';
    }

    showHomeScreen() {
        this.roomScreen.classList.remove('active');
        this.homeScreen.classList.add('active');
        this.roomCodeInput.value = '';
        this.currentRoom = null;
    }

    leaveRoom() {
        this.socket.emit('leave-room', this.currentRoom);
        this.showHomeScreen();
    }

    clearText() {
        if (confirm('Are you sure you want to clear all text?')) {
            this.sharedText.value = '';
            this.socket.emit('send-text', {
                roomCode: this.currentRoom,
                text: ''
            });
        }
    }

    async uploadFiles() {
        const files = this.fileInput.files;
        if (files.length === 0) {
            alert('Please select files to upload');
            return;
        }

        try {
            const formData = new FormData();
            Array.from(files).forEach(file => {
                formData.append('files', file);
            });

            const response = await fetch(`/api/rooms/${this.currentRoom}/upload`, {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (data.success) {
                // Add files to the list
                data.files.forEach(file => {
                    this.addFileToList(file.originalName, file.filename);
                });
                
                alert(`✅ ${data.message}`);
            } else {
                alert('Upload failed: ' + data.error);
            }
        } catch (error) {
            alert('Upload error: ' + error.message);
        }

        this.fileInput.value = ''; // Clear the input
    }

    addFileToList(originalName, filename) {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.innerHTML = `
            <div class="file-info">
                <strong>${originalName}</strong>
                <small>Uploaded just now</small>
            </div>
            <button class="btn secondary download-btn" data-filename="${filename}">Download</button>
        `;
        
        // Add download functionality
        const downloadBtn = fileItem.querySelector('.download-btn');
        downloadBtn.addEventListener('click', () => {
            this.downloadFile(filename, originalName);
        });
        
        this.fileList.appendChild(fileItem);
    }

    downloadFile(filename, originalName) {
        // Create a temporary link to trigger download
        const link = document.createElement('a');
        link.href = `/api/files/${filename}`;
        link.download = originalName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    addUserToList(userId) {
        const userItem = document.createElement('div');
        userItem.className = 'user-item';
        userItem.textContent = `User: ${userId}`;
        userItem.id = `user-${userId}`;
        this.usersList.appendChild(userItem);
    }

    removeUserFromList(userId) {
        const userElement = document.getElementById(`user-${userId}`);
        if (userElement) {
            userElement.remove();
        }
    }

    updateUsersList(users) {
        this.usersList.innerHTML = '';
        users.forEach(user => {
            this.addUserToList(user);
        });
    }

    async loadRoomData(roomCode) {
        try {
            const response = await fetch(`/api/rooms/${roomCode}`);
            const data = await response.json();
            
            if (data.success && data.room) {
                // Load existing room data
                if (data.room.texts && data.room.texts.length > 0) {
                    this.sharedText.value = data.room.texts[data.room.texts.length - 1].content;
                }
                
                // Load existing files
                if (data.room.files && data.room.files.length > 0) {
                    data.room.files.forEach(file => {
                        this.addFileToList(file.originalName, file.filename);
                    });
                }
            }
        } catch (error) {
            console.error('Error loading room data:', error);
        }
    }
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new FileShareApp();
});