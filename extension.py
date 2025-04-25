from fastapi import FastAPI, HTTPException, Body, WebSocket, WebSocketDisconnect, Depends, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, Field
from datetime import datetime
from pathlib import Path
import json
import asyncio
import ollama
from typing import List, Dict, Optional, Any
import re
import secrets
from contextlib import asynccontextmanager
import requests
from urllib.parse import urlparse
from starlette.websockets import WebSocketState

# === Constants ===
VERSION = "1.0.0"
MAX_SCAN_HISTORY = 5  # increased from 2
MAX_MEMORY_TURNS = 10
MODEL_NAME = "matinsy/mr.white"
API_KEY = secrets.token_urlsafe(32)  # Generate a random API key for demo purposes

# === App Setup with lifespan for startup/shutdown ===
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print(f"Starting Mr. White API v{VERSION}")
    print(f"API Key: {API_KEY}")  # In production, don't print this - set it securely
    LOG_BASE.mkdir(parents=True, exist_ok=True)
    CONV_DIR.mkdir(exist_ok=True)
    SCAN_DIR.mkdir(exist_ok=True)
    yield
    # Shutdown
    print("Shutting down Mr. White API")

app = FastAPI(
    title="Mr. White Security API",
    description="API for security scanning and chat interactions",
    version=VERSION,
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, limit this to your frontend's origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# === Paths & Model ===
LOG_BASE = Path.home() / "Desktop" / "mr.white"
CONV_DIR = LOG_BASE / "conversations"
SCAN_DIR = LOG_BASE / "scan_pages"

# === Security ===
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

async def get_api_key(api_key_header: Optional[str] = Security(api_key_header)):
    if api_key_header == API_KEY:
        return api_key_header
    raise HTTPException(
        status_code=403, 
        detail="Invalid API key. Please provide a valid API key in the X-API-Key header."
    )

# === Schema ===
class ChatRequest(BaseModel):
    user: str = Field(..., description="User identifier")
    message: str = Field(..., description="Message content")

class StandardResponse(BaseModel):
    status: str = "success"
    data: Optional[Any] = None
    error: Optional[str] = None

class HistoryResponse(BaseModel):
    history: List[Dict[str, str]]

class ScanHistoryResponse(BaseModel):
    scan_pages: List[Dict[str, str]]

class HealthResponse(BaseModel):
    status: str
    version: str
    uptime: float

# === Logging ===
def log_entry(user: str, content: str) -> None:
    try:
        log_file = LOG_BASE / f"{user}.txt"
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with log_file.open("a", encoding="utf-8") as f:
            f.write(f"[{ts}] {content}\n")
    except Exception as e:
        print(f"[Logging error] {e}")

# === History Management ===
def load_history(user: str) -> List[Dict[str, str]]:
    path = CONV_DIR / f"{user}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []

def save_history(user: str, history: List[Dict[str, str]]) -> None:
    path = CONV_DIR / f"{user}.json"
    path.write_text(json.dumps(history, indent=2), encoding="utf-8")

def load_scan_history(user: str) -> List[Dict[str, str]]:
    path = SCAN_DIR / f"{user}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []

def save_scan_history(user: str, scans: List[Dict[str, str]]) -> None:
    path = SCAN_DIR / f"{user}.json"
    path.write_text(json.dumps(scans, indent=2), encoding="utf-8")

# === Start time for uptime calculation ===
START_TIME = datetime.now()

# === Chat Processor ===
async def process_chat(user: str, msg: str) -> str:
    history = load_history(user)
    turns, count = [], 0
    for m in reversed(history):
        turns.insert(0, m)
        if m["role"] == "user":
            count += 1
        if count >= MAX_MEMORY_TURNS:
            break

    full_history = turns + [{"role": "user", "content": msg}]
    log_entry(user, f"User: {msg}")

    try:
        resp = await asyncio.to_thread(lambda: ollama.chat(
            model=MODEL_NAME,
            messages=full_history
        ))
        reply = resp.get("message", {}).get("content", "").strip()
        reply = re.sub(r"</s>+", "", reply).strip()
        reply = "\n\n".join([line.strip() for line in reply.splitlines() if line.strip()])
    except Exception as e:
        log_entry(user, f"Model error: {str(e)}")
        reply = f"I'm having trouble processing your request right now. Please try again later."

    if len(reply) > 2000:
        reply = reply[:2000].rsplit(".", 1)[0] + "."

    history.extend([
        {"role": "user", "content": msg},
        {"role": "assistant", "content": reply}
    ])
    save_history(user, history)
    log_entry(user, f"Response: {reply}")

    return reply

# === Standard Response Helper ===
def standard_response(data=None, error=None, status="success"):
    response = {"status": status}
    if data is not None:
        response["data"] = data
    if error is not None:
        response["error"] = error
    return response

# === HTTP Routes ===
@app.get("/health", response_model=HealthResponse)
async def health_check():
    uptime = (datetime.now() - START_TIME).total_seconds()
    return {"status": "healthy", "version": VERSION, "uptime": uptime}

@app.post("/api/chatbot", response_model=StandardResponse)
async def chat_http(
    data: ChatRequest = Body(...), 
    api_key: str = Depends(get_api_key)
):
    user, msg = data.user.strip(), data.message.strip()
    if not user or not msg:
        return standard_response(error="Missing 'user' or 'message'", status="error")
    try:
        response = await process_chat(user, msg)
        return standard_response(data={"response": response})
    except Exception as e:
        err = f"Chatbot error: {e}"
        log_entry(user, err)
        return standard_response(error=err, status="error")

@app.post("/log", response_model=StandardResponse)
async def log_http(
    data: ChatRequest = Body(...),
    api_key: str = Depends(get_api_key)
):
    user, msg = data.user.strip(), data.message.strip()
    if not user or not msg:
        return standard_response(error="Missing 'user' or 'message'", status="error")
    log_entry(user, msg)
    return standard_response(data={"message": "Log entry created"})

@app.get("/scan/{user}", response_model=ScanHistoryResponse)
async def get_scan_history_endpoint(
    user: str,
    api_key: str = Depends(get_api_key)
):
    return {"scan_pages": load_scan_history(user)}

@app.get("/history/{user}", response_model=HistoryResponse)
async def get_history_endpoint(
    user: str,
    api_key: str = Depends(get_api_key)
):
    return {"history": load_history(user)}

@app.delete("/history/{user}", response_model=StandardResponse)
async def clear_history_endpoint(
    user: str,
    api_key: str = Depends(get_api_key)
):
    try:
        empty_history = []
        save_history(user, empty_history)
        return standard_response(data={"message": f"History cleared for user {user}"})
    except Exception as e:
        return standard_response(error=f"Failed to clear history: {str(e)}", status="error")

# === WebSocket Connection Manager ===
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
    
    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active_connections[client_id] = websocket
        log_entry(client_id, f"WebSocket connected")
    
    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]
            log_entry(client_id, f"WebSocket disconnected")
    
    async def send_message(self, client_id: str, message: dict):
        if client_id in self.active_connections:
            await self.active_connections[client_id].send_json(message)

