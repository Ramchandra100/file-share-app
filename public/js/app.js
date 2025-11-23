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

        // ADD THIS NEW EVENT LISTENER:
        this.socket.on('files-expired', () => {
            console.log('Refreshing file list (cleanup occurred)');
            if (this.currentRoom) {
                // Reload data to show updated file list
                this.loadRoomData(this.currentRoom);
            }
        });

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
            // Only add files if we're in the correct room
            if (this.currentRoom) {
                data.files.forEach(file => {
                    this.addFileToList(file.originalName, file.filename);
                });
            }
        });

        // Handle real-time file deletion
        this.socket.on('file-deleted', (data) => {
            if (this.currentRoom === data.roomCode) {
                // Find and remove the file element from UI
                const fileElements = this.fileList.querySelectorAll('.file-item');
                fileElements.forEach(element => {
                    const downloadBtn = element.querySelector('.download-btn');
                    if (downloadBtn && downloadBtn.dataset.filename === data.filename) {
                        element.remove();
                    }
                });
            }
        });

        // Handle all files cleared notification
        this.socket.on('all-files-cleared', () => {
            // Clear file list UI for all users
            this.fileList.innerHTML = '';
            alert('All files have been cleared by admin');
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

        if (code.length !== 6 && code !== 'RAMRAM') {
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
                this.loadRoomData(code, data);
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

        // --- ADD THIS BLOCK ---
        // Special handling for RAM123 (Safe Vault)
        if (this.currentRoom === 'RAM123') {
            const warning = document.createElement('div');
            warning.className = 'special-room-warning';
            warning.style.backgroundColor = '#d4edda'; // Green color
            warning.style.color = '#155724';
            warning.style.borderColor = '#c3e6cb';
            warning.textContent = '🛡️ SECURE VAULT: Files in this room are saved permanently.';
            this.fileList.parentNode.insertBefore(warning, this.fileList);
        }
        
        // Add Clear All button for RAMRAM room
        if (this.currentRoom === 'RAMRAM') {
            this.addClearAllButton();
            
            // Add special warning for RAMRAM room
            const warning = document.createElement('div');
            warning.className = 'special-room-warning';
            warning.textContent = '⚠️ ADMIN ROOM: You can see and delete ALL files from ALL rooms';
            this.fileList.parentNode.insertBefore(warning, this.fileList);
        }
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

    addClearAllButton() {
        const clearAllBtn = document.createElement('button');
        clearAllBtn.className = 'btn danger';
        clearAllBtn.textContent = '🗑️ Clear All Files';
        clearAllBtn.style.margin = '10px 0';
        clearAllBtn.addEventListener('click', () => {
            this.clearAllFiles();
        });
        
        // Add button to the file sharing section
        const fileSection = document.querySelector('.file-upload-container');
        fileSection.parentNode.insertBefore(clearAllBtn, fileSection.nextSibling);
    }

    async clearAllFiles() {
        if (!confirm('⚠️ DANGER! This will delete ALL files from ALL rooms. Are you absolutely sure?')) {
            return;
        }

        if (!confirm('⚠️ THIS ACTION CANNOT BE UNDONE! All files will be permanently deleted.')) {
            return;
        }

        try {
            const response = await fetch('/api/admin/clear-all', {
                method: 'DELETE'
            });

            const data = await response.json();

            if (data.success) {
                // Clear file list UI
                this.fileList.innerHTML = '';
                alert('✅ All files cleared successfully');
                
                // Notify all users
                this.socket.emit('all-files-cleared');
            } else {
                alert('Clear all failed: ' + data.error);
            }
        } catch (error) {
            alert('Clear all error: ' + error.message);
        }
    }

    async deleteFile(filename, roomCode, fileElement) {
        if (!confirm('Are you sure you want to delete this file?')) {
            return;
        }

        try {
            const response = await fetch(`/api/rooms/${roomCode}/files/${filename}`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (data.success) {
                // Remove file from UI
                fileElement.remove();
                
                // Notify other users in the room to remove the file
                this.socket.emit('file-deleted', {
                    roomCode: roomCode,
                    filename: filename
                });
                
                alert('✅ File deleted successfully');
            } else {
                alert('Delete failed: ' + data.error);
            }
        } catch (error) {
            alert('Delete error: ' + error.message);
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
            <div class="file-actions">
                <button class="btn secondary download-btn" data-filename="${filename}">Download</button>
                <button class="btn danger delete-btn" data-filename="${filename}" data-room="${this.currentRoom}">Delete</button>
            </div>
        `;
        
        // Add download functionality
        const downloadBtn = fileItem.querySelector('.download-btn');
        downloadBtn.addEventListener('click', () => {
            this.downloadFile(filename, originalName);
        });
        
        // Add delete functionality
        const deleteBtn = fileItem.querySelector('.delete-btn');
        deleteBtn.addEventListener('click', () => {
            this.deleteFile(filename, this.currentRoom, fileItem);
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

    async loadRoomData(roomCode, roomData = null) {
        try {
            let data;
            if (roomData) {
                data = roomData;
            } else {
                const response = await fetch(`/api/rooms/${roomCode}`);
                data = await response.json();
            }
            
            if (data.success && data.room) {
                // Load existing room data
                if (data.room.texts && data.room.texts.length > 0) {
                    this.sharedText.value = data.room.texts[data.room.texts.length - 1].content;
                }
                
                // Load existing files - handle RAMRAM room specially
                if (roomCode === 'RAMRAM' && data.allFiles) {
                    // For RAMRAM room, load all files from all rooms
                    data.allFiles.forEach(file => {
                        this.addFileToList(file.originalName, file.filename);
                    });
                } else if (data.room.files && data.room.files.length > 0) {
                    // For normal rooms, load only room files
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