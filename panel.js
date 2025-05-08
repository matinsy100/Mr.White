// Configuration
const CONFIG = {
  serverUrl: 'ws://localhost:8000',
  reconnectInterval: 2000,
  maxReconnectAttempts: 5,
  username: `user_${Math.floor(Math.random() * 10000)}`,
  enableTypingSimulation: true,
  keepAliveInterval: 30000,  // 30 seconds heartbeat
  visibilityReconnectDelay: 1000  // Delay before reconnecting when tab becomes visible
};

// DOM Elements
const elements = {
  chatBox: document.getElementById('chat-box'),
  userInput: document.getElementById('user-input'),
  sendBtn: document.getElementById('send-btn'),
  scanBtn: document.getElementById('scan-Btn'),
  rpdToggleBtn: document.getElementById('rpd-toggle-btn'),
  trashBtn: document.getElementById('trash-btn'),
  themeToggle: document.getElementById('theme-toggle'),
  scrollLeft: document.getElementById('scroll-left'),
  scrollRight: document.getElementById('scroll-right'),
  phishingControls: document.getElementById('phishing-controls')
};

// State Management
const state = {
  chatSocket: null,
  scanSocket: null,
  chatReconnectAttempts: 0,
  scanReconnectAttempts: 0,
  rpdActive: false,
  isTyping: false,
  darkTheme: true,
  messages: [],
  typingTimeout: null,
  keepAliveInterval: null,
  lastVisibilityState: 'visible',
  pendingReconnect: false
};

//=========================
// Tab Visibility Handling
//=========================

// Initialize tab visibility event listeners
function initTabVisibilityHandling() {
  // Listen for visibility changes
  document.addEventListener('visibilitychange', handleVisibilityChange);
  
  // Handle page unload
  window.addEventListener('beforeunload', () => {
    // Clean up WebSockets on page unload
    if (state.chatSocket) {
      state.chatSocket.onclose = null; // Prevent reconnect attempts during unload
      state.chatSocket.close();
    }
    
    if (state.scanSocket) {
      state.scanSocket.onclose = null; // Prevent reconnect attempts during unload
      state.scanSocket.close();
    }
  });
  
  // Initial visibility state
  state.lastVisibilityState = document.visibilityState;
}

// Handle visibility changes
function handleVisibilityChange() {
  const isVisible = document.visibilityState === 'visible';
  const wasVisible = state.lastVisibilityState === 'visible';
  
  // Update last known state
  state.lastVisibilityState = document.visibilityState;
  
  if (!wasVisible && isVisible) {
    // Tab became visible again after being hidden
    console.log('Tab became visible - checking connections');
    
    // Check WebSocket connections and reconnect if needed
    checkAndRestoreConnections();
  } else if (wasVisible && !isVisible) {
    // Tab became hidden
    console.log('Tab hidden - maintaining connections');
    
    // Keep connections alive with heartbeats
    setupKeepAlive();
  }
}

// Check and restore connections if needed
function checkAndRestoreConnections() {
  // Clear any keep-alive interval
  clearKeepAliveInterval();
  
  // Check chat socket
  if (!state.chatSocket || state.chatSocket.readyState > WebSocket.OPEN) {
    console.log('Chat connection lost while tab was inactive - reconnecting');
    // Small delay to allow the browser to fully resume
    setTimeout(() => {
      initChatWebSocket();
    }, CONFIG.visibilityReconnectDelay);
  } else {
    console.log('Chat connection maintained during tab switch');
  }
  
  // Check scan socket
  if (!state.scanSocket || state.scanSocket.readyState > WebSocket.OPEN) {
    console.log('Scan connection lost while tab was inactive - reconnecting');
    // Small delay to allow the browser to fully resume
    setTimeout(() => {
      initScanWebSocket();
    }, CONFIG.visibilityReconnectDelay);
  }
}

// Setup keep-alive heartbeats to maintain connections
function setupKeepAlive() {
  // Clear any existing interval
  clearKeepAliveInterval();
  
  // Set up new heartbeat interval
  state.keepAliveInterval = setInterval(() => {
    // Send heartbeat to chat socket if it's open
    if (state.chatSocket && state.chatSocket.readyState === WebSocket.OPEN) {
      try {
        // Empty JSON object as a heartbeat
        state.chatSocket.send(JSON.stringify({ type: 'heartbeat' }));
      } catch (error) {
        console.error('Error sending chat heartbeat:', error);
      }
    }
    
    // Send heartbeat to scan socket if it's open
    if (state.scanSocket && state.scanSocket.readyState === WebSocket.OPEN) {
      try {
        // Empty JSON object as a heartbeat
        state.scanSocket.send(JSON.stringify({ type: 'heartbeat' }));
      } catch (error) {
        console.error('Error sending scan heartbeat:', error);
      }
    }
  }, CONFIG.keepAliveInterval);
}

// Clear keep-alive interval
function clearKeepAliveInterval() {
  if (state.keepAliveInterval) {
    clearInterval(state.keepAliveInterval);
    state.keepAliveInterval = null;
  }
}

//=========================
// WebSocket chatbot 
//=========================

// Initialize WebSocket for Chat
function initChatWebSocket() {
  if (state.chatSocket) {
    // Clean up existing connection
    state.chatSocket.onclose = null; // Prevent automatic reconnect from the old handler
    state.chatSocket.close();
  }

  // First ensure we have the server URL properly set
  // Make sure CONFIG.serverUrl is defined earlier in your code
  if (!CONFIG.serverUrl) {
    CONFIG.serverUrl = "http://localhost:8000";
  }
  
  // Use the proper WebSocket protocol (ws:// instead of http://)
  const wsUrl = CONFIG.serverUrl.replace('http://', 'ws://');
  state.chatSocket = new WebSocket(`${wsUrl}/chatbot`);
  
  // Set up ping for keeping connection alive
  let pingInterval;
  
  // Event handlers
  state.chatSocket.onopen = () => {
    console.log('Chat WebSocket connection established');
    state.chatReconnectAttempts = 0;
    
    // Start sending periodic pings to keep connection alive
    pingInterval = setInterval(() => {
      if (state.chatSocket && state.chatSocket.readyState === WebSocket.OPEN) {
        try {
          state.chatSocket.send(JSON.stringify({ type: 'ping' }));
          console.log('Ping sent to server');
        } catch (e) {
          console.error('Error sending ping:', e);
        }
      }
    }, 30000); // Send ping every 30 seconds
    
    // Only show connected message if this is the first connection or a reconnection
    if (!state.pendingReconnect) {
      addSystemMessage('Connected to Mr. White assistant.');
    } else {
      state.pendingReconnect = false;
    }
  };

  state.chatSocket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('Received WebSocket data:', data); // Add debugging
      
      // Handle ping/pong messages
      if (data.type === 'pong') {
        console.log('Received pong from server');
        return;
      }
      
      // Handle progress messages with step indicators
      if (data.progress && data.status) {
        // If there's already a progress message, update it
        if (state.currentProgressMessage) {
          updateSystemMessageProgress(
            state.currentProgressMessage, 
            data.status, 
            {current: data.progress.current, total: data.progress.total}
          );
        } else {
          // Create a new progress message if one doesn't exist
          state.currentProgressMessage = addSystemMessage(
            data.status, 
            'loading', 
            {current: data.progress.current, total: data.progress.total}
          );
        }
        return;
      }
      
      // Handle typing indicator
      if (data.typing) {
        if (!state.isTyping) {
          state.isTyping = true;
          
          // If we have a progress indicator ongoing, don't show typing
          if (!state.currentProgressMessage) {
            showTypingIndicator();
            
            // If we haven't received a response after 5 seconds, show "thinking deeply" message
            clearTimeout(state.typingTimeout);
            state.typingTimeout = setTimeout(() => {
              updateTypingIndicator("Analyzing deeply");
            }, 5000);
          }
        }
        return;
      }
      
      // Clear any pending timeouts
      clearTimeout(state.typingTimeout);
      
      // Remove typing indicator when response arrives
      if (state.isTyping) {
        state.isTyping = false;
        removeTypingIndicator();
      }
      
      // Clear progress message when response is complete
      if (state.currentProgressMessage) {
        // You could either remove it:
        // elements.chatBox.removeChild(state.currentProgressMessage);
        // Or mark it as complete:
        updateSystemMessageProgress(
          state.currentProgressMessage, 
          "Process completed successfully", 
          null
        );
        state.currentProgressMessage = null;
      }
      
      // Handle response or error
      if (data.response) {
        if (CONFIG.enableTypingSimulation && data.response.length > 30) {
          // Simulate progressive typing for longer messages
          simulateProgressiveTyping(data.response);
        } else {
          // For short messages, just show immediately
          addBotMessage(data.response);
        }
      } else if (data.error) {
        addSystemMessage(`Error: ${data.error}`, 'error');
      }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
      // Don't show error to user for parsing issues
    }
  };

  state.chatSocket.onclose = (event) => {
    console.log('Chat WebSocket connection closed', event);
    
    // Clear ping interval
    clearInterval(pingInterval);
    
    // Clear any pending timeouts
    clearTimeout(state.typingTimeout);
    
    // Clear any progress messages
    if (state.currentProgressMessage) {
      updateSystemMessageProgress(
        state.currentProgressMessage,
        "Process interrupted due to connection loss",
        null
      );
      state.currentProgressMessage = null;
    }
    
    // Only attempt to reconnect if the document is visible
    if (document.visibilityState === 'visible') {
      if (state.chatReconnectAttempts < CONFIG.maxReconnectAttempts) {
        state.chatReconnectAttempts++;
        state.pendingReconnect = true;
        
        setTimeout(() => {
          initChatWebSocket();
        }, CONFIG.reconnectInterval);
      } else {
        addSystemMessage('Failed to reconnect. Please refresh the page.', 'error');
      }
    }
  };

  state.chatSocket.onerror = (error) => {
    console.error('Chat WebSocket error:', error);
    // Only show error if document is visible
    if (document.visibilityState === 'visible') {
      addSystemMessage('Connection error. Please try again later.', 'error');
    }
  };
}