# Initialize connection manager
manager = ConnectionManager()

# === WebSocket Routes ===
# Enhance the WebSocket chat endpoint
@app.websocket("/chatbot")
async def websocket_chat(ws: WebSocket):
    client_id = None
    try:
        await ws.accept()
        
        # Keep track of activity time for handling session timeouts
        last_activity = datetime.now()
        
        while True:
            # Wait for message with timeout handling
            try:
                raw = await asyncio.wait_for(ws.receive_text(), timeout=120)  # 2 minute timeout
                last_activity = datetime.now()
            except asyncio.TimeoutError:
                # Check if session is expired (no activity for 5 minutes)
                if (datetime.now() - last_activity).total_seconds() > 300:
                    await ws.close(code=1000, reason="Session timeout")
                    break
                continue
            
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_json({"error": "Invalid JSON format"})
                continue
            
            # Handle ping messages
            if data.get("type") == "ping":
                await ws.send_json({"type": "pong"})
                continue
                
            user = data.get("user", "").strip()
            msg = data.get("message", "").strip()
            
            if not user or not msg:
                await ws.send_json({"error": "Missing 'user' or 'message'"})
                continue
            
            client_id = user
            
            # Send typing indicator
            await ws.send_json({"typing": True})
            
            try:
                # Process the message asynchronously
                reply_task = asyncio.create_task(process_chat(user, msg))
                
                # Add a small delay to ensure typing indicator is shown
                await asyncio.sleep(0.5)
                
                # Wait for response
                reply = await reply_task
                
                # Send the response
                await ws.send_json({"response": reply})
            except Exception as e:
                err = f"Chatbot error: {str(e)}"
                log_entry(user, err)
                await ws.send_json({"error": err})
                
    except WebSocketDisconnect:
        if client_id:
            log_entry(client_id, "WebSocket chat disconnected")
    except Exception as e:
        if client_id:
            log_entry(client_id, f"WebSocket error: {str(e)}")
        try:
            await ws.close(code=1011, reason="Internal server error")
        except:
            pass

