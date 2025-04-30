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

  state.chatSocket = new WebSocket(`${CONFIG.serverUrl}/chatbot`);
  CONFIG.serverUrl = "http://localhost:8000";
  
  // Event handlers
  state.chatSocket.onopen = () => {
    console.log('Chat WebSocket connection established');
    state.chatReconnectAttempts = 0;
    
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
      
      // Ignore heartbeat acknowledgements
      if (data.type === 'heartbeat') {
        return;
      }
      
      // Handle typing indicator
      if (data.typing) {
        if (!state.isTyping) {
          state.isTyping = true;
          showTypingIndicator();
          
          // If we haven't received a response after 5 seconds, show "thinking deeply" message
          clearTimeout(state.typingTimeout);
          state.typingTimeout = setTimeout(() => {
            updateTypingIndicator("Analyzing deeply");
          }, 5000);
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
    
    // Clear any pending timeouts
    clearTimeout(state.typingTimeout);
    
    // Only attempt to reconnect if the document is visible
    if (document.visibilityState === 'visible') {
      if (state.chatReconnectAttempts < CONFIG.maxReconnectAttempts) {
        state.chatReconnectAttempts++;
        state.pendingReconnect = true;
        addSystemMessage(`Connection lost. Reconnecting (${state.chatReconnectAttempts}/${CONFIG.maxReconnectAttempts})...`);
        
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
    CONFIG.username = 'user_3337';  // Consistent username 
    console.log('Setting default username to:', CONFIG.username);
  }
  
  if (!CONFIG.serverUrl) {
    console.error('❌ No server URL configured');
    addSystemMessage('Server configuration error: Missing server URL', 'error');
    return;
  }

  try {
    // Robust URL parsing
    const urlObj = new URL(CONFIG.serverUrl);
    const wsProto = urlObj.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsPort = urlObj.port ? `:${urlObj.port}` : '';
    const wsUrl = `${wsProto}//${urlObj.hostname}${wsPort}/scan`;
    console.log('WebSocket URL:', wsUrl);

    // Close existing socket if open
    if (state.scanSocket) {
      console.log('Closing existing scan socket connection');
      state.scanSocket.close();
      state.scanSocket = null;
    }

    // Create new WebSocket with onopen/onmessage instead of addEventListener
    console.log('Creating new WebSocket connection');
    state.scanSocket = new WebSocket(wsUrl);
    state.scanReconnectAttempts = state.scanReconnectAttempts || 0;
    
    // Set up connection timeout
    const connectionTimeout = setTimeout(() => {
      if (state.scanSocket && state.scanSocket.readyState === WebSocket.CONNECTING) {
        console.error('❌ WebSocket Connection Timeout');
        state.scanSocket.close();
        addSystemMessage('Unable to connect to scan service. Check server status.', 'error');
      }
    }, 10000);

    // Connection success handler - using onopen for better reliability
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

    // Message handler - using onmessage for better reliability
    state.scanSocket.onmessage = function(event) {
      console.log('📥 Message received:', event.data);
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        console.warn('Invalid JSON from server:', event.data);
        return;
      }

      // Handle different message types
      if (msg.processing) {
        addSystemMessage('Fetching URL content…', 'info');
      } else if (msg.status) {
        addSystemMessage(msg.status, 'info');
      } else if (msg.error) {
        console.error('Scan Error:', msg.error);
        if (elements.scanBtn) {
          elements.scanBtn.classList.remove('loading');
          elements.scanBtn.innerHTML = '<i class="fas fa-search"></i>';
        }
        addSystemMessage(`Scan Error: ${msg.error}`, 'error');
        
        // Since we got an error, maybe check scan history as fallback
        if (state.currentScanUrl) {
          // Wait a bit before checking history
          setTimeout(() => {
            checkScanHistoryForResults(CONFIG.username, state.currentScanUrl);
          }, 5000);
        }
      } else if (msg.response) {
        console.log('Scan response received');
        if (elements.scanBtn) {
          elements.scanBtn.classList.remove('loading');
          elements.scanBtn.innerHTML = '<i class="fas fa-search"></i>';
        }
        
        // Clear current scan URL since we received a response
        const scannedUrl = state.currentScanUrl || msg.url;
        state.currentScanUrl = null;
        
        // Process the scan result
        processScanResult(msg.response, scannedUrl);
      } else if (msg.type === 'pong') {
        console.log('Received pong from server');
      }
    };

    function addScanResultToChat(result, url) {
      // Extract link and analysis
      let link = url; // Default to the original URL
      let analysis = '';
      
      // Parse structured response format
      const linkMatch = result.match(/link:\s*(.*?)(?:\s*\n|$)/i);
      const analysisMatch = result.match(/analyze:\s*([\s\S]*)/i);
      
      if (linkMatch && linkMatch[1]) {
          link = linkMatch[1].trim();
          link = link.replace(/[<>]/g, '');
      }
      
      if (analysisMatch && analysisMatch[1]) {
          analysis = analysisMatch[1].trim();
      } else {
          analysis = result;
      }
      
      // Format a message that will also be added to the chat history
      const chatMessage = `I've analyzed the URL: ${link}\n\nAnalysis: ${analysis}`;
      
      // Add this as a bot message to ensure it's part of the conversation history
      addBotMessage(chatMessage);
  }

    // Connection close handler
    state.scanSocket.onclose = function(event) {
      console.warn('⚠ Scan WebSocket Closed. Code:', event.code, 'Reason:', event.reason);
      
      // Update UI
      if (elements.scanBtn) {
        elements.scanBtn.classList.remove('loading');
        elements.scanBtn.innerHTML = '<i class="fas fa-search"></i>';
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
          (CONFIG.reconnectInterval || 1000) * Math.pow(2, state.scanReconnectAttempts),
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

function sendScanRequest(url) {
  console.log('🔍 SEND SCAN: Starting scan request for URL:', url);
  
  // Validate URL
  if (!url) {
    console.error('Empty URL provided');
    addSystemMessage('Invalid URL provided', 'error');
    return false;
  }
  
  // Ensure URL has http/https prefix
  if (!url.startsWith('http')) {
    url = 'http://' + url;
    console.log('Added http:// prefix, URL is now:', url);
  }
  
  // Check WebSocket connection - explicitly check for null
  if (!state.scanSocket) {
    console.warn('No WebSocket connection available');
    addSystemMessage('Scan service not connected. Reconnecting...', 'error');
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
    // Use a consistent username - crucial for the scan to work
    if (!CONFIG.username || CONFIG.username.trim() === '') {
      CONFIG.username = 'martinsy';  // Use a consistent username
      console.log('Using default username:', CONFIG.username);
    }

    // Create payload with both url and message fields
    const payload = {
      user: CONFIG.username,
      url: url,
      message: url  // Include URL as message for compatibility
    };
    
    console.log('Scan payload:', payload);
    
    // Store the current URL we're scanning for fallback mechanisms
    state.currentScanUrl = url;
    
    // Send the request
    state.scanSocket.send(JSON.stringify(payload));
    console.log('✅ Scan request sent successfully');
    
    // Set up a timer to check scan history if we don't get a direct response
    setTimeout(() => {
      // Only check if we still have the same scan URL pending
      if (state.currentScanUrl === url) {
        checkScanHistoryForResults(CONFIG.username, url);
      }
    }, 15000); // Wait 15 seconds before checking history
    
    return true;
  } catch (e) {
    console.error('Failed to send scan request:', e);
    addSystemMessage('Failed to send scan data. Please try again.', 'error');
    return false;
  }
}

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
    console.log('Added http:// prefix, URL is now:', validUrl);
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
  
  // Ensure username is set consistently
  if (!CONFIG.username || CONFIG.username.trim() === '') {
    CONFIG.username = 'user_3337';
    console.log('Setting default username to:', CONFIG.username);
  }
  
  // Show scanning message
  addSystemMessage('Starting deep scan...', 'info');
  
  // Send scan request
  const success = sendScanRequest(validUrl);
  
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

function handleScanClick() {
  console.log('🔍 Scan button clicked');
  
  // Update UI
  if (elements.scanBtn) {
    elements.scanBtn.classList.add('loading');
    elements.scanBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  }
  
  // Ensure username is set consistently
  if (!CONFIG.username || CONFIG.username.trim() === '') {
    CONFIG.username = 'user_3337';
    console.log('Setting default username for scan to:', CONFIG.username);
  }
  
  // Get URL from user and process
  promptForScanData();
}

// Keep connection alive with periodic pings - IMPROVED to include username
function pingScanSocket() {
  if (state.scanSocket && state.scanSocket.readyState === WebSocket.OPEN) {
    console.log('Sending ping to keep connection alive');
    try {
      // Always include username in ping messages - CRITICAL FIX
      state.scanSocket.send(JSON.stringify({ 
        type: 'ping', 
        user: CONFIG.username || 'user_3337' 
      }));
    } catch (e) {
      console.warn('Error sending ping:', e);
    }
  }
}

// Helper function to process scan results - FIXED to properly display URL
function processScanResult(responseText, url) {
  console.log('Processing detailed scan result for URL:', url);
  
  try {
      // Extract link and analysis
      let link = url; // Default to the original URL
      let analysis = '';
      let threatLevel = 'Unknown'; // Default threat level
      
      // Parse structured response format
      const linkMatch = responseText.match(/link:\s*(.*?)(?:\s*\n|$)/i);
      const analysisMatch = responseText.match(/analyze:\s*([\s\S]*)/i);
      const threatMatch = responseText.match(/threat level:\s*(.*?)(?:\s*\n|$)/i);
      
      if (linkMatch && linkMatch[1]) {
          link = linkMatch[1].trim();
          // Remove any < > brackets that might be in the URL
          link = link.replace(/[<>]/g, '');
      }
      
      if (analysisMatch && analysisMatch[1]) {
          analysis = analysisMatch[1].trim();
      } else {
          // Fallback - use entire response if no match
          analysis = responseText;
      }
      
      // Extract threat level if available
      if (threatMatch && threatMatch[1]) {
          threatLevel = threatMatch[1].trim();
      } else {
          // Determine threat level based on keywords in analysis
          const lowRiskWords = ['low risk', 'minor concern', 'generally safe'];
          const mediumRiskWords = ['caution', 'suspicious', 'potential concern'];
          const highRiskWords = ['high risk', 'dangerous', 'malicious', 'phishing'];
          const criticalRiskWords = ['critical', 'immediate danger', 'compromised'];
          
          const analysisLower = analysis.toLowerCase();
          
          if (criticalRiskWords.some(word => analysisLower.includes(word))) {
              threatLevel = 'Critical';
          } else if (highRiskWords.some(word => analysisLower.includes(word))) {
              threatLevel = 'High';
          } else if (mediumRiskWords.some(word => analysisLower.includes(word))) {
              threatLevel = 'Medium';
          } else if (lowRiskWords.some(word => analysisLower.includes(word))) {
              threatLevel = 'Low';
          } else if (analysisLower.includes('safe') || analysisLower.includes('no issues')) {
              threatLevel = 'Safe';
          }
      }
      
      // Ensure URL is displayed properly
      if (!link || link === "") {
          link = url; // Fallback to original URL if extraction failed
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
      
// Create a more compact HTML result with minimal spacing and threat level
const resultHtml = `<div style="width:100%; text-align:center; background-color:${threatColor}; color:${threatLevel.toLowerCase() === 'low' || threatLevel.toLowerCase() === 'medium' ? '#000' : '#fff'}; padding:4px 0; font-weight:bold; margin-bottom:8px;">Threat Level: ${threatLevel}</div><strong>URL:</strong> <a href="${link}" target="_blank">${link}</a><br><strong>Analysis:</strong> ${analysis}`;
      
      // Add the scan result to the UI
      addScanResultMessage(resultHtml);
      
      // Add to history if function exists
      if (typeof addToScanHistory === 'function') {
          addToScanHistory(link, analysis, threatLevel);
      }
      
      // Track that we've processed this URL
      if (!state.processedScans) state.processedScans = [];
      
      // Use domain for comparison to avoid duplication
      const urlDomain = getDomain(url);
      if (!state.processedScans.includes(urlDomain)) {
          state.processedScans.push(urlDomain);
      }
      
      // Add warning for high risk levels
      if (threatLevel.toLowerCase() === 'high' || threatLevel.toLowerCase() === 'critical') {
          addSystemMessage(`⚠️ WARNING: This site has been identified as ${threatLevel.toLowerCase()} risk. Exercise extreme caution.`, 'warning');
      }
      
  } catch (e) {
      console.error('Error processing scan result:', e);
      addSystemMessage('Error processing scan result', 'error');
  }
}

// Helper function to extract domain from URL (add if not already present)
function getDomain(url) {
    try {
        // Handle URLs without protocol
        if (!url.includes('://')) {
            url = 'http://' + url;
        }
        
        const urlObj = new URL(url);
        return urlObj.hostname;
    } catch (e) {
        console.error('Error extracting domain:', e);
        return url; // Return the original URL as fallback
    }
}

// Check scan history for results if WebSocket fails - Modified to remove API key
function checkScanHistoryForResults(username, url) {
  console.log('Checking scan history for results for URL:', url);
  
  if (!CONFIG.serverUrl) {
    console.warn('No server URL configured for history check');
    return;
  }
  
  // Set up API endpoint
  const apiUrl = `${CONFIG.serverUrl}/scan/${username}`;
  console.log('Fetching scan history from:', apiUrl);
  
  // Create request with simple headers - no API key needed
  const headers = {
    'Content-Type': 'application/json'
  };
  
  // Get domain for comparison
  const urlDomain = getDomain(url);
  
  // Track that we've initiated a history check for this URL
  if (!state.historyChecks) state.historyChecks = [];
  if (state.historyChecks.includes(urlDomain)) {
    console.log('Already checked history for this domain');
    return;
  }
  state.historyChecks.push(urlDomain);
  
  // Fetch scan history
  fetch(apiUrl, { headers })
    .then(response => {
      console.log('History API response status:', response.status);
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      console.log('Received scan history:', data);
      
      if (data && data.scan_pages && data.scan_pages.length > 0) {
        // Check the most recent scan first
        const latestScan = data.scan_pages[data.scan_pages.length - 1];
        
        // Check if this scan is for the URL we're looking for
        if (latestScan.page && latestScan.page.includes(urlDomain)) {
          console.log('Found scan result in history for:', urlDomain);
          
          // Check if we've already processed this scan
          if (!state.processedScans || !state.processedScans.includes(urlDomain)) {
            console.log('Processing scan result from history');
            
            // Display the scan result
            processScanResult(latestScan.result, url);
            
            // Clear the current scan URL since we've found and processed it
            if (state.currentScanUrl === url) {
              state.currentScanUrl = null;
            }
          } else {
            console.log('Scan already processed, skipping');
          }
        } else {
          console.log('No matching scan found in history');
          addSystemMessage('No scan results found for this URL. Try scanning again.', 'info');
        }
      } else {
        console.log('No scan history available');
        addSystemMessage('No scan history available', 'info');
      }
    })
    .catch(error => {
      console.error('Error fetching scan history:', error);
      addSystemMessage(`Error retrieving scan history: ${error.message}`, 'error');
    });
}

// Helper function to extract domain from URL
function getDomain(urlString) {
  try {
    const parsedUrl = new URL(urlString);
    return parsedUrl.hostname;
  } catch (e) {
    // If parsing fails, just return the original string
    return urlString;
  }
}

// Initialize on DOM load - IMPROVED with consistent username
document.addEventListener('DOMContentLoaded', () => {
  console.log('🔍 DOM LOADED: Initializing scan functionality');
  
  // Initialize tracking arrays
  state.processedScans = state.processedScans || [];
  state.historyChecks = state.historyChecks || [];
  
  // Ensure username is set consistently
  if (!CONFIG.username || CONFIG.username.trim() === '') {
    console.log('Setting CONFIG.username on load to "user_3337"');
    CONFIG.username = 'user_3337';  // FIXED: Use a consistent username
  }
  
  // Initialize WebSocket with a slight delay to ensure DOM is fully loaded
  setTimeout(() => {
    initScanWebSocket();
  }, 500);
  
  // Add click handler to scan button
  if (elements.scanBtn) {
    console.log('Scan button found, adding click listener');
    elements.scanBtn.addEventListener('click', handleScanClick);
  } else {
    console.warn('Scan button not found in DOM');
  }
  
  // Set up ping interval to prevent timeouts - decreased interval for more reliability
  if (CONFIG.pingInterval !== false) {
    setInterval(pingScanSocket, CONFIG.pingInterval || 15000); // 15 seconds
  }
});

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

// Add system message with system label and better error handling
function addSystemMessage(message, type = 'info') {
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
  }
  
  messageElem.innerHTML = `
    <span class="sender-label"><i class="fas ${icon}"></i> System</span>
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
  if (type !== 'error' && type !== 'warning') {
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