// Send message to chat WebSocket
function sendChatMessage(message) {
  if (!state.chatSocket || state.chatSocket.readyState !== WebSocket.OPEN) {
    addSystemMessage('Not connected to server. Reconnecting...', 'error');
    initChatWebSocket();
    return false;
  }

  const payload = {
    user: CONFIG.username,
    message: message
  };

  try {
    state.chatSocket.send(JSON.stringify(payload));
    console.log('Message sent:', payload); // Add debugging
    
    // Create an initial progress message for long-running operations
    // Comment this out if you don't want progress indicators for regular chat messages
    /*
    state.currentProgressMessage = addSystemMessage(
      'Processing your request...',
      'loading',
      {current: 1, total: 3}
    );
    */
    
    return true;
  } catch (error) {
    console.error('Error sending message:', error);
    addSystemMessage('Failed to send message. Please try again.', 'error');
    return false;
  }
}

// Handle user sending a message
function handleUserSendMessage() {
  const message = elements.userInput.value.trim();
  
  if (!message) {
    return;
  }
  
  // Add user message to UI and clear input
  addUserMessage(message);
  elements.userInput.value = '';
  
  // Send message to server
  sendChatMessage(message);
}

//=========================
// Scan functionality with enhanced reliability
//=========================

// Initialize WebSocket connection for scanning
function initScanWebSocket() {
  console.log('🔍 INIT SCAN: Starting WebSocket initialization');
  
  // Ensure username is set
  if (!CONFIG.username || CONFIG.username.trim() === '') {
    CONFIG.username = 'user_' + Math.floor(Math.random() * 10000);  // Random username if not set
    console.log('Setting default username to:', CONFIG.username);
  }

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  console.log('🔍 DOM LOADED: Initializing scan functionality');
  
  // Initialize tracking arrays
  state.processedScans = state.processedScans || [];
  state.historyChecks = state.historyChecks || [];
  
  // Ensure username is set consistently
  if (!CONFIG.username || CONFIG.username.trim() === '') {
    CONFIG.username = 'user_' + Math.floor(Math.random() * 10000);
    console.log('Setting CONFIG.username on load to:', CONFIG.username);
  }
  
  // Ensure server URL is set
  if (!CONFIG.serverUrl) {
    CONFIG.serverUrl = "http://localhost:8000";
    console.log('Setting default server URL to:', CONFIG.serverUrl);
  }
  
  // Initialize WebSocket with a slight delay to ensure DOM is fully loaded
  setTimeout(() => {
    initScanWebSocket();
  }, 1000);
  
  // Add click handler to scan button
  if (elements.scanBtn) {
    console.log('Scan button found, adding click listener');
    elements.scanBtn.addEventListener('click', handleScanClick);
  } else {
    console.warn('Scan button not found in DOM');
  }
  
  // Set up ping interval to prevent timeouts
  if (CONFIG.pingInterval !== false) {
    setInterval(pingScanSocket, CONFIG.pingInterval || 15000); // 15 seconds
  }
});
  
  // Ensure server configuration is set
  if (!CONFIG.serverUrl) {
    CONFIG.serverUrl = "http://localhost:8000";
    console.log('Setting default server URL to:', CONFIG.serverUrl);
  }

  try {
    // Robust URL parsing for WebSocket URL
    const wsUrl = CONFIG.serverUrl.replace('http://', 'ws://').replace('https://', 'wss://');
    const scanWsUrl = `${wsUrl}/scan`;
    console.log('Scan WebSocket URL:', scanWsUrl);

    // Close existing socket if open
    if (state.scanSocket) {
      console.log('Closing existing scan socket connection');
      state.scanSocket.onclose = null; // Remove auto reconnect handler
      state.scanSocket.close();
      state.scanSocket = null;
    }

    // Create new WebSocket
    console.log('Creating new scan WebSocket connection');
    state.scanSocket = new WebSocket(scanWsUrl);
    state.scanReconnectAttempts = state.scanReconnectAttempts || 0;
    
    // Set up connection timeout
    const connectionTimeout = setTimeout(() => {
      if (state.scanSocket && state.scanSocket.readyState === WebSocket.CONNECTING) {
        console.error('❌ WebSocket Connection Timeout');
        state.scanSocket.close();
        addSystemMessage('Unable to connect to scan service. Check server status.', 'error');
      }
    }, 10000);

    // Connection success handler
    state.scanSocket.onopen = function() {
      clearTimeout(connectionTimeout);
      console.log('✅ Scan WebSocket Connected');
      
      // Reset reconnection attempts
      state.scanReconnectAttempts = 0;
      
      // Update UI
      if (elements.scanBtn) {
        elements.scanBtn.classList.remove('loading');
        elements.scanBtn.innerHTML = '<i class="fas fa-search"></i>';
      }
      
      // Send an initial ping with username to establish connection
      setTimeout(() => {
        pingScanSocket();
      }, 500);
      
      // Process any pending scan
      if (state.pendingScanUrl) {
        console.log('Processing pending scan for URL:', state.pendingScanUrl);
        const success = sendScanRequest(state.pendingScanUrl);
        if (success) {
          state.pendingScanUrl = null;
        }
      }
    };

    // Message handler
    state.scanSocket.onmessage = function(event) {
      console.log('📥 Scan message received:', event.data);
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        console.warn('Invalid JSON from server:', event.data);
        return;
      }

      // Log all message properties for debugging
      console.log('Message properties:', Object.keys(msg));

      // Handle different message types
      if (msg.type === 'pong') {
        console.log('Received pong from server');
      } else if (msg.processing) {
        // Update the progress message if it exists
        if (state.currentProgressMessage) {
          updateSystemMessageProgress(state.currentProgressMessage, 'Fetching URL content…', {current: 2, total: 5});
        } else {
          // Create a new progress message if one doesn't exist
          state.currentProgressMessage = addSystemMessage('Fetching URL content…', 'loading', {current: 2, total: 5});
        }
      } else if (msg.status) {
        // Handle different status messages with appropriate progress updates
        if (msg.status.includes('Processing')) {
          // Processing status (step 3)
          if (state.currentProgressMessage) {
            updateSystemMessageProgress(state.currentProgressMessage, msg.status, {current: 3, total: 5});
          } else {
            state.currentProgressMessage = addSystemMessage(msg.status, 'loading', {current: 3, total: 5});
          }
        } else if (msg.status.includes('Analyzing')) {
          // Analyzing status (step 4)
          if (state.currentProgressMessage) {
            updateSystemMessageProgress(state.currentProgressMessage, msg.status, {current: 4, total: 5});
          } else {
            state.currentProgressMessage = addSystemMessage(msg.status, 'loading', {current: 4, total: 5});
          }
        } else {
          // Regular status update (not part of the main progress flow)
          addSystemMessage(msg.status, 'info');
        }
      } else if (msg.error) {
        console.error('Scan Error:', msg.error);
        if (elements.scanBtn) {
          elements.scanBtn.classList.remove('loading');
          elements.scanBtn.innerHTML = '<i class="fas fa-search"></i>';
        }
        
        // If we have a progress message, update it to show the error
        if (state.currentProgressMessage) {
          updateSystemMessageProgress(state.currentProgressMessage, `Error: ${msg.error}`, null);
          state.currentProgressMessage = null;
        } else {
          addSystemMessage(`Scan Error: ${msg.error}`, 'error');
        }
        
        // Since we got an error, maybe check scan history as fallback
        if (state.currentScanUrl) {
          // Wait a bit before checking history
          setTimeout(() => {
            checkScanHistoryForResults(CONFIG.username, state.currentScanUrl);
          }, 5000);
        }
      } else if (msg.response) {
        console.log('Scan response received:', msg.response.substring(0, 50) + '...');
        if (elements.scanBtn) {
          elements.scanBtn.classList.remove('loading');
          elements.scanBtn.innerHTML = '<i class="fas fa-search"></i>';
        }
        
        // Update progress to complete if we have an active progress message
        if (state.currentProgressMessage) {
          updateSystemMessageProgress(state.currentProgressMessage, 'Scan completed successfully', {current: 5, total: 5});
          // Clear the current progress message since we're done
          state.currentProgressMessage = null;
        }
        
        // Clear current scan URL since we received a response
        const scannedUrl = state.currentScanUrl || msg.url;
        state.currentScanUrl = null;
        
        // Process the scan result
        processScanResult(msg.response, scannedUrl);
      } else {
        console.log('Unhandled message type:', msg);
      }
    };

    // Connection close handler
    state.scanSocket.onclose = function(event) {
      console.warn('⚠ Scan WebSocket Closed. Code:', event.code, 'Reason:', event.reason);
      
      // Update UI
      if (elements.scanBtn) {
        elements.scanBtn.classList.remove('loading');
        elements.scanBtn.innerHTML = '<i class="fas fa-search"></i>';
      }

      // If we have an active progress message, update it to show the interruption
      if (state.currentProgressMessage) {
        updateSystemMessageProgress(state.currentProgressMessage, 'Scan interrupted: Connection lost', null);
        state.currentProgressMessage = null;
      }

      // Check scan history as fallback if we have a pending scan
      if (state.currentScanUrl) {
        // Wait a bit before checking history
        setTimeout(() => {
          checkScanHistoryForResults(CONFIG.username, state.currentScanUrl);
        }, 5000);
      }

      // Handle reconnection
      if (document.visibilityState === 'visible' &&
          (!CONFIG.maxReconnectAttempts || 
           state.scanReconnectAttempts < CONFIG.maxReconnectAttempts)) {
        state.scanReconnectAttempts++;
        console.log(`Reconnection Attempt ${state.scanReconnectAttempts}`);
        
        // Use exponential backoff
        const reconnectDelay = Math.min(
          (CONFIG.reconnectInterval || 1000) * Math.pow(1.5, state.scanReconnectAttempts),
          30000
        );
        
        setTimeout(initScanWebSocket, reconnectDelay);
      }
    };

    // Error handler
    state.scanSocket.onerror = function(error) {
      console.error('❌ Scan WebSocket Error:', error);
      if (elements.scanBtn) {
        elements.scanBtn.classList.remove('loading');
        elements.scanBtn.innerHTML = '<i class="fas fa-search"></i>';
      }
      if (document.visibilityState === 'visible') {
        addSystemMessage('Scan connection error. Verify server connection.', 'error');
      }
    };

  } catch (error) {
    console.error('❌ WebSocket Initialization Error:', error);
    addSystemMessage('Failed to initialize scan service. Check configuration.', 'error');
  }
}