# Enhance process_chat to provide more conversational context
async def process_chat(user: str, msg: str) -> str:
    history = load_history(user)
    turns = []
    count = 0
    
    # Create a better context window for the model
    for m in reversed(history):
        turns.insert(0, m)
        if m["role"] == "user":
            count += 1
        if count >= MAX_MEMORY_TURNS:
            break
    
    # Create system message for consistency
    system_message = {
        "role": "system",
        "content": (
            "You are Mr. White, a security assistant specializing in detecting phishing, scams, "
            "and cybersecurity threats. You are knowledgeable, concise, and focused on security. "
            "You should respond to user questions by providing clear, actionable security advice. "
            "Keep answers brief but helpful. If you don't know something, admit it rather than speculating."
        )
    }
    
    full_history = [system_message] + turns + [{"role": "user", "content": msg}]
    log_entry(user, f"User: {msg}")

    try:
        # Add timeout to prevent hanging
        resp = await asyncio.wait_for(
            asyncio.to_thread(lambda: ollama.chat(
                model=MODEL_NAME,
                messages=full_history
            )),
            timeout=30  # 30 second timeout
        )
        
        reply = resp.get("message", {}).get("content", "").strip()
        reply = re.sub(r"</s>+", "", reply).strip()
        reply = "\n\n".join([line.strip() for line in reply.splitlines() if line.strip()])
    except asyncio.TimeoutError:
        log_entry(user, "Model timeout")
        reply = "I'm taking too long to respond right now. Please try a shorter message or try again later."
    except Exception as e:
        log_entry(user, f"Model error: {str(e)}")
        reply = f"I'm having trouble processing your request right now. Please try again later."

    # Limit response length
    if len(reply) > 2000:
        reply = reply[:2000].rsplit(".", 1)[0] + "."

    # Save to history
    history.extend([
        {"role": "user", "content": msg},
        {"role": "assistant", "content": reply}
    ])
    
    # Trim history if it's getting too large
    if len(history) > MAX_MEMORY_TURNS * 2:
        history = history[-(MAX_MEMORY_TURNS * 2):]
        
    save_history(user, history)
    log_entry(user, f"Response: {reply}")

    return reply

# Add a route to get chat settings
@app.get("/api/settings", response_model=StandardResponse)
async def get_settings(api_key: str = Depends(get_api_key)):
    return standard_response(data={
        "max_memory_turns": MAX_MEMORY_TURNS,
        "model_name": MODEL_NAME,
        "version": VERSION
    })

