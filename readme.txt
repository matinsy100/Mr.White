# Let's create the requested README content as a .txt file
readme_content = """

Mr. White is an advanced Chrome extension (Manifest V3) that integrates Deep Scan phishing detection, keylogger detection, AI-powered analysis, and Real-time Website Detection (RWD) into one seamless platform. It automatically scans websites and links while users browse or review emails, instantly detecting threats and delivering real-time security alerts, insights, and safe browsing tips — all through an intuitive, chat-based interface.

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
    Start Ollama
======================================
ollama serve

Or open the Ollama desktop app.

=============== Step 4 ===============
    Start the FastAPI Server
======================================
python yourfilename.py

Or with auto-reload:
uvicorn yourfilename:app --reload --host 0.0.0.0 --port 8000

✅ After starting, copy the API Key printed in the terminal.

=============== Step 5 ===============
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
======================================
- Your extension’s server URL must match:

serverUrl: "http://localhost:8000"
wsBaseUrl: "ws://localhost:8000"

Extension is created by Martin Sy
https://www.linkedin.com/in/matin-sy/