// Send scan request via WebSocket
function sendScanRequest(url) {
  console.log('🔍 SEND SCAN: Starting scan request for URL:', url);
  
  // Validate URL
  if (!url) {
    console.error('Empty URL provided');
    addSystemMessage('Invalid URL provided', 'error');
    return false;
  }
  
  // Create a progress message that we'll update throughout the scan process
  state.currentProgressMessage = addSystemMessage('Starting deep scan...', 'loading', {current: 1, total: 5});
  
  // Check if this is a shortened URL
  const shortenedDomains = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 
                          'rebrand.ly', 'cutt.ly', 'rb.gy', 'tiny.cc', 'bl.ink', 'snip.ly',
                          'short.io', 'trib.al', 'tiny.pl', 'bc.vc'];
  
  const isShortened = shortenedDomains.some(domain => {
    try {
      // Handle URLs without protocol
      let testUrl = url;
      if (!testUrl.startsWith('http')) {
        testUrl = 'http://' + testUrl;
      }
      const urlObj = new URL(testUrl);
      return urlObj.hostname.includes(domain);
    } catch (e) {
      return false;
    }
  });
  
  // Warn user about shortened URLs
  if (isShortened) {
    addSystemMessage('⚠️ Shortened URL detected. Analyzing redirect chain...', 'warning');
  }
  
  // Ensure URL has http/https prefix
  if (!url.startsWith('http')) {
    url = 'http://' + url;
    console.log('Added http:// prefix, URL is now:', url);
  }
  
  // Check WebSocket connection
  if (!state.scanSocket) {
    console.warn('No WebSocket connection available');
    addSystemMessage('Scan service not connected. Reconnecting...', 'info');
    state.pendingScanUrl = url;
    initScanWebSocket();
    return false;
  }
  
  // Verify connection is OPEN before sending
  if (state.scanSocket.readyState !== WebSocket.OPEN) {
    console.warn('WebSocket not ready. State:', state.scanSocket.readyState);
    addSystemMessage('Scan service connecting. Please try again in a moment.', 'info');
    state.pendingScanUrl = url;
    return false;
  }
  
  try {
    // Make sure username is set
    if (!CONFIG.username || CONFIG.username.trim() === '') {
      CONFIG.username = 'user_' + Math.floor(Math.random() * 10000);
      console.log('Using default username:', CONFIG.username);
    }

    // Create proper payload structure with metadata
    const payload = {
      user: CONFIG.username,
      url: url,
      message: url,  // Include URL as message for compatibility
      metadata: {    // Add metadata about the scan
        isShortened: isShortened,
        timestamp: Date.now(),
        clientInfo: navigator.userAgent
      }
    };
    
    console.log('Scan payload:', payload);
    
    // Store the current URL we're scanning for fallback mechanisms
    state.currentScanUrl = url;
    
    // Update progress to step 2
    updateSystemMessageProgress(state.currentProgressMessage, `Scanning URL: ${url}`, {current: 2, total: 5});
    
    // Send the request and update UI
    state.scanSocket.send(JSON.stringify(payload));
    console.log('✅ Scan request sent successfully');
    
    // Set up a timer to check scan history if we don't get a direct response
    setTimeout(() => {
      // Only check if we still have the same scan URL pending
      if (state.currentScanUrl === url) {
        console.log('No direct response received, checking scan history');
        checkScanHistoryForResults(CONFIG.username, url);
      }
    }, 15000); // Wait 15 seconds before checking history
    
    return true;
  } catch (e) {
    console.error('Failed to send scan request:', e);
    
    // Update progress message to show error
    if (state.currentProgressMessage) {
      updateSystemMessageProgress(state.currentProgressMessage, 'Failed to send scan data. Please try again.', null);
      state.currentProgressMessage = null;
    } else {
      addSystemMessage('Failed to send scan data. Please try again.', 'error');
    }
    
    return false;
  }
}