# Add route to clear specific message from history
@app.delete("/history/{user}/{index}", response_model=StandardResponse)
async def delete_message_endpoint(
    user: str,
    index: int,
    api_key: str = Depends(get_api_key)
):
    try:
        history = load_history(user)
        
        if index < 0 or index >= len(history):
            return standard_response(error=f"Invalid index {index}", status="error")
            
        # Remove the message and its response if it's a user message
        if index < len(history) and history[index]["role"] == "user":
            if index + 1 < len(history) and history[index + 1]["role"] == "assistant":
                del history[index:index+2]
            else:
                del history[index]
        else:
            del history[index]
            
        save_history(user, history)
        return standard_response(data={"message": f"Message {index} deleted for user {user}"})
    except Exception as e:
        return standard_response(error=f"Failed to delete message: {str(e)}", status="error")

# Add a new model class for URL scanning
class URLScanRequest(BaseModel):
    user: str = Field(..., description="User identifier")
    url: str = Field(..., description="URL to scan")

# Add a new HTTP endpoint for URL scanning - renamed from scan_url_endpoint to scan_endpoint
@app.post("/api/scan", response_model=StandardResponse)
async def scan_endpoint(
    data: URLScanRequest = Body(...),
    api_key: str = Depends(get_api_key)
):
    user, url = data.user.strip(), data.url.strip()
    
    if not user or not url:
        return standard_response(error="Missing 'user' or 'url'", status="error")
    
    try:
        # Validate URL
        parsed_url = urlparse(url)
        if not all([parsed_url.scheme, parsed_url.netloc]):
            return standard_response(error="Invalid URL format", status="error")
        
        # Fetch the page content
        try:
            response = requests.get(url, timeout=10, allow_redirects=True)
            page_content = response.text
            # Add status code information but continue processing
            if response.status_code >= 400:
                page_content = f"Warning: URL returned status code {response.status_code}\n\n{page_content}"
        except requests.RequestException as e:
            return standard_response(error=f"Failed to fetch URL: {str(e)}", status="error")
        
        # Format the scan message
        formatted_message = f"[SCAN_PAGE] URL: {url}\n\n{page_content}"
        
        # Process the scan
        try:
            resp = await asyncio.wait_for(
                asyncio.to_thread(lambda: ollama.chat(
                    model=MODEL_NAME,
                    messages=[
                        {
                            "role": "system",
                            "content": (
                                "You are a cybersecurity assistant. "
                                "You MUST reply in this format only:\n\n"
                                "link: <URL>\n\n"
                                "analyze: <short summary of potential phishing/malicious/suspicious activity>\n\n"
                                "Be concise. DO NOT provide excessive detail or long explanations."
                            )
                        },
                        {"role": "user", "content": formatted_message}
                    ]
                )),
                timeout=30  # 30 second timeout
            )
            
            reply = resp.get("message", {}).get("content", "").strip()
            reply = re.sub(r"</s>+", "", reply).strip()
            reply = "\n\n".join([line.strip() for line in reply.splitlines() if line.strip()])
            
            if len(reply) > 2000:
                reply = reply[:2000].rsplit(".", 1)[0] + "."
                
            log_entry(user, f"URLScan ({url}): {reply}")
            
            # Add to scan history
            scans = load_scan_history(user)
            scans.append({"page": formatted_message, "result": reply})
            if len(scans) > MAX_SCAN_HISTORY:
                scans = scans[-MAX_SCAN_HISTORY:]
            save_scan_history(user, scans)
            
            return standard_response(data={"response": reply, "url": url})
            
        except asyncio.TimeoutError:
            log_entry(user, f"URLScan timeout: {url}")
            return standard_response(error="Scan analysis took too long to complete", status="error")
        except Exception as e:
            log_entry(user, f"URLScan error: {str(e)}")
            return standard_response(error=f"Failed to analyze URL: {str(e)}", status="error")
            
    except Exception as e:
        log_entry(user, f"URLScan unexpected error: {str(e)}")
        return standard_response(error=f"An unexpected error occurred: {str(e)}", status="error")

