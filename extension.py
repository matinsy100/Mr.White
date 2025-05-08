from fastapi import FastAPI, HTTPException, Body, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from datetime import datetime
from pathlib import Path
import json
import asyncio
import ollama
from typing import List, Dict, Optional, Any
import re
from contextlib import asynccontextmanager
import requests
from urllib.parse import urlparse
from starlette.websockets import WebSocketState

# === Constants ===
VERSION = "1.0.0"
MAX_SCAN_HISTORY = 1  # Keep at 1 to avoid token glitches
MAX_MEMORY_TURNS = 5  # Reduced from 10 for faster responses
MODEL_NAME = "llama2:7b-chat-q4_0"  # Faster model for better performance
SCAN_TIMEOUT = 50 # Consistent timeout for scans
CHAT_TIMEOUT = 30  # Timeout for chat responses
CONTENT_LIMIT = 6000  # Maximum characters to analyze

# === App Setup with lifespan for startup/shutdown ===
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print(f"Starting Mr. White API v{VERSION}")
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

# === Standard Response Helper ===
def standard_response(data=None, error=None, status="success"):
    response = {"status": status}
    if data is not None:
        response["data"] = data
    if error is not None:
        response["error"] = error
    return response

# === Improved WebSocket Helper Functions ===
async def safe_send(ws: WebSocket, message: dict) -> bool:
    """Safely send a message if the connection is still open"""
    if ws.client_state == WebSocketState.CONNECTED:
        try:
            await ws.send_json(message)
            return True
        except Exception as e:
            print(f"WebSocket send error: {e}")
            return False
    else:
        print(f"Cannot send message - WebSocket not connected (state: {ws.client_state})")
        return False