// Fallback to HTTP endpoint if WebSocket fails
function sendScanRequestViaHttp(url) {
  console.log('Attempting to scan via HTTP endpoint');
  
  if (!CONFIG.serverUrl) {
    console.error('No server URL configured');
    addSystemMessage('Server configuration error', 'error');
    return false;
  }
  
  if (!CONFIG.username) {
    CONFIG.username = 'user_' + Math.floor(Math.random() * 10000);
  }
  
  // Format URL for scan
  let scanUrl = url;
  if (!scanUrl.startsWith('http')) {
    scanUrl = 'http://' + scanUrl;
  }
  
  // Check if this is a shortened URL
  const shortenedDomains = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 
                          'rebrand.ly', 'cutt.ly', 'rb.gy', 'tiny.cc', 'bl.ink', 'snip.ly',
                          'short.io', 'trib.al', 'tiny.pl', 'bc.vc'];
  
  const isShortened = shortenedDomains.some(domain => {
    try {
      const urlObj = new URL(scanUrl);
      return urlObj.hostname.includes(domain);
    } catch (e) {
      return false;
    }
  });
  
  // Warn about shortened URLs
  if (isShortened) {
    addSystemMessage('⚠️ Shortened URL detected. Analyzing redirect chain...', 'warning');
  }
  
  // Create a progress message that we'll update throughout the HTTP scan process
  state.currentProgressMessage = addSystemMessage('Starting HTTP scan...', 'loading', {current: 1, total: 4});
  
  // Prepare API request
  const apiUrl = `${CONFIG.serverUrl}/api/scan`;
  const payload = {
    user: CONFIG.username,
    url: scanUrl,
    metadata: {
      isShortened: isShortened,
      timestamp: Date.now(),
      clientInfo: navigator.userAgent
    }
  };
  
  // Update progress message to step 2
  updateSystemMessageProgress(state.currentProgressMessage, `Scanning via HTTP: ${scanUrl}`, {current: 2, total: 4});
  
  // Send request to API endpoint
  fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  .then(response => {
    // Update progress to step 3
    updateSystemMessageProgress(state.currentProgressMessage, 'Processing scan data...', {current: 3, total: 4});
    
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    return response.json();
  })
  .then(data => {
    console.log('HTTP scan response:', data);
    
    // Update progress to step 4 (complete)
    updateSystemMessageProgress(state.currentProgressMessage, 'Scan completed successfully', {current: 4, total: 4});
    state.currentProgressMessage = null;
    
    if (data.status === 'success' && data.data && data.data.response) {
      // Process scan result
      processScanResult(data.data.response, scanUrl);
    } else if (data.error) {
      addSystemMessage(`Scan error: ${data.error}`, 'error');
    } else {
      addSystemMessage('No scan result returned', 'error');
    }
    
    // Reset button state
    if (elements.scanBtn) {
      elements.scanBtn.classList.remove('loading');
      elements.scanBtn.innerHTML = '<i class="fas fa-search"></i>';
    }
  })
  .catch(error => {
    console.error('Error in HTTP scan:', error);
    
    // Update progress message to show error
    if (state.currentProgressMessage) {
      updateSystemMessageProgress(state.currentProgressMessage, `Scan request failed: ${error.message}`, null);
      state.currentProgressMessage = null;
    } else {
      addSystemMessage(`Scan request failed: ${error.message}`, 'error');
    }
    
    // Reset button state
    if (elements.scanBtn) {
      elements.scanBtn.classList.remove('loading');
      elements.scanBtn.innerHTML = '<i class="fas fa-search"></i>';
    }
  });
  
  return true;
}

// Prompt for URL and initiate scan
function promptForScanData() {
  // Prompt for URL
  const url = prompt('Enter the URL to scan:');
  
  if (!url) {
    // User canceled or provided empty URL
    if (elements.scanBtn) {
      elements.scanBtn.classList.remove('loading');
      elements.scanBtn.innerHTML = '<i class="fas fa-search"></i>';
    }
    addSystemMessage('Scan canceled. No URL provided.', 'info');
    return;
  }
  
  // Process and validate URL
  let validUrl = url.trim();
  
  // Add protocol if missing
  if (!validUrl.includes('://')) {
    validUrl = 'http://' + validUrl;
  }
  
  // Validate URL format
  try {
    new URL(validUrl);
  } catch (e) {
    console.error('URL validation failed:', e);
    if (elements.scanBtn) {
      elements.scanBtn.classList.remove('loading');
      elements.scanBtn.innerHTML = '<i class="fas fa-search"></i>';
    }
    addSystemMessage('Invalid URL format. Please enter a valid URL.', 'error');
    return;
  }
  
  // First try WebSocket
  let success = sendScanRequest(validUrl);
  
  // If WebSocket fails, try HTTP endpoint as fallback
  if (!success) {
    console.log('WebSocket scan failed, trying HTTP endpoint');
    success = sendScanRequestViaHttp(validUrl);
  }
  
  if (!success) {
    // Reset button after delay if scan request failed
    setTimeout(() => {
      if (elements.scanBtn) {
        elements.scanBtn.classList.remove('loading');
        elements.scanBtn.innerHTML = '<i class="fas fa-search"></i>';
      }
    }, 2000);
  }
}

// Handle scan button click
function handleScanClick() {
  console.log('🔍 Scan button clicked');
  
  // Update UI
  if (elements.scanBtn) {
    elements.scanBtn.classList.add('loading');
    elements.scanBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  }
  
  // Ensure username is set consistently
  if (!CONFIG.username || CONFIG.username.trim() === '') {
    CONFIG.username = 'user_' + Math.floor(Math.random() * 10000);
    console.log('Setting default username for scan to:', CONFIG.username);
  }
  
  // Get URL from user and process
  promptForScanData();
}

// Keep connection alive with periodic pings
function pingScanSocket() {
  if (state.scanSocket && state.scanSocket.readyState === WebSocket.OPEN) {
    console.log('Sending ping to scan WebSocket');
    try {
      // Always include username in ping messages
      state.scanSocket.send(JSON.stringify({ 
        type: 'ping', 
        user: CONFIG.username || 'user_' + Math.floor(Math.random() * 10000)
      }));
    } catch (e) {
      console.warn('Error sending ping:', e);
    }
  }
}

