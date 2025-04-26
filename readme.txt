# Let's create the requested README content as a .txt file
readme_content = """

=============================================================================================================================
Mr. White is an advanced Chrome extension (Manifest V3) that integrates Deep Scan phishing detection, keylogger detection, AI-powered analysis, and Real-time Website Detection (RWD) into one seamless platform. It automatically scans websites and links while users browse or review emails, instantly detecting threats and delivering real-time security alerts, insights, and safe browsing tips — all through an intuitive, chat-based interface.
=============================================================================================================================

future updates

1. Attachment Risk Warning (Without Downloading)
   Mr. White will detect the presence of attachments during email scans based on file names and types, without downloading or opening any files. Suspicious file types (e.g., .exe, .zip, .scr, .docm) will trigger 
   a warning to alert users before they interact with the email.

2. Screenshot Upload for Threat Analysis
   Users will be able to attach screenshots (e.g., suspicious login pages, phishing attempts) directly into the chat. Mr. White will analyze the images using AI to detect signs of phishing forms, fake branding, 
   or impersonation attempts, providing real-time security feedback.

3. Advanced Threat Intelligence Integration
   Integrate external threat intelligence feeds to recognize newly reported phishing sites, malicious domains, and suspicious web behaviors in real time, improving Mr. White’s scanning accuracy and coverage.

4. 7B AI Model Support for Deep Analysis
   Upgrade Mr. White’s AI backend to support larger, more powerful 7B parameter models for enhanced phishing detection, content analysis, and behavioral threat recognition. This will enable deeper reasoning, 
   better identification of complex phishing patterns, and broader multilingual threat detection with faster, more accurate responses.

5. Software Integration Support (APIs and Webhooks)
   Expand Mr. White’s capabilities by providing APIs and Webhook integrations, allowing external software platforms (such as email gateways, browsers, ticketing systems, and security dashboards) to connect, 
   trigger scans, receive threat analysis results, and automate security responses.

=============================================================================================================================

Video how it works = https://www.linkedin.com/feed/update/urn:li:activity:7321516923509202945/


Mr. White API & Chrome Extension Setup

=============== Step 1 ===============
    Install Python Requirements
======================================
pip install -r requirements.txt



=============== Step 2 ===============
    Install the AI-Model
======================================
ollama run matinsy/mr.white

Or visit manually:
https://ollama.com/matinsy/mr.white



=============== Step 3 ===============
    Start the FastAPI Server
======================================
python yourfilename.py

Or with auto-reload:
uvicorn yourfilename:app --reload --host 0.0.0.0 --port 8000

✅ After starting, copy the API Key printed in the terminal.

=============== Step 4 ===============
    Load the Chrome/Edge/Firefox Extension
======================================
1. Open your browser.
2. Go to:
   - Chrome: chrome://extensions
   - Edge: edge://extensions
   - Firefox: about:addons
3. Enable Developer Mode (top right).
4. Unload/Remove any old version.
5. Click Load Unpacked or Install Temporary Add-on and select your extension folder.

=============== Important Notes ===============
===============================================
- Your extension’s server URL must match:

serverUrl: "http://localhost:8000"
wsBaseUrl: "ws://localhost:8000"

Extension is created by Martin Sy
https://www.linkedin.com/in/matin-sy/