# Modify the perform_scan function to provide cleaner results
async def perform_scan(url: str, user: str) -> Dict[str, str]:
    """Perform URL scan with improved formatting and error handling"""
    try:
        # First check if it's a shortened URL by capturing redirect history
        redirect_info = ""
        try:
            # Make a HEAD request first to check redirects without downloading content
            head_response = await asyncio.wait_for(
                asyncio.to_thread(
                    lambda: requests.head(url, timeout=5, allow_redirects=True)
                ),
                timeout=8
            )
            
            # Check if there were redirects
            if head_response.history:
                redirect_chain = " -> ".join([r.url for r in head_response.history] + [head_response.url])
                redirect_info = f"Yes - {redirect_chain}"
                print(f"Detected URL redirection: {redirect_info}")
                
                # Use the final URL for the actual content request
                final_url = head_response.url
            else:
                redirect_info = "No"
                final_url = url
        except asyncio.TimeoutError:
            print(f"Redirect check timed out for {url}, continuing with original URL")
            redirect_info = "Unknown - check timed out"
            final_url = url
        except asyncio.CancelledError:
            print(f"Redirect check was cancelled for {url}")
            raise  # Re-raise to handle at higher level
        except Exception as e:
            print(f"Error checking redirects: {e}")
            redirect_info = "Error checking redirects"
            final_url = url  # If redirect check fails, use original URL
            
        # Fetch the actual content after redirect check
        try:
            response = await asyncio.wait_for(
                asyncio.to_thread(
                    lambda: requests.get(final_url, timeout=5, allow_redirects=True)
                ),
                timeout=8
            )
            
            # Process page content
            page_content = response.text
            if len(page_content) > CONTENT_LIMIT:
                page_content = page_content[:CONTENT_LIMIT] + "... [content truncated for analysis]"
            
            if response.status_code >= 400:
                page_content = f"Warning: URL returned status code {response.status_code}\n\n{page_content}"
        except asyncio.CancelledError:
            print(f"Content fetch was cancelled for {url}")
            raise  # Re-raise to handle at higher level
        except Exception as e:
            print(f"Error fetching content: {e}")
            return {"error": f"Failed to fetch URL content: {str(e)}"}
            
        # Format the scan message with redirect information if present
        formatted_message = f"[SCAN_PAGE] URL: {url}\n\nRedirect info: {redirect_info}\n\nStatus Code: {response.status_code}\n\n{page_content}"
        
        # Process with model - wrap in try/except to handle cancellation
        try:
            resp = await asyncio.wait_for(
                asyncio.to_thread(lambda: ollama.chat(
                    model=MODEL_NAME,
                    messages=[
                        {
                            "role": "system",
                            "content": (
                                "You are Mr. White, a cybersecurity specialist analyzing webpages for threats. "
                                "Reply with ONLY this format:\n\n"
                                "Status: <one-line threat assessment>\n"
                                "Threat Level: <Safe|Low|Medium|High|Critical>\n"
                                "Link: <URL>\n"
                                "Redirects: <Yes/No> <describe redirect chain if present>\n\n"
                                "1. Main purpose: <brief description of site purpose and function>\n"
                                "2. Content summary: <describe key content, topics, products or services on the page>\n"
                                "3. Security concerns: <list any suspicious elements, forms, scripts, or content>\n"
                                "4. Recommendation: <clear advice on whether to proceed or take caution>\n\n"
                                "Be extremely concise but thorough in describing the actual website content. "
                                "Focus on detecting phishing, malware, suspicious forms, unusual scripts, or misleading information. "
                                "Mention specific content elements like login forms, payment options, product offerings, or specific topics discussed. "
                                "If the URL was shortened or redirected, analyze whether the redirect is suspicious or potentially misleading."
                            )
                        },
                        {"role": "user", "content": formatted_message}
                    ],
                    options={
                        "temperature": 0.1,
                        "num_predict": 512
                    }
                )),
                timeout=SCAN_TIMEOUT
            )
            
            reply = resp.get("message", {}).get("content", "").strip()
            reply = re.sub(r"</s>+", "", reply).strip()
            
            # Clean up formatting for consistent display
            reply_lines = [line.strip() for line in reply.splitlines() if line.strip()]
            reply = "\n".join(reply_lines)
            
            # Ensure the reply follows the expected format
            if not any(line.startswith("Threat Level:") for line in reply_lines):
                # Add default threat level if missing
                reply = "Threat Level: Unknown\n" + reply
                
            # Limit reply length
            if len(reply) > 1500:
                reply = reply[:1500].rsplit(".", 1)[0] + "."
                
            # Save to scan history
            scans = [{"page": url, "result": reply}]
            save_scan_history(user, scans)
            
            # Log the scan
            log_entry(user, f"URLScan ({url}): {reply[:200]}...")
            
            return {"response": reply, "url": url}
            
        except asyncio.CancelledError:
            print(f"Analysis was cancelled for {url}")
            # Create a simple report about the redirect when cancelled
            if redirect_info:
                basic_reply = (
                    f"Status: Analysis cancelled but redirect detected\n"
                    f"Threat Level: Unknown\n"
                    f"Link: {url}\n"
                    f"Redirects: {redirect_info}\n\n"
                    f"1. Main purpose: Analysis was interrupted, but redirect information was captured\n"
                    f"2. Content summary: Unable to complete full analysis\n"
                    f"3. Security concerns: Unknown - scan was interrupted\n"
                    f"4. Recommendation: Exercise caution when clicking links"
                )
                # Save minimal results to history
                scans = [{"page": url, "result": basic_reply}]
                save_scan_history(user, scans)
                return {"response": basic_reply, "url": url}
            raise  # Re-raise if no redirect info
            
    except asyncio.CancelledError:
        print(f"Scan task was cancelled for {url}")
        return {"error": "Scan was cancelled. Try again with a direct URL instead of a shortened one."}
    except Exception as e:
        log_entry(user, f"URLScan error: {str(e)}")
        return {"error": f"Failed to scan URL: {str(e)}"}