// Check scan history for results if WebSocket fails
function checkScanHistoryForResults(username, url) {
  console.log('Checking scan history for results for URL:', url);
  
  // Create a progress message for history check if one doesn't exist
  if (!state.currentProgressMessage) {
    state.currentProgressMessage = addSystemMessage('Checking scan history...', 'loading', {current: 1, total: 3});
  } else {
    // Update existing progress message
    updateSystemMessageProgress(state.currentProgressMessage, 'Checking scan history...', {current: 1, total: 3});
  }
  
  // Ensure CONFIG is properly initialized
  if (!CONFIG) {
    console.error('CONFIG object is not defined');
    
    // Update progress message to show error
    if (state.currentProgressMessage) {
      updateSystemMessageProgress(state.currentProgressMessage, 'Configuration error. Please refresh the page.', null);
      state.currentProgressMessage = null;
    } else {
      addSystemMessage('Configuration error. Please refresh the page.', 'error');
    }
    return;
  }
  
  // Make sure server URL is set
  if (!CONFIG.serverUrl) {
    console.warn('No server URL configured for history check');
    CONFIG.serverUrl = window.location.origin || "http://localhost:8000";
    console.log('Using fallback server URL:', CONFIG.serverUrl);
  }
  
  // Ensure valid username
  const validUsername = (username && typeof username === 'string' && username.trim()) ? 
                        username.trim() : 'guest';
  
  // Set up API endpoint - ensure trailing slash is handled correctly
  let baseUrl = CONFIG.serverUrl;
  if (baseUrl.endsWith('/')) {
    baseUrl = baseUrl.slice(0, -1);
  }
  const apiUrl = `${baseUrl}/scan/${validUsername}`;
  console.log('Fetching scan history from:', apiUrl);
  
  // Update progress to step 2
  updateSystemMessageProgress(state.currentProgressMessage, 'Retrieving scan history...', {current: 2, total: 3});
  
  // Create request with more detailed headers
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Cache-Control': 'no-cache, no-store'
  };
  
  // Add a unique parameter to prevent caching
  const cacheBuster = `?cb=${Date.now()}`;
  
  // Get domain for comparison
  const urlDomain = getDomain(url);
  
  // Initialize tracking arrays if not exists
  if (!state.historyChecks) state.historyChecks = [];
  if (!state.processedScans) state.processedScans = [];
  
  // Track that we've initiated a history check for this URL
  if (state.historyChecks.includes(urlDomain)) {
    console.log('Already checked history for this domain');
    
    // Update progress message
    if (state.currentProgressMessage) {
      updateSystemMessageProgress(state.currentProgressMessage, 'History already checked for this domain', null);
      state.currentProgressMessage = null;
    }
    return;
  }
  state.historyChecks.push(urlDomain);
  
  // Setup retry logic variables
  let retryCount = 0;
  const maxRetries = 2;
  
  // Create the fetch function that will be called (and potentially retried)
  function performFetch() {
    console.log(`Attempt ${retryCount + 1} to fetch scan history`);
    
    // First check server status
    fetch(`${baseUrl}/health`, { method: 'GET', cache: 'no-store' })
      .then(response => {
        if (!response.ok) {
          throw new Error('Server health check failed');
        }
        console.log('Server health check passed, fetching scan history');
        
        // Actual history fetch
        return fetch(`${apiUrl}${cacheBuster}`, { 
          method: 'GET',
          headers: headers,
          cache: 'no-store'
        });
      })
      .then(response => {
        console.log('History API response status:', response.status);
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        console.log('Received scan history data:', data);
        
        // Update progress to step 3
        updateSystemMessageProgress(state.currentProgressMessage, 'Processing scan history...', {current: 3, total: 3});
        
        if (data && data.scan_pages && data.scan_pages.length > 0) {
          // Check the most recent scan first
          const latestScan = data.scan_pages[data.scan_pages.length - 1];
          
          console.log('Latest scan page:', latestScan.page ? latestScan.page.substring(0, 50) + '...' : 'null');
          
          // Check if this scan is for the URL we're looking for
          if (latestScan.page && latestScan.page.includes(urlDomain)) {
            console.log('Found scan result in history for:', urlDomain);
            
            // Check if we've already processed this scan
            if (!state.processedScans.includes(urlDomain)) {
              console.log('Processing scan result from history');
              
              // Update progress message to success
              if (state.currentProgressMessage) {
                updateSystemMessageProgress(state.currentProgressMessage, 'Found scan result in history', null);
                state.currentProgressMessage = null;
              }
              
              // Display the scan result
              processScanResult(latestScan.result, url);
              
              // Clear the current scan URL since we've found and processed it
              if (state.currentScanUrl === url) {
                state.currentScanUrl = null;
              }
              
              // Mark as processed
              state.processedScans.push(urlDomain);
            } else {
              console.log('Scan already processed, skipping');
              
              // Update progress message
              if (state.currentProgressMessage) {
                updateSystemMessageProgress(state.currentProgressMessage, 'Scan already processed', null);
                state.currentProgressMessage = null;
              }
            }
          } else {
            console.log('No matching scan found in history');
            
            // Update progress message
            if (state.currentProgressMessage) {
              updateSystemMessageProgress(state.currentProgressMessage, 'No scan results found for this URL. Try scanning again.', null);
              state.currentProgressMessage = null;
            } else {
              addSystemMessage('No scan results found for this URL. Try scanning again.', 'info');
            }
          }
        } else {
          console.log('No scan history available in response:', data);
          
          // Update progress message
          if (state.currentProgressMessage) {
            updateSystemMessageProgress(state.currentProgressMessage, 'No scan history available. Try a new scan.', null);
            state.currentProgressMessage = null;
          } else {
            addSystemMessage('No scan history available. Try a new scan.', 'info');
          }
        }
      })
      .catch(error => {
        console.error('Error fetching scan history:', error);
        
        // Try alternative endpoint if we haven't reached max retries
        if (retryCount < maxRetries) {
          retryCount++;
          console.log(`Retrying fetch ${retryCount}/${maxRetries} after error`);
          
          // Update progress message
          if (state.currentProgressMessage) {
            updateSystemMessageProgress(
              state.currentProgressMessage, 
              `Retrying history fetch (${retryCount}/${maxRetries})...`, 
              {current: 2, total: 3}
            );
          }
          
          // Use exponential backoff for retries
          setTimeout(performFetch, 1000 * retryCount);
        } else {
          // If all retries failed, try alternative endpoint as last resort
          tryAlternativeEndpoint();
        }
      });
  }
  
 // Fallback to direct API endpoint if regular endpoint fails
  function tryAlternativeEndpoint() {
    console.log('Trying alternative endpoint for scan results');
    
    // Update progress message
    if (state.currentProgressMessage) {
      updateSystemMessageProgress(
        state.currentProgressMessage, 
        'Trying alternative API endpoint...', 
        {current: 2, total: 3}
      );
    }
    
    // Use the /api/scan endpoint as fallback with POST method
    fetch(`${baseUrl}/api/scan`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        user: validUsername,
        url: url
      })
    })
    .then(response => response.json())
    .then(data => {
      // Update progress to step 3 (final)
      if (state.currentProgressMessage) {
        updateSystemMessageProgress(state.currentProgressMessage, 'Processing alternative data...', {current: 3, total: 3});
      }
      
      if (data.status === 'success' && data.data && data.data.response) {
        console.log('Retrieved scan result from alternative endpoint');
        
        // Update progress message to success
        if (state.currentProgressMessage) {
          updateSystemMessageProgress(state.currentProgressMessage, 'Retrieved scan result successfully', null);
          state.currentProgressMessage = null;
        }
        
        processScanResult(data.data.response, url);
        
        // Mark as processed
        if (!state.processedScans.includes(urlDomain)) {
          state.processedScans.push(urlDomain);
        }
        
        // Clear current URL
        if (state.currentScanUrl === url) {
          state.currentScanUrl = null;
        }
      } else {
        console.log('No result from alternative endpoint:', data);
        
        // Update progress message to show no results
        if (state.currentProgressMessage) {
          updateSystemMessageProgress(state.currentProgressMessage, 'Could not retrieve scan results. Please try scanning again.', null);
          state.currentProgressMessage = null;
        } else {
          addSystemMessage('Could not retrieve scan results. Please try scanning again.', 'error');
        }
      }
    })
    .catch(error => {
      console.error('Error from alternative endpoint:', error);
      
      if (state.currentProgressMessage) {
        updateSystemMessageProgress(state.currentProgressMessage, 'Generating Analysis', null);
        state.currentProgressMessage = null;
      }
    });
  }
  
  // Start the fetch process
  performFetch();
}

