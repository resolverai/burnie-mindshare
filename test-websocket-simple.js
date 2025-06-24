#!/usr/bin/env node

// Simple WebSocket test without dependencies
const { io } = require('socket.io-client');

console.log('🔌 Testing WebSocket connection...');
console.log('📍 Target: http://localhost:8000');

const socket = io('http://localhost:8000', {
  transports: ['websocket', 'polling'],
  timeout: 10000,
  forceNew: true,
  autoConnect: true
});

let connected = false;

socket.on('connect', () => {
  connected = true;
  console.log('✅ WebSocket connected successfully!');
  console.log('🔗 Socket ID:', socket.id);
  console.log('🚀 Transport:', socket.io.engine.transport.name);
  
  // Test authentication
  console.log('🔐 Testing authentication...');
  socket.emit('authenticate', {
    minerId: 12345,
    walletAddress: 'test_wallet_address'
  });
  
  setTimeout(() => {
    console.log('✅ Test completed - WebSocket is working!');
    socket.disconnect();
    process.exit(0);
  }, 3000);
});

socket.on('connect_error', (error) => {
  console.error('❌ Connection failed:', error.message);
  console.error('🔍 Error details:', {
    type: error.type || 'unknown',
    description: error.description || 'No description'
  });
  process.exit(1);
});

socket.on('authenticated', (data) => {
  console.log('✅ Authentication successful:', data);
});

socket.on('authError', (data) => {
  console.error('❌ Authentication failed:', data);
});

socket.on('connected', (data) => {
  console.log('🎉 Server confirmation:', data);
});

// Timeout if no connection
setTimeout(() => {
  if (!connected) {
    console.error('❌ Connection timeout - server may not be running');
    process.exit(1);
  }
}, 15000); 