# === HTTP Routes ===
@app.get("/health", response_model=HealthResponse)
async def health_check():
    uptime = (datetime.now() - START_TIME).total_seconds()
    return {"status": "healthy", "version": VERSION, "uptime": uptime}

@app.post("/api/chatbot", response_model=StandardResponse)
async def chat_http(data: ChatRequest = Body(...)):
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
async def log_http(data: ChatRequest = Body(...)):
    user, msg = data.user.strip(), data.message.strip()
    if not user or not msg:
        return standard_response(error="Missing 'user' or 'message'", status="error")
    log_entry(user, msg)
    return standard_response(data={"message": "Log entry created"})

@app.get("/scan/{user}", response_model=ScanHistoryResponse)
async def get_scan_history_endpoint(user: str):
    return {"scan_pages": load_scan_history(user)}

@app.get("/history/{user}", response_model=HistoryResponse)
async def get_history_endpoint(user: str):
    return {"history": load_history(user)}

@app.delete("/history/{user}", response_model=StandardResponse)
async def clear_history_endpoint(user: str):
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
            try:
                await self.active_connections[client_id].send_json(message)
                return True
            except Exception as e:
                print(f"Error sending message to {client_id}: {e}")
                self.disconnect(client_id)
                return False
        return False

# Initialize connection manager
manager = ConnectionManager()

# === WebSocket Routes ===
@app.websocket("/chatbot")
async def websocket_chat(ws: WebSocket):
    client_id = None
    try:
        await ws.accept()
        print("WebSocket chat connection accepted")
        
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
                    try:
                        await ws.close(code=1000, reason="Session timeout")
                    except Exception:
                        pass
                    break
                continue
            except WebSocketDisconnect:
                print("WebSocket disconnected during receive")
                break
            
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                if not await safe_send(ws, {"error": "Invalid JSON format"}):
                    break
                continue
            
            # Handle ping messages
            if data.get("type") == "ping":
                if not await safe_send(ws, {"type": "pong"}):
                    break
                continue
                
            user = data.get("user", "").strip()
            msg = data.get("message", "").strip()
            
            if not user or not msg:
                if not await safe_send(ws, {"error": "Missing 'user' or 'message'"}):
                    break
                continue
            
            client_id = user
            
            # Send typing indicator
            if not await safe_send(ws, {"typing": True}):
                break
            
            try:
                # Process the message asynchronously
                reply_task = asyncio.create_task(process_chat(user, msg))
                
                # Add a small delay to ensure typing indicator is shown
                await asyncio.sleep(0.5)
                
                # Wait for response with timeout
                try:
                    reply = await asyncio.wait_for(reply_task, timeout=CHAT_TIMEOUT + 5)
                except asyncio.TimeoutError:
                    if not await safe_send(ws, {"error": f"Request timed out after {CHAT_TIMEOUT} seconds"}):
                        break
                    continue
                
                # Send the response if connection is still open
                if not await safe_send(ws, {"response": reply}):
                    break
                
            except Exception as e:
                err = f"Chatbot error: {str(e)}"
                log_entry(user, err)
                if not await safe_send(ws, {"error": err}):
                    break
                
    except WebSocketDisconnect:
        if client_id:
            log_entry(client_id, "WebSocket chat disconnected")
    except Exception as e:
        if client_id:
            log_entry(client_id, f"WebSocket error: {str(e)}")
        try:
            await ws.close(code=1011, reason="Internal server error")
        except Exception:
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
    
    # Check if there's a recent scan to include in context
    scan_history = load_scan_history(user)
    scan_context = ""
    if scan_history and len(scan_history) > 0:
        # Get the most recent scan
        latest_scan = scan_history[-1]
        if "result" in latest_scan and latest_scan["result"]:
            scan_context = (
                "\n\nRecent scan results:\n" + 
                latest_scan["result"] + 
                "\n\nRefer to this information if the user asks about recent scans."
            )
    
    # If we have scan context, append it to the system message
    if scan_context:
        system_message["content"] += scan_context
    
    full_history = [system_message] + turns + [{"role": "user", "content": msg}]
    log_entry(user, f"User: {msg}")

    try:
        # Check if Ollama is accessible
        try:
            import requests
            ollama_status = requests.get("http://localhost:11434/api/version", timeout=5)
            if ollama_status.status_code != 200:
                return f"Error: Unable to connect to Ollama service (Status code: {ollama_status.status_code}). Please make sure Ollama is running."
        except Exception as conn_err:
            return f"Error: Ollama connection issue - {str(conn_err)}. Please make sure Ollama is running."
            
        # Check if the model exists
        try:
            model_check = requests.get(f"http://localhost:11434/api/tags", timeout=5)
            models = model_check.json().get("models", [])
            model_names = [m.get("name") for m in models]
            if MODEL_NAME not in model_names:
                return f"Error: The model '{MODEL_NAME}' is not available in Ollama. Available models: {', '.join(model_names)}. Please pull the model using 'ollama pull {MODEL_NAME}'."
        except Exception as model_err:
            log_entry(user, f"Model check error: {str(model_err)}")
            # Continue with the request even if model check fails
        
        # Add timeout to prevent hanging
        resp = await asyncio.wait_for(
            asyncio.to_thread(lambda: ollama.chat(
                model=MODEL_NAME,
                messages=full_history,
                options={
                    "temperature": 0.7,  # More creative for chat
                    "num_predict": 1024  # Longer limit for chat
                }
            )),
            timeout=CHAT_TIMEOUT
        )
        
        reply = resp.get("message", {}).get("content", "").strip()
        reply = re.sub(r"</s>+", "", reply).strip()
        reply = "\n\n".join([line.strip() for line in reply.splitlines() if line.strip()])
    except asyncio.TimeoutError:
        error_msg = f"Request timed out after {CHAT_TIMEOUT} seconds"
        log_entry(user, error_msg)
        return f"Error: {error_msg}. Please try a shorter message or try again later."
    except Exception as e:
        error_msg = f"Error processing request: {str(e)}"
        log_entry(user, error_msg)
        return f"Error: {error_msg}. Please check server logs for details."

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
async def get_settings():
    return standard_response(data={
        "max_memory_turns": MAX_MEMORY_TURNS,
        "model_name": MODEL_NAME,
        "version": VERSION
    })