// Process scan results
function processScanResult(responseText, url) {
  console.log('Processing scan result for URL:', url);
  
  try {
      // Extract link and analysis
      let link = url; // Default to the original URL
      let analysis = '';
      let threatLevel = 'Unknown'; // Default threat level
      let redirectInfo = ''; // New field for redirect information
      
      // Parse structured response format
      const linkMatch = responseText.match(/link:\s*(.*?)(?:\s*\n|$)/i);
      const statusMatch = responseText.match(/status:\s*(.*?)(?:\s*\n|$)/i);
      const threatMatch = responseText.match(/threat level:\s*(.*?)(?:\s*\n|$)/i);
      const redirectMatch = responseText.match(/redirects:\s*(.*?)(?:\s*\n|$)/i);
      
      if (linkMatch && linkMatch[1]) {
          link = linkMatch[1].trim();
          // Remove any < > brackets that might be in the URL
          link = link.replace(/[<>]/g, '');
      }
      
      // Extract redirect information if available
      if (redirectMatch && redirectMatch[1]) {
          redirectInfo = redirectMatch[1].trim();
      }
      
      // Extract threat level if available
      if (threatMatch && threatMatch[1]) {
          threatLevel = threatMatch[1].trim();
      } else {
          // Determine threat level based on keywords in analysis
          const analysisLower = responseText.toLowerCase();
          
          if (analysisLower.includes('critical')) {
              threatLevel = 'Critical';
          } else if (analysisLower.includes('high risk') || analysisLower.includes('malicious')) {
              threatLevel = 'High';
          } else if (analysisLower.includes('medium') || analysisLower.includes('suspicious')) {
              threatLevel = 'Medium';
          } else if (analysisLower.includes('low risk') || analysisLower.includes('minor concern')) {
              threatLevel = 'Low';
          } else if (analysisLower.includes('safe')) {
              threatLevel = 'Safe';
          }
      }
      
      // Process the summary/analysis text from the response
      // Check if there's a structured analysis section
      let mainContents = responseText;
      
      // Try to extract content after numbered items (e.g., 1. 2. 3.)
      const numberedItems = responseText.match(/\d+\.\s+.*?(?=\d+\.|$)/gs);
      
      if (numberedItems && numberedItems.length) {
          // Format all numbered items nicely
          analysis = numberedItems.join('\n');
      } else {
          // Otherwise, use the whole response as the analysis
          analysis = responseText;
      }
      
      // Get appropriate color for threat level
      let threatColor;
      switch (threatLevel.toLowerCase()) {
          case 'safe':
              threatColor = '#00c853'; // Green
              break;
          case 'low':
              threatColor = '#aeea00'; // Light green/yellow
              break;
          case 'medium':
              threatColor = '#ffab00'; // Amber
              break;
          case 'high':
              threatColor = '#ff6d00'; // Orange
              break;
          case 'critical':
              threatColor = '#d50000'; // Red
              break;
          default:
              threatColor = '#757575'; // Grey for unknown
      }
      
      // Create HTML result with redirect information
      let resultHtml = `<div style="width:100%; text-align:center; background-color:${threatColor}; color:${threatLevel.toLowerCase() === 'low' || threatLevel.toLowerCase() === 'medium' ? '#000' : '#fff'}; padding:4px 0; font-weight:bold; margin-bottom:8px;">Threat Level: ${threatLevel}</div>`;
      
      // Add original URL
      resultHtml += `<strong>URL Scanned:</strong> ${url}<br>`;
      
      // Add redirect information if present
      if (redirectInfo && redirectInfo !== 'No') {
          resultHtml += `<strong>Redirects:</strong> ${redirectInfo}<br>`;
          
          // If final URL is different from original, show it
          if (link !== url) {
              resultHtml += `<strong>Final Destination:</strong> <a href="${link}" target="_blank">${link}</a><br>`;
          }
      }
      
      // Add the analysis
      resultHtml += `<strong>Analysis:</strong> ${analysis}`;
      
      // Add the scan result to the UI
      addScanResultMessage(resultHtml);
      
      // Track that we've processed this URL
      if (!state.processedScans) state.processedScans = [];
      
      // Use domain for comparison to avoid duplication
      const urlDomain = getDomain(url);
      if (!state.processedScans.includes(urlDomain)) {
          state.processedScans.push(urlDomain);
      }
      
      // Add warnings based on scan results
      if (threatLevel.toLowerCase() === 'high' || threatLevel.toLowerCase() === 'critical') {
          addSystemMessage(`⚠️ WARNING: This site has been identified as ${threatLevel.toLowerCase()} risk. Exercise extreme caution.`, 'warning');
      }
      
      // Add special warning for redirects to suspicious domains
      if (redirectInfo && redirectInfo !== 'No' && 
          (threatLevel.toLowerCase() === 'medium' || 
           threatLevel.toLowerCase() === 'high' || 
           threatLevel.toLowerCase() === 'critical')) {
          addSystemMessage(`⚠️ CAUTION: This shortened URL redirects to potentially unsafe content. Avoid clicking.`, 'warning');
      }
      
  } catch (e) {
      console.error('Error processing scan result:', e);
      addSystemMessage('Error processing scan result', 'error');
  }
}

// Helper function to extract domain from URL
function getDomain(urlString) {
  try {
    // Handle URLs without protocol
    if (!urlString.startsWith('http')) {
      urlString = 'http://' + urlString;
    }
    const parsedUrl = new URL(urlString);
    return parsedUrl.hostname;
  } catch (e) {
    console.error('Error extracting domain:', e);
    return urlString;
  }
}

//=========================
// Message Functions
//=========================

// Add bot message to chat with consistent Mr. White label
function addBotMessage(message) {
  const messageElem = document.createElement('div');
  messageElem.className = 'message bot';
  
  // Convert markdown-like formats
  message = formatMessage(message);
  
  // Include the Mr. White label consistently
  messageElem.innerHTML = `
    <span class="sender-label"><i class="fas fa-robot"></i> Mr. White</span>
    <div class="bot-text">${message}</div>
  `;
  
  elements.chatBox.appendChild(messageElem);
  scrollToBottom();
  
  // Add to message history
  state.messages.push({
    role: 'assistant',
    content: message
  });
  
  // Save messages to localStorage for persistence
  saveMessagesToStorage();
}

// Add system message with system label, better error handling, and progress bar support
// Add system message with system label, loading bar and progress support
function addSystemMessage(message, type = 'info', progress = null) {
  // Return if message is empty
  if (!message) {
    console.warn('Empty system message received');
    return;
  }

  const messageElem = document.createElement('div');
  messageElem.className = 'message bot system';
  
  // Add specific class for styling based on message type
  if (type) {
    messageElem.classList.add(`system-${type}`);
  }
  
  let icon = 'fa-info-circle';
  if (type === 'error') {
    icon = 'fa-exclamation-triangle';
  } else if (type === 'warning') {
    icon = 'fa-exclamation-circle';
  } else if (type === 'loading') {
    icon = 'fa-spinner fa-spin';
  }
  
  // Create progress indicator HTML if progress is provided
  let progressHtml = '';
  if (progress && typeof progress === 'object' && progress.current && progress.total) {
    // Calculate percentage
    const percentage = Math.round((progress.current / progress.total) * 100);
    
    progressHtml = `
      <div class="progress-indicator">
        <div class="progress-bar">
          <div class="progress-bar-fill" style="width: ${percentage}%"></div>
        </div>
        <span class="progress-text">${progress.current}/${progress.total}</span>
      </div>
    `;
  }
  
  messageElem.innerHTML = `
    <span class="sender-label">
      <i class="fas ${icon}"></i> System
      ${progressHtml}
    </span>
    <div class="bot-text">${message}</div>
  `;
  
  // Only add the message if elements.chatBox exists
  if (elements.chatBox) {
    elements.chatBox.appendChild(messageElem);
    scrollToBottom();
  } else {
    console.error('Chat box element not found');
  }
  
  // Add to message history for certain types of messages
  if (type !== 'error' && type !== 'warning' && type !== 'loading') {
    state.messages.push({
      role: 'system',
      content: message
    });
    saveMessagesToStorage();
  }
  
  // Log all system errors for debugging
  if (type === 'error') {
    console.error('System Error:', message);
  }
  
  // Return the message element so it can be updated later
  return messageElem;
}

