const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5e6, pingTimeout: 60000 });
app.use(express.static('public'));

const CHANNELS = ['общий', 'мемы', 'музыка'];
const users = new Map();
const dataFile = path.join(__dirname, 'history.json');
let db = { messages: { 'общий': [], 'мемы': [], 'музыка': [] }, streaks: {} };

if (fs.existsSync(dataFile)) {
  try {
    const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    if (saved.messages) db.messages = { ...db.messages, ...saved.messages };
    if (saved.streaks) db.streaks = saved.streaks;
  } catch(e) {}
}

function saveDB() {
  try { fs.writeFileSync(dataFile, JSON.stringify(db, null, 2)); } catch(e) {}
}

function updateStreak(name) {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (!db.streaks[name]) { db.streaks[name] = { count: 1, lastDate: today }; }
  else {
    if (db.streaks[name].lastDate === today) {} 
    else if (db.streaks[name].lastDate === yesterday) { db.streaks[name].count += 1; db.streaks[name].lastDate = today; } 
    else { db.streaks[name].count = 1; db.streaks[name].lastDate = today; }
  }
  saveDB(); return db.streaks[name].count;
}

io.on('connection', (socket) => {
  socket.on('join', ({ name, avatar, bio }) => {
    const streakCount = updateStreak(name);
    users.set(socket.id, { name, avatar, bio: bio || '', streak: streakCount });
    
    socket.emit('channels', CHANNELS);
    socket.emit('chat-history', { channel: 'общий', messages: db.messages['общий'] || [] });
    
    const others = [...users.entries()].filter(([id]) => id !== socket.id).map(([id, u]) => ({ id, name: u.name, avatar: u.avatar, bio: u.bio, streak: u.streak }));
    socket.emit('joined', { selfId: socket.id, others, myStreak: streakCount });
    
    socket.join('общий');
    socket.emit('channel-joined', 'общий');
  });

  socket.on('switch-channel', (channel) => {
    for (const ch of CHANNELS) socket.leave(ch);
    socket.join(channel);
    socket.emit('chat-history', { channel, messages: db.messages[channel] || [] });
    socket.emit('channel-joined', channel);
  });

  socket.on('typing', (isTyping) => {
    const user = users.get(socket.id);
    if (user) socket.broadcast.emit('user-typing', { name: user.name, isTyping });
  });

  socket.on('chat-message', (data) => {
    const user = users.get(socket.id);
    if (user && (data.text?.trim() || data.image)) {
      const msg = { 
        id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
        socketId: socket.id,
        name: user.name, avatar: user.avatar, text: data.text?.trim() || '', image: data.image || null, 
        replyTo: data.replyTo || null, time: Date.now() 
      };
      
      const channel = data.channel || 'общий';
      if (!db.messages[channel]) db.messages[channel] = [];
      db.messages[channel].push(msg);
      if (db.messages[channel].length > 100) db.messages[channel].shift(); 
      
      saveDB();
      io.to(channel).emit('chat-message', msg);
    }
  });

  socket.on('clear-chat', (channel) => {
    if (db.messages[channel]) {
      db.messages[channel] = [];
      saveDB();
      io.to(channel).emit('chat-cleared');
    }
  });

  socket.on('delete-message', ({ channel, msgId }) => {
    const user = users.get(socket.id);
    if (db.messages[channel]) {
      const msgIndex = db.messages[channel].findIndex(m => m.id === msgId);
      if (msgIndex !== -1 && (db.messages[channel][msgIndex].socketId === socket.id || user.name === 'Pupka220')) {
        db.messages[channel].splice(msgIndex, 1);
        saveDB();
        io.to(channel).emit('message-deleted', msgId);
      }
    }
  });

  socket.on('update-profile', ({ name, avatar, bio }) => {
    const user = users.get(socket.id);
    if (user) {
      user.name = name; user.avatar = avatar; user.bio = bio;
      io.emit('profile-updated', { id: socket.id, name, avatar, bio });
    }
  });

  socket.on('signal', ({ to, data }) => { io.to(to).emit('signal', { from: socket.id, data }); });

  socket.on('disconnect', () => {
    users.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Zcord запущен на порту ${PORT}`));