# Add route to clear specific message from history
@app.delete("/history/{user}/{index}", response_model=StandardResponse)
async def delete_message_endpoint(user: str, index: int):
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

# Add a new HTTP endpoint for URL scanning
@app.post("/api/scan", response_model=StandardResponse)
async def scan_endpoint(data: URLScanRequest = Body(...)):
    user, url = data.user.strip(), data.url.strip()
    
    if not user or not url:
        return standard_response(error="Missing 'user' or 'url'", status="error")
    
    try:
        # Validate URL
        parsed_url = urlparse(url)
        if not all([parsed_url.scheme, parsed_url.netloc]):
            return standard_response(error="Invalid URL format", status="error")
        
        # Use the separate scan function
        result = await perform_scan(url, user)
        
        # Check if there was an error
        if "error" in result:
            return standard_response(error=result["error"], status="error")
            
        return standard_response(data=result)
            
    except Exception as e:
        log_entry(user, f"URLScan unexpected error: {str(e)}")
        return standard_response(error=f"An unexpected error occurred: {str(e)}", status="error")

# COMPLETELY REWRITTEN WebSocket scan handler with proper connection management
@app.websocket("/scan")
async def websocket_scan_url(ws: WebSocket):
    client_id = "guest"  # Default client_id
    connection_accepted = False
    scan_task = None
    
    try:
        # Accept the connection ONCE
        await ws.accept()
        connection_accepted = True
        print("WebSocket scan connection accepted")
        
        while True:
            # Receive message with proper error handling
            try:
                raw = await asyncio.wait_for(ws.receive_text(), timeout=15)
                print(f"Received WebSocket data: {raw[:50]}...")  # Print first 50 chars
            except asyncio.TimeoutError:
                print("WebSocket receive timeout")
                break
            except WebSocketDisconnect:
                print("WebSocket disconnected during receive")
                break
            
            # Parse data with error handling
            try:
                data = json.loads(raw)
                print(f"Parsed data: {str(data)[:50]}...")  # Print first 50 chars
            except json.JSONDecodeError:
                if not await safe_send(ws, {"error": "Invalid JSON format"}):
                    break
                continue
                
            # Handle ping messages
            if data.get("type") == "ping":
                print("Received ping, sending pong")
                if not await safe_send(ws, {"type": "pong"}):
                    break
                continue
                
            # Extract user and URL
            user = data.get("user", "").strip()
            if not user:
                user = "guest"
                
            client_id = user
            
            # Get URL (try both url and message fields)
            url = ""
            if "url" in data and isinstance(data["url"], str):
                url = data["url"].strip()
            elif "message" in data and isinstance(data["message"], str):
                message = data["message"].strip()
                if message.startswith("http") or "." in message:
                    url = message
            
            # Validate URL
            if not url:
                if not await safe_send(ws, {"error": "Missing URL to scan"}):
                    break
                continue
                
            # Add http:// prefix if missing
            if not url.startswith("http"):
                url = "http://" + url
                
            # Send initial processing message
            if not await safe_send(ws, {"processing": True, "status": "Starting scan..."}):
                break
                
            # Perform scan in a separate task to avoid blocking WebSocket
            try:
                # Define the steps with exact progress information
                steps = [
                    {"step": 1, "message": "Processing content..."},
                    {"step": 2, "message": "Analyzing security aspects..."},
                ]
                
                # Send the first step immediately
                if not await safe_send(ws, {"status": steps[0]["message"]}):
                    break
                
                # Start the scan
                scan_task = asyncio.create_task(perform_scan(url, user))
                
                # Send remaining status updates while waiting
                for i in range(1, len(steps)):
                    # Wait before sending next update
                    await asyncio.sleep(2)
                    
                    # Check if scan already completed
                    if scan_task.done():
                        break
                        
                    # Send next status update
                    if not await safe_send(ws, {"status": steps[i]["message"]}):
                        scan_task.cancel()
                        break
                
                # Wait for scan results with timeout
                try:
                    scan_result = await asyncio.wait_for(scan_task, timeout=SCAN_TIMEOUT - 5)
                    
                    # Give a short delay before sending final result for better UX
                    await asyncio.sleep(1)
                    
                    # Check if an error occurred during scanning
                    if "error" in scan_result:
                        if not await safe_send(ws, {"error": scan_result["error"]}):
                            break
                        continue
                    
                    # Send successful result
                    if not await safe_send(ws, scan_result):
                        break
                        
                except asyncio.TimeoutError:
                    scan_task.cancel()
                    if not await safe_send(ws, {"error": "Scan timed out. The URL may be too complex or unresponsive."}):
                        break
                    continue
                    
            except Exception as e:
                error_msg = f"Scan error: {str(e)}"
                print(error_msg)
                if not await safe_send(ws, {"error": error_msg}):
                    break
                continue
                
    except WebSocketDisconnect:
        print(f"WebSocket disconnected for user: {client_id}")
    except Exception as e:
        print(f"WebSocket unexpected error: {str(e)}")
        
    finally:
        # Cancel any ongoing scan if connection is lost
        if scan_task and not scan_task.done():
            scan_task.cancel()
            print("Cancelled ongoing scan due to lost connection")
            
        # Cleanup connection if needed
        if connection_accepted and ws.client_state == WebSocketState.CONNECTED:
            try:
                await ws.close()
            except Exception:
                pass
        print(f"WebSocket scan handler completed for user: {client_id}")

# === Run Server ===
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)