// Function to update existing system message with new progress as a loading bar
function updateSystemMessageProgress(messageElem, message, progress) {
  if (!messageElem) {
    console.warn('Cannot update null message element');
    return messageElem;
  }
  
  // Update the progress indicator
  let progressIndicator = messageElem.querySelector('.progress-indicator');
  
  if (progress && typeof progress === 'object') {
    // Calculate percentage
    const percentage = Math.round((progress.current / progress.total) * 100);
    
    if (progressIndicator) {
      // Update existing progress bar
      const progressBar = progressIndicator.querySelector('.progress-bar-fill');
      if (progressBar) {
        progressBar.style.width = `${percentage}%`;
      }
      
      // Update the text indicator
      const progressText = progressIndicator.querySelector('.progress-text');
      if (progressText) {
        progressText.textContent = `${progress.current}/${progress.total}`;
      }
    } else {
      // Create new progress indicator if it doesn't exist
      const senderLabel = messageElem.querySelector('.sender-label');
      if (senderLabel) {
        progressIndicator = document.createElement('div');
        progressIndicator.className = 'progress-indicator';
        
        // Create the progress bar structure
        progressIndicator.innerHTML = `
          <div class="progress-bar">
            <div class="progress-bar-fill" style="width: ${percentage}%"></div>
          </div>
          <span class="progress-text">${progress.current}/${progress.total}</span>
        `;
        
        senderLabel.appendChild(progressIndicator);
      }
    }
  } else if (progressIndicator && !progress) {
    // If we're removing the progress indicator
    progressIndicator.remove();
  }
  
  // Update the message text if provided
  if (message) {
    const textDiv = messageElem.querySelector('.bot-text');
    if (textDiv) {
      textDiv.innerHTML = message;
    }
  }
  
  // Handle loading/normal state based on progress
  if (progress) {
    messageElem.classList.add('system-loading');
    
    // Update icon to spinner
    const iconElem = messageElem.querySelector('.sender-label i');
    if (iconElem) {
      iconElem.className = 'fas fa-spinner fa-spin';
    }
  } else {
    // If progress is null/undefined, we're done loading
    messageElem.classList.remove('system-loading');
    
    // Update icon back to info
    const iconElem = messageElem.querySelector('.sender-label i');
    if (iconElem) {
      iconElem.className = 'fas fa-info-circle';
    }
  }
  
  // Ensure we scroll to keep the updated message in view
  scrollToBottom();
  
  // Return the message element for further updates
  return messageElem;
}

// Add scan result message with Mr. White DeepScan label
function addScanResultMessage(message) {
  // Return if message is empty
  if (!message) {
    console.warn('Empty scan result message received');
    return;
  }
  
  const messageElem = document.createElement('div');
  messageElem.className = 'message bot scan-result';
  
  messageElem.innerHTML = `
    <span class="sender-label"><i class="fas fa-search glow-scan"></i> Mr. White DeepScan</span>
    <div class="bot-text">${message}</div>
  `;
  
  // Only add the message if elements.chatBox exists
  if (elements.chatBox) {
    elements.chatBox.appendChild(messageElem);
    scrollToBottom();
  } else {
    console.error('Chat box element not found');
  }
  
  // Add to message history with timestamp for better tracking
  state.messages.push({
    role: 'system',
    content: message,
    type: 'scan',
    timestamp: new Date().toISOString()
  });
  
  // Save messages to localStorage for persistence
  saveMessagesToStorage();
  
  // Trigger a scan completed event that other parts of the app might listen for
  document.dispatchEvent(new CustomEvent('scanCompleted', { 
    detail: { message: message }
  }));
}

// Add user message to chat with better validation
function addUserMessage(message) {
  // Return if message is empty
  if (!message || message.trim() === '') {
    console.warn('Empty user message received');
    return;
  }
  
  const messageElem = document.createElement('div');
  messageElem.className = 'message user';
  messageElem.textContent = message;
  
  // Only add the message if elements.chatBox exists
  if (elements.chatBox) {
    elements.chatBox.appendChild(messageElem);
    scrollToBottom();
  } else {
    console.error('Chat box element not found');
  }
  
  // Add to message history
  state.messages.push({
    role: 'user',
    content: message,
    timestamp: new Date().toISOString()
  });
  
  // Save messages to localStorage for persistence
  saveMessagesToStorage();
}

// Show typing indicator with consistent Mr. White label
function showTypingIndicator(message = "Thinking") {
  // Remove any existing typing indicator first
  removeTypingIndicator();
  
  // Only add the indicator if elements.chatBox exists
  if (!elements.chatBox) {
    console.error('Chat box element not found');
    return;
  }
  
  const typingElem = document.createElement('div');
  typingElem.className = 'message bot typing-indicator-container';
  typingElem.id = 'typing-indicator';
  
  typingElem.innerHTML = `
    <span class="sender-label"><i class="fas fa-robot"></i> Mr. White</span>
    <div class="typing-indicator">
      <span id="typing-text">${message}</span>
      <div class="dot-loader">
        <span>.</span>
        <span>.</span>
        <span>.</span>
      </div>
    </div>
  `;
  
  elements.chatBox.appendChild(typingElem);
  scrollToBottom();
}

// Update typing indicator text
function updateTypingIndicator(message) {
  const typingTextElem = document.getElementById('typing-text');
  if (typingTextElem) {
    typingTextElem.textContent = message;
  }
}

// Remove typing indicator
function removeTypingIndicator() {
  const typingElem = document.getElementById('typing-indicator');
  if (typingElem) {
    elements.chatBox.removeChild(typingElem);
  }
}

// Simulate progressive typing (character by character appearance)
function simulateProgressiveTyping(fullMessage) {
  // Return if message is empty
  if (!fullMessage) {
    console.warn('Empty message for progressive typing');
    return;
  }
  
  // Only add the message if elements.chatBox exists
  if (!elements.chatBox) {
    console.error('Chat box element not found');
    return;
  }
  
  // Create message container first
  const messageElem = document.createElement('div');
  messageElem.className = 'message bot';
  messageElem.id = 'progressive-message';
  
  // Start with empty content but include the Mr. White label
  messageElem.innerHTML = `
    <span class="sender-label"><i class="fas fa-robot"></i> Mr. White</span>
    <div class="bot-text" id="typing-content"></div>
  `;
  
  // Add to chat
  elements.chatBox.appendChild(messageElem);
  
  // Get the content element
  const contentElem = document.getElementById('typing-content');
  
  // Set up for progressive typing
  let charIndex = 0;
  const maxLength = fullMessage.length;
  
  // Determine typing speed based on message length
  const baseDelay = 15; // milliseconds per character for short messages
  const minDelay = 5;   // minimum delay for very long messages
  
  // Calculate delay: shorter for longer messages
  let typingDelay = Math.max(minDelay, baseDelay - Math.floor(maxLength / 500));
  
  // Add characters progressively
  function addNextChar() {
    if (charIndex < maxLength) {
      // Add next character
      contentElem.textContent = fullMessage.substring(0, charIndex + 1);
      charIndex++;
      
      // Scroll as needed
      scrollToBottom();
      
      // Randomize delay slightly for natural effect
      const randomizedDelay = typingDelay * (0.8 + Math.random() * 0.4);
      
      // Schedule next character
      setTimeout(addNextChar, randomizedDelay);
    } else {
      // When complete, set the full message with proper formatting
      // but make sure to preserve the Mr. White label
      const formattedMessage = formatMessage(fullMessage);
      messageElem.innerHTML = `
        <span class="sender-label"><i class="fas fa-robot"></i> Mr. White</span>
        <div class="bot-text">${formattedMessage}</div>
      `;
      messageElem.removeAttribute('id');
      
      // Add to message history
      state.messages.push({
        role: 'assistant',
        content: fullMessage,
        timestamp: new Date().toISOString()
      });
      
      // Save messages to localStorage for persistence
      saveMessagesToStorage();
    }
  }
  
  // Start the typing effect
  addNextChar();
}