# Fix for handling WebSocket disconnects during processing
@app.websocket("/scan")
async def websocket_scan_url(ws: WebSocket):
    await ws.accept()
    client_id = "guest"  # Default client_id
    
    try:
        print(f"WebSocket connection attempt for URL scan")
        
        while True:
            try:
                # Create a shorter timeout to detect disconnections more quickly
                raw = await asyncio.wait_for(ws.receive_text(), timeout=15)
                print(f"Received WebSocket data: {raw}")
            except asyncio.TimeoutError:
                print("WebSocket receive timeout")
                try:
                    await ws.send_json({"error": "Connection timeout"})
                except Exception:
                    print("Connection closed during timeout")
                break
            except WebSocketDisconnect:
                print(f"WebSocket disconnected during receive")
                break
            
            # Parse incoming JSON with robust error handling
            try:
                data = json.loads(raw)
                print(f"Parsed data: {data}")
            except json.JSONDecodeError:
                try:
                    await ws.send_json({"error": "Invalid JSON format"})
                except Exception:
                    print("Connection closed during JSON parsing")
                continue
                
            # Handle ping messages specifically
            if data.get("type") == "ping":
                print("Received ping, sending pong")
                try:
                    await ws.send_json({"type": "pong"})
                except Exception:
                    print("Connection closed during ping response")
                continue
                
            # Extract user field with fallback
            user = data.get("user", "")
            if user and isinstance(user, str):
                user = user.strip()
                
            if not user:
                user = "guest"
                
            client_id = user  # Set client_id early
            print(f"Using user: {user}")
            
            # Extract URL with fallbacks from either url or message field
            url = ""
            if "url" in data and data["url"]:
                if isinstance(data["url"], str):
                    url = data["url"].strip()
                    print(f"URL from url field: {url}")
                    
            if not url and "message" in data and data["message"]:
                message = data["message"]
                if isinstance(message, str):
                    message = message.strip()
                    # Use message as URL if it looks like a URL
                    if message.startswith("http") or "." in message:
                        url = message
                        print(f"Using message as URL: {url}")
            
            # Validate URL
            if not url:
                error_msg = "Missing URL to scan"
                print(f"Error: {error_msg}")
                try:
                    await ws.send_json({"error": error_msg})
                except Exception:
                    print("Connection closed during error response")
                continue
                
            # Add http:// prefix if missing
            if not url.startswith("http"):
                url = "http://" + url
                print(f"Added http:// prefix, URL is now: {url}")
            
            # Critical section - separate the scanning from the WebSocket communication
            # to prevent WebSocket timeouts during long operations
            try:
                # Send initial processing message
                try:
                    await ws.send_json({"processing": True})
                except Exception as e:
                    print(f"Connection closed during processing message: {e}")
                    break
                
                # Check connection status before proceeding
                try:
                    # Send a quick status to test if connection is still alive
                    await ws.send_json({"status": "Starting scan..."})
                except Exception as e:
                    print(f"Connection not available for scan: {e}")
                    break
                
                # Fetch URL content - shortened timeout to prevent long hanging operations
                try:
                    await ws.send_json({"status": "Fetching URL content..."})
                    
                    # Use a shorter timeout for fetching
                    response = await asyncio.wait_for(
                        asyncio.to_thread(
                            lambda: requests.get(url, timeout=5, allow_redirects=True)
                        ),
                        timeout=10  # Overall timeout including asyncio overhead
                    )
                    page_content = response.text
                    
                    # Add status code information
                    if response.status_code >= 400:
                        page_content = f"Warning: URL returned status code {response.status_code}\n\n{page_content}"
                        
                    # Check connection is still alive
                    try:
                        await ws.send_json({"status": "Content retrieved successfully"})
                    except Exception as e:
                        print(f"Connection lost after content retrieval: {e}")
                        # Save scan history even if we can't return it to client
                        formatted_message = f"[SCAN_PAGE] URL: {url}\n\n{page_content[:500]}..."
                        # We'll continue to analysis but may not be able to return results
                except Exception as e:
                    error_msg = f"Failed to fetch URL: {str(e)}"
                    print(f"Fetch error: {error_msg}")
                    try:
                        await ws.send_json({"error": error_msg})
                    except Exception:
                        print("Connection closed during fetch error response")
                    continue
                
                # Analyze the content
                try:
                    await ws.send_json({"status": "Analyzing content..."})
                    
                    # Format the scan message
                    formatted_message = f"[SCAN_PAGE] URL: {url}\n\n{page_content}"
                    
                    # Process with a shorter timeout
                    resp = await asyncio.wait_for(
                        asyncio.to_thread(lambda: ollama.chat(
                            model=MODEL_NAME,
                            messages=[
                                {
                                    "role": "system", 
                                    "content": (
                                        "You are a cybersecurity assistant. "
                                        "You MUST reply in this format only:\n\n"
                                        "link: <URL>\n\n"
                                        "analyze: <short summary of potential phishing/malicious/suspicious activity>\n\n"
                                        "Be concise. DO NOT provide excessive detail or long explanations."
                                    )
                                },
                                {"role": "user", "content": formatted_message}
                            ]
                        )),
                        timeout=20  # Reduced timeout
                    )
                    
                    reply = resp.get("message", {}).get("content", "").strip()
                    reply = re.sub(r"</s>+", "", reply).strip()
                    reply = "\n\n".join([line.strip() for line in reply.splitlines() if line.strip()])
                    
                    if len(reply) > 2000:
                        reply = reply[:2000].rsplit(".", 1)[0] + "."
                        
                except asyncio.TimeoutError:
                    try:
                        await ws.send_json({"error": "Scan analysis timed out"})
                    except Exception:
                        print("Connection closed during timeout error response")
                    continue
                except Exception as e:
                    error_msg = f"URLScan error: {str(e)}"
                    print(f"Scan error: {error_msg}")
                    try:
                        await ws.send_json({"error": error_msg})
                    except Exception:
                        print("Connection closed during scan error response")
                    continue
                
                # Save scan history even if we can't send response
                try:
                    scans = load_scan_history(user)
                    # Truncate page content to save space
                    shortened_content = formatted_message[:500] + "..." if len(formatted_message) > 500 else formatted_message
                    scans.append({"page": shortened_content, "result": reply})
                    if len(scans) > MAX_SCAN_HISTORY:
                        scans = scans[-MAX_SCAN_HISTORY:]
                    save_scan_history(user, scans)
                    
                    # Log the scan for debugging
                    log_entry(user, f"URLScan ({url}): {reply}")
                except Exception as e:
                    print(f"Error saving scan history: {e}")
                    # Continue since this isn't critical for the user
                
                # Send the final response
                print(f"Sending scan result for URL: {url}")
                try:
                    # Final check that connection is still alive
                    if ws.client_state == WebSocketState.CONNECTED:
                        await ws.send_json({"response": reply, "url": url})
                        print("Scan result sent successfully")
                    else:
                        print("Cannot send result: WebSocket no longer connected")
                except Exception as e:
                    print(f"Error sending response: {e}")
                    # Cannot send response to client, but scan is saved in history
                    
            except Exception as e:
                print(f"Unexpected error during scan process: {str(e)}")
                try:
                    await ws.send_json({"error": f"Unexpected error: {str(e)}"})
                except Exception:
                    print("Could not send error - connection likely closed")
                
    except WebSocketDisconnect:
        print(f"WebSocket disconnected for user: {client_id}")
    except Exception as e:
        print(f"WebSocket unexpected error: {str(e)}")
        
    print(f"WebSocket scan handler completed for user: {client_id}")

# === Run Server ===
if __name__ == "__main__":
    import uvicorn
    print(f"API Key for development: {API_KEY}")
    uvicorn.run(app, host="0.0.0.0", port=8000)