// Format message (convert markdown-like syntax)
function formatMessage(message) {
  // Ensure message is a string
  if (typeof message !== 'string') {
    console.warn('Non-string message received for formatting:', message);
    return String(message);
  }
  
  return message
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

// Safe scroll to bottom with error handling
function scrollToBottom() {
  try {
    if (elements.chatBox) {
      elements.chatBox.scrollTop = elements.chatBox.scrollHeight;
    }
  } catch (e) {
    console.error('Error scrolling to bottom:', e);
  }
}

// Save messages to storage with error handling
function saveMessagesToStorage() {
  try {
    if (state.messages) {
      localStorage.setItem('mrWhiteMessages', JSON.stringify(state.messages.slice(-100))); // Keep last 100 messages
    }
  } catch (e) {
    console.error('Error saving messages to storage:', e);
  }
}


//=========================
// Persistence Utilities
//=========================

// Save messages to localStorage
function saveMessagesToStorage() {
  try {
    localStorage.setItem(`mrwhite_${CONFIG.username}_messages`, JSON.stringify(state.messages));
  } catch (error) {
    console.error('Error saving messages to localStorage:', error);
  }
}

// Load messages from localStorage
function loadMessagesFromStorage() {
  try {
    const savedMessages = localStorage.getItem(`mrwhite_${CONFIG.username}_messages`);
    
    if (savedMessages) {
      state.messages = JSON.parse(savedMessages);
      
      // Rebuild chat history in the UI
      rebuildChatFromHistory();
    }
  } catch (error) {
    console.error('Error loading messages from localStorage:', error);
  }
}

// Rebuild chat UI from message history
function rebuildChatFromHistory() {
  // Clear chat box first
  elements.chatBox.innerHTML = '';
  
  // Add all messages from history
  state.messages.forEach(msg => {
    if (msg.role === 'user') {
      const messageElem = document.createElement('div');
      messageElem.className = 'message user';
      messageElem.textContent = msg.content;
      elements.chatBox.appendChild(messageElem);
    } 
    else if (msg.role === 'assistant') {
      const messageElem = document.createElement('div');
      messageElem.className = 'message bot';
      
      // Format the message
      const formattedMessage = formatMessage(msg.content);
      
      // Add with proper Mr. White label
      messageElem.innerHTML = `
        <span class="sender-label"><i class="fas fa-robot"></i> Mr. White</span>
        <div class="bot-text">${formattedMessage}</div>
      `;
      
      elements.chatBox.appendChild(messageElem);
    }
    else if (msg.role === 'system' && msg.type === 'scan') {
      const messageElem = document.createElement('div');
      messageElem.className = 'message bot';
      
      messageElem.innerHTML = `
        <span class="sender-label"><i class="fas fa-shield-alt glow-scan"></i> Mr. White DeepScan</span>
        <div class="bot-text">${msg.content}</div>
      `;
      
      elements.chatBox.appendChild(messageElem);
    }
  });
  
  // Scroll to bottom after rebuilding
  scrollToBottom();
}

// Scroll chat to bottom
function scrollToBottom() {
  elements.chatBox.scrollTop = elements.chatBox.scrollHeight;
}

// Clear chat with persistence
function clearChat() {
  elements.chatBox.innerHTML = '';
  state.messages = [];
  
  // Clear localStorage
  try {
    localStorage.removeItem(`mrwhite_${CONFIG.username}_messages`);
  } catch (error) {
    console.error('Error clearing messages from localStorage:', error);
  }
  
  addSystemMessage('Chat cleared. Start a new conversation.');
}

// Toggle RWD (Real-time Web Detection)
function toggleRWD() {
  state.rpdActive = !state.rpdActive;
  
  if (state.rpdActive) {
    elements.rpdToggleBtn.classList.add('rpd-active');
    addSystemMessage('Real-time Web Detection activated. Your browsing is now protected.', 'info');
  } else {
    elements.rpdToggleBtn.classList.remove('rpd-active');
    addSystemMessage('Real-time Web Detection deactivated.', 'warning');
  }
  
  // If we're in a browser extension context, also handle the chrome API interaction
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    try {
      chrome.storage.local.get("rpdEnabled", (data) => {
        const newState = !data.rpdEnabled;
        chrome.runtime.sendMessage({ action: "toggleRPD", enabled: newState }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("Message Error:", chrome.runtime.lastError.message);
            return;
          }
        });
      });
    } catch (error) {
      console.log("Not in extension context or error accessing Chrome APIs:", error);
    }
  }
}

// Toggle theme
function toggleTheme() {
  state.darkTheme = !state.darkTheme;
  
  if (state.darkTheme) {
    document.body.classList.remove('light-theme');
    elements.themeToggle.classList.remove('theme-active');
  } else {
    document.body.classList.add('light-theme');
    elements.themeToggle.classList.add('theme-active');
  }
}

// Scroll controls
function initScrollControls() {
  elements.scrollLeft.addEventListener('click', () => {
    const scrollAmount = -100;
    const scrollWrapper = document.querySelector('.scroll-wrapper');
    scrollWrapper.scrollBy({
      left: scrollAmount,
      behavior: 'smooth'
    });
  });
  
  elements.scrollRight.addEventListener('click', () => {
    const scrollAmount = 100;
    const scrollWrapper = document.querySelector('.scroll-wrapper');
    scrollWrapper.scrollBy({
      left: scrollAmount,
      behavior: 'smooth'
    });
  });
}

//=========================
// Event Listeners
//=========================

function initEventListeners() {
  // Send button click
  elements.sendBtn.addEventListener('click', handleUserSendMessage);
  
  // Enter key in input
  elements.userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleUserSendMessage();
    }
  });
  
  // Scan button click
  elements.scanBtn.addEventListener('click', handleScanClick);
  
  // RWD toggle click
  elements.rpdToggleBtn.addEventListener('click', toggleRWD);
  
  // Trash button click
  elements.trashBtn.addEventListener('click', clearChat);
  
  // Theme toggle click
  elements.themeToggle.addEventListener('click', toggleTheme);
}

//=========================
// Browser Extension Support
//=========================

// Handle Chrome extension messages if in extension context
if (typeof chrome !== 'undefined' && chrome.runtime) {
  try {
    // Prevent duplicate scan results from showing
    let lastScanResultHash = null;

    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === "scan-report" && msg.from === "background") {
        const issues = msg.result;
        const resultHash = JSON.stringify(issues);

        // Prevent duplicate messages
        if (resultHash === lastScanResultHash) return;
        lastScanResultHash = resultHash;

        if (issues.length > 0) {
          addSystemMessage("Website Issues Detected:\n" + issues.join("\n"), "warning");
        } else {
          const linkCount = msg.linksDetected ?? 0;
          addSystemMessage(`No suspicious activities detected in the current website.\n🔍 ${linkCount} links analyzed.`, "info");
        }
      }
    });

    // Sync RPD state on load
    function syncRPDState() {
      try {
        chrome.storage.local.get("rpdEnabled", (data) => {
          if (data.rpdEnabled) {
            state.rpdActive = true;
            elements.rpdToggleBtn.classList.add('rpd-active');
          } else {
            state.rpdActive = false;
            elements.rpdToggleBtn.classList.remove('rpd-active');
          }
        });
      } catch (error) {
        console.error("Error syncing RPD state:", error);
      }
    }

    // Initialize extension-specific features
    document.addEventListener("DOMContentLoaded", syncRPDState);
  } catch (error) {
    console.log("Error setting up Chrome extension handlers:", error);
  }
}

//=========================
// Initialization
//=========================

function init() {
  // Initialize WebSockets
  initChatWebSocket();
  initScanWebSocket();
  
  // Initialize tab visibility handling
  initTabVisibilityHandling();
  
  // Initialize UI components
  initScrollControls();
  initEventListeners();
  
  // Load message history from localStorage
  loadMessagesFromStorage();
  
  // Welcome message if no history
  if (state.messages.length === 0) {
    addSystemMessage('Welcome to Mr. White Security Assistant. How can I help you today?');
  }
}

// Start the application
document.addEventListener('DOMContentLoaded', init);