const express = require("express");
const fs = require("fs");
const path = require("path");
const pino = require("pino");
const multer = require("multer");
const {
    makeInMemoryStore,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    fetchLatestBaileysVersion,
    makeWASocket,
    isJidBroadcast
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = process.env.PORT || 5000;

// Create necessary directories
if (!fs.existsSync("temp")) {
    fs.mkdirSync("temp");
}
if (!fs.existsSync("uploads")) {
    fs.mkdirSync("uploads");
}
if (!fs.existsSync("logs")) {
    fs.mkdirSync("logs");
}
if (!fs.existsSync("data")) {
    fs.mkdirSync("data");
}

const upload = multer({ dest: "uploads/" });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Store active client instances and tasks
const activeClients = new Map();
const activeTasks = new Map();
const taskLogs = new Map();
const userSessions = new Map();

// System Statistics
const systemStats = {
    totalMessagesSent: 0,
    totalSessions: 0,
    totalTasks: 0,
    uptime: Date.now(),
    errors: 0,
    successfulTasks: 0,
    failedTasks: 0
};

// Load stats from file if exists
try {
    if (fs.existsSync("data/stats.json")) {
        const savedStats = JSON.parse(fs.readFileSync("data/stats.json", "utf8"));
        Object.assign(systemStats, savedStats);
    }
} catch (e) {
    console.log("No previous stats found, starting fresh");
}

// Generate short unique session ID
function generateShortSessionId() {
    return Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
}

// Generate short task ID
function generateShortTaskId() {
    return 't' + Math.random().toString(36).substring(2, 8);
}

// Save stats to file
function saveStats() {
    try {
        fs.writeFileSync("data/stats.json", JSON.stringify(systemStats, null, 2));
    } catch (e) {
        console.error("Error saving stats:", e);
    }
}

// Middleware to track user sessions
app.use((req, res, next) => {
    const userIP = req.ip || req.connection.remoteAddress;
    req.userIP = userIP;
    next();
});

// System Monitoring
setInterval(() => {
    systemStats.totalSessions = activeClients.size;
    systemStats.totalTasks = Array.from(activeClients.values()).reduce((acc, client) => 
        acc + (client.tasks ? client.tasks.length : 0), 0
    );
    saveStats();
}, 300000);

// Enhanced cleanup function
setInterval(() => {
    const now = Date.now();
    for (let [sessionId, clientInfo] of activeClients.entries()) {
        if (clientInfo.lastActivity && (now - clientInfo.lastActivity > 24 * 60 * 60 * 1000)) {
            if (clientInfo.client) {
                clientInfo.client.end();
            }
            activeClients.delete(sessionId);
            
            for (let [ip, sessId] of userSessions.entries()) {
                if (sessId === sessionId) {
                    userSessions.delete(ip);
                    break;
                }
            }
            console.log(`Cleaned up inactive session: ${sessionId}`);
        }
    }
    
    for (let [taskId, logs] of taskLogs.entries()) {
        if (logs.length > 200) {
            logs.splice(200);
        }
    }
}, 60 * 60 * 1000);

// System API Routes
app.get("/api/stats", (req, res) => {
    const uptime = Date.now() - systemStats.uptime;
    const hours = Math.floor(uptime / (1000 * 60 * 60));
    const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
    
    res.json({
        ...systemStats,
        uptime: `${hours}h ${minutes}m`,
        activeSessions: activeClients.size,
        activeTasks: Array.from(activeClients.values()).reduce((acc, client) => 
            acc + (client.tasks ? client.tasks.length : 0), 0
        ),
        timestamp: new Date().toISOString()
    });
});

app.get("/api/sessions", (req, res) => {
    const sessions = Array.from(activeClients.entries()).map(([sessionId, clientInfo]) => ({
        sessionId,
        number: clientInfo.number,
        isConnected: clientInfo.isConnected,
        lastActivity: clientInfo.lastActivity,
        taskCount: clientInfo.tasks ? clientInfo.tasks.length : 0
    }));
    res.json(sessions);
});

// Main Home Route with All Systems
app.get("/", (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>𝘿𝙃𝙃𝙃𝙏 𝙏𝙈𝙆𝘾</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css">
        <style>
            :root {
                --primary: #25D366;
                --primary-dark: #128C7E;
                --primary-darker: #075E54;
                --accent: #667EEA;
                --accent-dark: #764BA2;
                --dark: #0F172A;
                --darker: #020617;
                --light: #F1F5F9;
                --success: #10B981;
                --warning: #F59E0B;
                --danger: #EF4444;
                --info: #3B82F6;
            }

            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }

            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background-image: url('https://i.postimg.cc/L51fQrQH/681be2a77443fb2f2f74fd42da1bc40f.jpg');
                background-size: cover;
                background-position: center;
                background-repeat: no-repeat;
                background-attachment: fixed;
                color: white;
                min-height: 100vh;
                padding: 20px;
            }

            .container {
                max-width: 1400px;
                margin: 0 auto;
                background: rgba(255,255,255,0.08);
                backdrop-filter: blur(8px);
                border-radius: 12px;
                padding: 25px;
                box-shadow: 0 2px 12px rgba(0,0,0,0.15);
                border: 1px solid rgba(255,255,255,0.12);
            }

            .header {
                text-align: center;
                margin-bottom: 30px;
                padding: 25px;
                background: rgba(255,255,255,0.08);
                backdrop-filter: blur(8px);
                border-radius: 20px;
                border: 1px solid rgba(255,255,255,0.12);
            }

            .logo {
                font-size: 2.8rem;
                font-weight: bold;
                background: linear-gradient(45deg, #ff6b6b, #4ecdc4);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                margin-bottom: 10px;
            }

            .tagline {
                color: white;
                opacity: 0.8;
                margin-bottom: 20px;
            }

            .system-stats {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 15px;
                margin: 20px 0;
            }

            .stat-card {
                background: rgba(255,255,255,0.06);
                padding: 15px;
                border-radius: 12px;
                text-align: center;
                border: 1px solid rgba(255,255,255,0.1);
                backdrop-filter: blur(8px);
            }

            .stat-number {
                font-size: 1.8rem;
                font-weight: bold;
                background: linear-gradient(45deg, #ff6b6b, #4ecdc4);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                margin-bottom: 5px;
            }

            .stat-label {
                font-size: 0.9rem;
                opacity: 0.8;
                color: white;
            }

            .grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
                gap: 20px;
                margin-bottom: 30px;
            }

            .card {
                background: rgba(255,255,255,0.08);
                backdrop-filter: blur(8px);
                padding: 25px;
                border-radius: 15px;
                border: 1px solid rgba(255,255,255,0.12);
                transition: transform 0.3s ease;
            }

            .card:hover {
                transform: translateY(-5px);
                background: rgba(255,255,255,0.12);
            }

            .card-header {
                display: flex;
                align-items: center;
                gap: 15px;
                margin-bottom: 20px;
            }

            .card-icon {
                width: 50px;
                height: 50px;
                background: linear-gradient(45deg, #ff6b6b, #4ecdc4);
                border-radius: 10px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 1.5rem;
                color: white;
            }

            .card-title {
                font-size: 1.3rem;
                font-weight: 600;
                color: white;
            }

            .form-group {
                margin-bottom: 15px;
            }

            .form-label {
                display: block;
                margin-bottom: 8px;
                font-weight: 500;
                color: white;
            }

            .form-input, .form-select {
                width: 100%;
                padding: 12px 15px;
                background: rgba(255,255,255,0.15);
                border: 1px solid rgba(255,255,255,0.25);
                border-radius: 8px;
                color: white;
                font-size: 14px;
            }

            .form-input:focus, .form-select:focus {
                outline: none;
                background: rgba(255,255,255,0.2);
                border-color: #4ecdc4;
                box-shadow: none;
            }

            .form-input::placeholder {
                color: rgba(255,255,255,0.6);
            }

            .btn {
                width: 100%;
                padding: 12px;
                background: linear-gradient(45deg, #ff6b6b, #4ecdc4);
                color: white;
                border: none;
                border-radius: 8px;
                font-size: 16px;
                font-weight: 600;
                cursor: pointer;
                transition: opacity 0.3s ease;
                margin-top: 10px;
            }

            .btn:hover {
                opacity: 0.9;
            }

            .btn-secondary {
                background: linear-gradient(45deg, #3742fa, #2f3542);
            }

            .btn-danger {
                background: linear-gradient(45deg, #ff4757, #ff3838);
            }

            .btn-warning {
                background: linear-gradient(45deg, #ffa502, #ff6348);
                color: white;
            }

            #pairingResult, #sessionTasksResult {
                margin-top: 15px;
                padding: 15px;
                background: rgba(255,255,255,0.1);
                backdrop-filter: blur(8px);
                border-radius: 8px;
                border: 1px solid rgba(255,255,255,0.12);
            }

            .system-controls {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
                margin-top: 15px;
            }

            .system-panel {
                background: rgba(255,255,255,0.06);
                backdrop-filter: blur(8px);
                padding: 20px;
                border-radius: 15px;
                margin-bottom: 20px;
                border: 1px solid rgba(255,255,255,0.1);
            }

            .panel-title {
                font-size: 1.4rem;
                color: #4ecdc4;
                text-shadow: 0 0 10px rgba(78,205,196,0.5);
                margin-bottom: 15px;
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .live-data {
                background: rgba(0,0,0,0.25);
                padding: 15px;
                border-radius: 10px;
                margin-top: 10px;
                font-family: 'Courier New', 'Consolas', 'Monaco', monospace;
                font-size: 12px;
                max-height: 200px;
                overflow-y: auto;
                scrollbar-width: thin;
                scrollbar-color: rgba(78,205,196,0.5) rgba(0,0,0,0.2);
            }

            .live-data::-webkit-scrollbar {
                width: 8px;
            }

            .live-data::-webkit-scrollbar-track {
                background: rgba(0,0,0,0.2);
            }

            .live-data::-webkit-scrollbar-thumb {
                background: rgba(78,205,196,0.5);
                border-radius: 4px;
            }

            .live-data::-webkit-scrollbar-thumb:hover {
                background: rgba(78,205,196,0.7);
            }

            .console-footer {
                background: rgba(0,0,0,0.6);
                backdrop-filter: blur(8px);
                padding: 20px;
                border-radius: 15px;
                margin-top: 30px;
                border: 1px solid rgba(255,255,255,0.1);
            }

            .console-output {
                background: rgba(0,0,0,0.8);
                padding: 15px;
                border-radius: 10px;
                max-height: 300px;
                overflow-y: auto;
                font-family: 'Courier New', monospace;
                font-size: 13px;
                color: #00ff00;
                scrollbar-width: thin;
                scrollbar-color: rgba(78,205,196,0.5) rgba(0,0,0,0.2);
            }

            .console-output::-webkit-scrollbar {
                width: 8px;
            }

            .console-output::-webkit-scrollbar-track {
                background: rgba(0,0,0,0.2);
            }

            .console-output::-webkit-scrollbar-thumb {
                background: rgba(78,205,196,0.5);
                border-radius: 4px;
            }

            .console-log {
                padding: 5px 8px;
                margin: 3px 0;
                border-left: 3px solid #4deeea;
                border-radius: 3px;
            }

            .console-info {
                color: #00ff00;
                border-left-color: #4deeea;
                background: rgba(77, 238, 234, 0.05);
            }

            .console-success {
                color: #74ee15;
                border-left-color: #74ee15;
                background: rgba(116, 238, 21, 0.05);
            }

            .console-error {
                color: #ff5555;
                border-left-color: #ff5555;
                background: rgba(255, 85, 85, 0.05);
            }

            .console-warning {
                color: #ffaa00;
                border-left-color: #ffaa00;
                background: rgba(255, 170, 0, 0.05);
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">
                    <i class="fab fa-whatsapp"></i> 𝘿𝙃𝙃𝙃𝙏 𝙏𝙈𝙆𝘾
                </div>
                <div class="tagline">Xmr</div>
                
                <div class="system-stats" id="systemStats">
                    <div class="stat-card">
                        <div class="stat-number" id="statMessages">0</div>
                        <div class="stat-label">Total Messages</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number" id="statSessions">0</div>
                        <div class="stat-label">Active Sessions</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number" id="statTasks">0</div>
                        <div class="stat-label">Running Tasks</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number" id="statUptime">0h 0m</div>
                        <div class="stat-label">System Uptime</div>
                    </div>
                </div>
            </div>

            <!-- System Control Panel -->
            <div class="system-panel">
                <div class="panel-title">
                    <i class="fas fa-cogs"></i> System Control Panel
                </div>
                <div class="system-controls">
                    <button class="btn btn-secondary" onclick="refreshSystemStats()">
                        <i class="fas fa-sync-alt"></i> Refresh Stats
                    </button>
                    <button class="btn btn-warning" onclick="showSystemInfo()">
                        <i class="fas fa-info-circle"></i> System Info
                    </button>
                    <button class="btn" onclick="showAllSessions()">
                        <i class="fas fa-list"></i> View All Sessions
                    </button>
                    <button class="btn btn-danger" onclick="clearAllLogs()">
                        <i class="fas fa-trash"></i> Clear All Logs
                    </button>
                </div>
                <div class="live-data" id="systemInfo">
                    System ready. Click buttons above to view information.
                </div>
            </div>

            <div class="grid">
                <!-- WhatsApp Pairing -->
                <div class="card">
                    <div class="card-header">
                        <div class="card-icon">
                            <i class="fas fa-qrcode"></i>
                        </div>
                        <div class="card-title">WhatsApp Pairing</div>
                    </div>
                    <form id="pairingForm">
                        <div class="form-group">
                            <label class="form-label">Your WhatsApp Number</label>
                            <input type="text" class="form-input" id="numberInput" placeholder="+919876543210" required>
                        </div>
                        <button type="button" class="btn" onclick="generatePairingCode()">
                            Generate Pairing Code
                        </button>
                    </form>
                    <div id="pairingResult"></div>
                </div>

                <!-- Send Messages -->
                <div class="card">
                    <div class="card-header">
                        <div class="card-icon">
                            <i class="fas fa-paper-plane"></i>
                        </div>
                        <div class="card-title">Send Messages</div>
                    </div>
                    <form action="/send-message" method="POST" enctype="multipart/form-data">
                        <div class="form-group">
                            <label class="form-label">Target Type</label>
                            <select class="form-select" name="targetType" required>
                                <option value="">Select Type</option>
                                <option value="number">Phone Number</option>
                                <option value="group">Group ID</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Target Number/Group ID</label>
                            <input type="text" class="form-input" name="target" placeholder="918766998510" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Message File (.txt)</label>
                            <input type="file" class="form-input" name="messageFile" accept=".txt" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Message Prefix (Optional)</label>
                            <input type="text" class="form-input" name="prefix" placeholder="Hello! ">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Delay (Seconds)</label>
                            <input type="number" class="form-input" name="delaySec" min="5" value="10" required>
                        </div>
                        <button type="submit" class="btn">Start Sending Messages</button>
                    </form>
                </div>

                <!-- Session Management -->
                <div class="card">
                    <div class="card-header">
                        <div class="card-icon">
                            <i class="fas fa-cog"></i>
                        </div>
                        <div class="card-title">Session Management</div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Your WhatsApp Number</label>
                        <input type="text" class="form-input" id="numberInputForSession" placeholder="+919876543210" required>
                    </div>
                    <button type="button" class="btn" onclick="generatePairingCodeForSession()">
                        Generate Pairing Code
                    </button>
                    <div id="pairingResult"></div>
                    
                    <hr style="margin-top: 20px; margin-bottom: 20px; border-color: rgba(255,255,255,0.15);">

                    <div class="form-group">
                        <label class="form-label">Your Session ID</label>
                        <input type="text" class="form-input" id="sessionIdDisplay" readonly>
                    </div>
                    <button class="btn btn-secondary" onclick="showMySessionId()">Show My Session</button>
                    <button class="btn btn-info" onclick="getMyGroups()" style="margin-top: 10px;">Show My Groups</button>
                    <button class="btn btn-danger" onclick="stopMySession()" style="margin-top: 10px;">Stop My Session</button>
                </div>

                <!-- View Session Tasks -->
                <div class="card">  
                    <div class="card-header">
                        <div class="card-icon">
                            <i class="fas fa-tasks"></i>
                        </div>
                        <div class="card-title">View Session Tasks</div>
                    </div>
                    <form id="viewSessionForm" onsubmit="event.preventDefault(); viewSessionTasks();">
                        <div class="form-group">
                            <label class="form-label">Enter Your Session ID</label>
                            <input type="text" class="form-input" id="sessionIdInput" placeholder="Enter your session ID" required>
                        </div>
                        <button type="submit" class="btn btn-primary">
                            Show My Tasks
                        </button>
                    </form>
                    <div id="sessionTasksResult" style="margin-top: 15px;"></div>
                </div>
            </div>

            <!-- Console Footer -->
            <div class="console-footer">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <h4 style="margin: 0; color: #4deeea; display: flex; align-items: center; gap: 10px;">
                        <i class="fas fa-terminal"></i> System Console
                    </h4>
                    <div style="display: flex; gap: 10px;">
                        <button onclick="clearConsole()" style="
                            background: #ff6b6b;
                            color: white;
                            border: none;
                            padding: 8px 15px;
                            border-radius: 6px;
                            cursor: pointer;
                            font-size: 0.85rem;
                            display: flex;
                            align-items: center;
                            gap: 5px;
                        ">
                            <i class="fas fa-trash"></i> Clear
                        </button>
                    </div>
                </div>
                <div id="consoleOutput" class="console-output"></div>
            </div>
        </div>

        <script>
            // System Functions
            async function refreshSystemStats() {
                try {
                    const response = await fetch('/api/stats');
                    const stats = await response.json();
                    
                    document.getElementById('statMessages').textContent = stats.totalMessagesSent.toLocaleString();
                    document.getElementById('statSessions').textContent = stats.activeSessions;
                    document.getElementById('statTasks').textContent = stats.activeTasks;
                    document.getElementById('statUptime').textContent = stats.uptime;
                    
                    showNotification('System stats updated!', 'success');
                } catch (error) {
                    showNotification('Error updating stats', 'error');
                }
            }

            async function showSystemInfo() {
                try {
                    const response = await fetch('/api/stats');
                    const stats = await response.json();
                    
                    const info = \`
Total Messages Sent: \${stats.totalMessagesSent.toLocaleString()}
Active Sessions: \${stats.activeSessions}
Running Tasks: \${stats.activeTasks}
System Uptime: \${stats.uptime}
Total Errors: \${stats.errors}
Server Time: \${new Date(stats.timestamp).toLocaleString()}
                    \`.trim();
                    
                    document.getElementById('systemInfo').textContent = info;
                } catch (error) {
                    document.getElementById('systemInfo').textContent = 'Error loading system info';
                }
            }

            async function showAllSessions() {
                try {
                    const response = await fetch('/api/sessions');
                    const sessions = await response.json();
                    
                    if (sessions.length === 0) {
                        document.getElementById('systemInfo').textContent = 'No active sessions found.';
                        return;
                    }
                    
                    let sessionInfo = 'ACTIVE SESSIONS:\\n\\n';
                    sessions.forEach(session => {
                        sessionInfo += \`Session: \${session.sessionId}\\n\`;
                        sessionInfo += \`Number: \${session.number}\\n\`;
                        sessionInfo += \`Status: \${session.isConnected ? 'CONNECTED' : 'DISCONNECTED'}\\n\`;
                        sessionInfo += \`Tasks: \${session.taskCount}\\n\`;
                        sessionInfo += \`Last Activity: \${new Date(session.lastActivity).toLocaleString()}\\n\\n\`;
                    });
                    
                    document.getElementById('systemInfo').textContent = sessionInfo;
                } catch (error) {
                    document.getElementById('systemInfo').textContent = 'Error loading sessions';
                }
            }

            function clearAllLogs() {
                if (confirm('Are you sure you want to clear all system logs?')) {
                    document.getElementById('systemInfo').textContent = 'All logs cleared.';
                    showNotification('System logs cleared', 'warning');
                }
            }

            // WhatsApp Functions
            async function generatePairingCode() {
                const number = document.getElementById('numberInput').value;
                if (!number) {
                    showNotification('Please enter your WhatsApp number', 'error');
                    return;
                }
                
                try {
                    const response = await fetch('/code?number=' + encodeURIComponent(number));
                    const result = await response.text();
                    document.getElementById('pairingResult').innerHTML = result;
                    refreshSystemStats();
                } catch (error) {
                    showNotification('Error generating pairing code', 'error');
                }
            }
            
            async function generatePairingCodeForSession() {
                const number = document.getElementById('numberInputForSession').value;
                if (!number) {
                    showNotification('Please enter your WhatsApp number', 'error');
                    return;
                }
                
                try {
                    const response = await fetch('/code?number=' + encodeURIComponent(number));
                    const result = await response.text();
                    document.getElementById('pairingResult').innerHTML = result;
                    refreshSystemStats();
                } catch (error) {
                    showNotification('Error generating pairing code', 'error');
                }
            }

            function showMySessionId() {
                const sessionId = localStorage.getItem('wa_session_id');
                if (sessionId) {
                    document.getElementById('sessionIdDisplay').value = sessionId;
                    showNotification('Session ID: ' + sessionId, 'success');
                } else {
                    showNotification('No active session found', 'warning');
                }
            }

            async function getMyGroups() {
                try {
                    const button = document.querySelector('button[onclick="getMyGroups()"]');
                    const originalText = button.innerHTML;
                    
                    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading Groups...';
                    button.disabled = true;

                    const response = await fetch('/get-groups');
                    
                    if (!response.ok) {
                        throw new Error('Server error: ' + response.status);
                    }
                    
                    const result = await response.text();
                    showGroupsModal(result);
                    
                } catch (error) {
                    showNotification('Error loading groups: ' + error.message, 'error');
                } finally {
                    const button = document.querySelector('button[onclick="getMyGroups()"]');
                    button.innerHTML = 'Show My Groups';
                    button.disabled = false;
                }
            }

            async function stopMySession() {
                const sessionId = localStorage.getItem('wa_session_id');
                if (!sessionId) {
                    showNotification('No active session found', 'warning');
                    return;
                }
                
                if (confirm('Are you sure you want to stop your session?')) {
                    try {
                        const response = await fetch('/stop-session', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded',
                            },
                            body: 'sessionId=' + encodeURIComponent(sessionId)
                        });
                        
                        if (response.ok) {
                            showNotification('Session stopped successfully', 'success');
                            localStorage.removeItem('wa_session_id');
                            document.getElementById('sessionIdDisplay').value = '';
                            refreshSystemStats();
                        }
                    } catch (error) {
                        showNotification('Error stopping session', 'error');
                    }
                }
            }

            // Session Tasks Functions
            async function viewSessionTasks() {
                const sessionId = document.getElementById('sessionIdInput').value.trim();
                const button = document.querySelector('#viewSessionForm button');
                const originalText = button.innerHTML;
                
                if (!sessionId) {
                    showNotification('Please enter your Session ID', 'error');
                    return;
                }

                try {
                    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading Tasks...';
                    button.disabled = true;

                    const response = await fetch(\`/session-status?sessionId=\${encodeURIComponent(sessionId)}\`);
                    
                    if (!response.ok) {
                        if (response.status === 404) {
                            throw new Error('Session not found or expired');
                        }
                        throw new Error('Server error: ' + response.status);
                    }
                    
                    const result = await response.text();
                    showSessionTasksModal(result, sessionId);
                    
                } catch (error) {
                    document.getElementById('sessionTasksResult').innerHTML = \`
                        <div style="padding: 15px; background: rgba(80,0,0,0.8); border-radius: 10px; border: 1px solid #ff5555;">
                            <h4 style="color: #ff5555; margin-bottom: 10px;">
                                <i class="fas fa-exclamation-triangle"></i> Error
                            </h4>
                            <p>\${error.message}</p>
                        </div>
                    \`;
                } finally {
                    button.innerHTML = originalText;
                    button.disabled = false;
                }
            }

            function showSessionTasksModal(htmlContent, sessionId) {
                const existingModal = document.getElementById('sessionTasksModal');
                if (existingModal) {
                    existingModal.remove();
                }

                const modal = document.createElement('div');
                modal.id = 'sessionTasksModal';
                modal.style.cssText = \`
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.9);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    z-index: 10000;
                    backdrop-filter: blur(10px);
                \`;

                modal.innerHTML = \`
                    <div style="
                        background: linear-gradient(135deg, #0a0a2a, #1a1a4a);
                        border: 2px solid #4deeea;
                        border-radius: 15px;
                        padding: 25px;
                        max-width: 95%;
                        max-height: 95vh;
                        width: 1000px;
                        overflow-y: auto;
                        color: white;
                        position: relative;
                        box-shadow: 0 0 40px rgba(77, 238, 234, 0.4);
                    ">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid #4deeea;">
                            <h2 style="color: #4deeea; margin: 0; display: flex; align-items: center; gap: 10px;">
                                <i class="fas fa-tasks"></i>
                                Session Tasks - \${sessionId}
                            </h2>
                            <button onclick="closeSessionTasksModal()" style="
                                background: #ff5555;
                                color: white;
                                border: none;
                                border-radius: 50%;
                                width: 35px;
                                height: 35px;
                                font-size: 18px;
                                cursor: pointer;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                            ">×</button>
                        </div>
                        
                        <div id="sessionTasksContent" style="max-height: 70vh; overflow-y: auto;">
                            \${htmlContent}
                        </div>
                        
                        <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #4deeea; display: flex; gap: 10px; justify-content: flex-end;">
                            <button onclick="refreshSessionTasks('\${sessionId}')" style="
                                background: #4deeea;
                                color: #0a0a2a;
                                border: none;
                                padding: 10px 20px;
                                border-radius: 6px;
                                font-weight: bold;
                                cursor: pointer;
                                display: flex;
                                align-items: center;
                                gap: 5px;
                            ">
                                <i class="fas fa-sync-alt"></i> Refresh
                            </button>
                            <button onclick="closeSessionTasksModal()" style="
                                background: #667EEA;
                                color: white;
                                border: none;
                                padding: 10px 20px;
                                border-radius: 6px;
                                font-weight: bold;
                                cursor: pointer;
                                display: flex;
                                align-items: center;
                                gap: 5px;
                            ">
                                <i class="fas fa-times"></i> Close
                            </button>
                        </div>
                    </div>
                \`;

                document.body.appendChild(modal);

                const hasRunningTasks = htmlContent.includes('status-running');
                if (hasRunningTasks) {
                    setTimeout(() => {
                        refreshSessionTasks(sessionId);
                    }, 10000);
                }
            }

            async function refreshSessionTasks(sessionId) {
                try {
                    const refreshButton = document.querySelector('button[onclick*="refreshSessionTasks"]');
                    const originalText = refreshButton.innerHTML;
                    
                    refreshButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing...';
                    refreshButton.disabled = true;

                    const response = await fetch(\`/session-status?sessionId=\${encodeURIComponent(sessionId)}\`);
                    
                    if (response.ok) {
                        const result = await response.text();
                        document.getElementById('sessionTasksContent').innerHTML = result;
                        showNotification('Tasks refreshed successfully', 'success');
                        
                        const hasRunningTasks = result.includes('status-running');
                        if (hasRunningTasks) {
                            setTimeout(() => {
                                refreshSessionTasks(sessionId);
                            }, 10000);
                        }
                    }
                } catch (error) {
                    showNotification('Error refreshing tasks', 'error');
                } finally {
                    const refreshButton = document.querySelector('button[onclick*="refreshSessionTasks"]');
                    if (refreshButton) {
                        refreshButton.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
                        refreshButton.disabled = false;
                    }
                }
            }

            function closeSessionTasksModal() {
                const modal = document.getElementById('sessionTasksModal');
                if (modal) {
                    modal.remove();
                }
            }

            // Groups Modal Functions
            function showGroupsModal(htmlContent) {
                const existingModal = document.getElementById('groupsModal');
                if (existingModal) {
                    existingModal.remove();
                }

                const modal = document.createElement('div');
                modal.id = 'groupsModal';
                modal.style.cssText = \`
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.8);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    z-index: 10000;
                    backdrop-filter: blur(5px);
                \`;

                modal.innerHTML = \`
                    <div style="
                        background: linear-gradient(135deg, #0a0a2a, #1a1a4a);
                        border: 2px solid #4deeea;
                        border-radius: 15px;
                        padding: 30px;
                        max-width: 90%;
                        max-height: 90vh;
                        width: 800px;
                        overflow-y: auto;
                        color: white;
                        position: relative;
                        box-shadow: 0 0 30px rgba(77, 238, 234, 0.3);
                    ">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px;">
                            <h2 style="color: #4deeea; margin: 0; display: flex; align-items: center; gap: 10px;">
                                <i class="fas fa-users"></i>
                                Your WhatsApp Groups
                            </h2>
                            <button onclick="closeGroupsModal()" style="
                                background: #ff5555;
                                color: white;
                                border: none;
                                border-radius: 50%;
                                width: 40px;
                                height: 40px;
                                font-size: 20px;
                                cursor: pointer;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                            ">×</button>
                        </div>
                        
                        <div id="groupsModalContent" style="max-height: 60vh; overflow-y: auto;">
                            \${htmlContent}
                        </div>
                        
                        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #4deeea;">
                            <button onclick="copyAllGroupUIDs()" style="
                                background: #4deeea;
                                color: #0a0a2a;
                                border: none;
                                padding: 12px 25px;
                                border-radius: 8px;
                                font-weight: bold;
                                cursor: pointer;
                                margin-right: 10px;
                            ">
                                <i class="fas fa-copy"></i> Copy All UIDs
                            </button>
                            <button onclick="closeGroupsModal()" style="
                                background: #667EEA;
                                color: white;
                                border: none;
                                padding: 12px 25px;
                                border-radius: 8px;
                                font-weight: bold;
                                cursor: pointer;
                            ">
                                <i class="fas fa-times"></i> Close
                            </button>
                        </div>
                    </div>
                \`;

                document.body.appendChild(modal);
            }

            function closeGroupsModal() {
                const modal = document.getElementById('groupsModal');
                if (modal) {
                    modal.remove();
                }
            }

            function copyGroupUID(uid) {
                navigator.clipboard.writeText(uid).then(() => {
                    showNotification('Group UID copied: ' + uid, 'success');
                }).catch(err => {
                    showNotification('Failed to copy UID', 'error');
                });
            }

            function copyAllGroupUIDs() {
                const groupElements = document.querySelectorAll('.group-item');
                const allUIDs = Array.from(groupElements).map(element => {
                    const uidElement = element.querySelector('p strong:contains("Group ID:")')?.nextSibling;
                    return uidElement?.textContent?.trim() || '';
                }).filter(uid => uid !== '');
                
                if (allUIDs.length === 0) {
                    showNotification('No Group UIDs found to copy', 'warning');
                    return;
                }
                
                const uidsText = allUIDs.join('\\n');
                navigator.clipboard.writeText(uidsText).then(() => {
                    showNotification(\`Copied \${allUIDs.length} Group UIDs to clipboard!\`, 'success');
                }).catch(err => {
                    showNotification('Failed to copy UIDs', 'error');
                });
            }

            // Utility Functions
            function showNotification(message, type = 'info') {
                const existingNotification = document.querySelector('.notification');
                if (existingNotification) {
                    existingNotification.remove();
                }

                const notification = document.createElement('div');
                notification.className = \`notification\`;
                notification.innerHTML = \`
                    <div style="display: flex; align-items: center; gap: 10px; padding: 15px 20px; border-radius: 8px; 
                         background: \${type === 'error' ? '#EF4444' : type === 'warning' ? '#F59E0B' : type === 'success' ? '#10B981' : '#3B82F6'}; 
                         color: white; position: fixed; top: 20px; right: 20px; z-index: 1000; box-shadow: 0 5px 15px rgba(0,0,0,0.3);">
                        <i class="fas fa-\${type === 'error' ? 'exclamation-triangle' : type === 'warning' ? 'exclamation-circle' : type === 'success' ? 'check-circle' : 'info-circle'}"></i>
                        <span>\${message}</span>
                    </div>
                \`;

                document.body.appendChild(notification);

                setTimeout(() => {
                    notification.remove();
                }, 5000);
            }

            function autoFillSessionId() {
                const savedSessionId = localStorage.getItem('wa_session_id');
                if (savedSessionId) {
                    document.getElementById('sessionIdInput').value = savedSessionId;
                }
            }

            // Event Listeners
            document.addEventListener('click', function(event) {
                const sessionModal = document.getElementById('sessionTasksModal');
                if (sessionModal && event.target === sessionModal) {
                    closeSessionTasksModal();
                }
                const groupsModal = document.getElementById('groupsModal');
                if (groupsModal && event.target === groupsModal) {
                    closeGroupsModal();
                }
            });

            document.addEventListener('keydown', function(event) {
                if (event.key === 'Escape') {
                    closeSessionTasksModal();
                    closeGroupsModal();
                }
            });

            // Console Log Functions
            function addConsoleLog(message, type = 'info') {
                const consoleOutput = document.getElementById('consoleOutput');
                const timestamp = new Date().toLocaleTimeString();
                const logEntry = document.createElement('div');
                logEntry.className = 'console-log console-' + type;
                logEntry.innerHTML = \`[\${timestamp}] \${message}\`;
                consoleOutput.insertBefore(logEntry, consoleOutput.firstChild);
                
                // Keep only last 100 logs
                while (consoleOutput.children.length > 100) {
                    consoleOutput.removeChild(consoleOutput.lastChild);
                }
            }

            function clearConsole() {
                document.getElementById('consoleOutput').innerHTML = '';
                addConsoleLog('Console cleared', 'info');
            }

            // Initialize on load
            document.addEventListener('DOMContentLoaded', function() {
                const savedSessionId = localStorage.getItem('wa_session_id');
                if (savedSessionId) {
                    document.getElementById('sessionIdDisplay').value = savedSessionId;
                    document.getElementById('sessionIdInput').value = savedSessionId;
                }
                refreshSystemStats();
                setInterval(refreshSystemStats, 30000);
                
                addConsoleLog('System initialized successfully', 'success');
                addConsoleLog('Console ready for monitoring', 'info');
            });

            // Override console methods to capture logs
            const originalLog = console.log;
            const originalError = console.error;
            const originalWarn = console.warn;

            console.log = function(...args) {
                originalLog.apply(console, args);
                addConsoleLog(args.join(' '), 'info');
            };

            console.error = function(...args) {
                originalError.apply(console, args);
                addConsoleLog(args.join(' '), 'error');
            };

            console.warn = function(...args) {
                originalWarn.apply(console, args);
                addConsoleLog(args.join(' '), 'warning');
            };
        </script>
    </body>
    </html>
    `);
});

// REST OF YOUR ORIGINAL ROUTES EXACTLY AS BEFORE
app.get("/code", async (req, res) => {
    const num = req.query.number.replace(/[^0-9]/g, "");
    const userIP = req.userIP;
    const sessionId = generateShortSessionId();
    const sessionPath = path.join("temp", sessionId);

    if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
    }

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();
        
        const waClient = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" }))
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }).child({ level: "fatal" }),
            browser: Browsers.ubuntu('Chrome'),
            syncFullHistory: false,
            generateHighQualityLinkPreview: true,
            shouldIgnoreJid: jid => isJidBroadcast(jid),
            getMessage: async key => {
                return {}
            }
        });

        if (!waClient.authState.creds.registered) {
            await delay(1500);
            
            const phoneNumber = num.replace(/[^0-9]/g, "");
            const code = await waClient.requestPairingCode(phoneNumber);
            
            activeClients.set(sessionId, {  
                client: waClient,  
                number: num,  
                authPath: sessionPath,
                isConnected: false,
                tasks: [],
                lastActivity: Date.now()
            });  
            
            userSessions.set(userIP, sessionId);

            res.send(`  
                <div style="margin-top: 20px; padding: 20px; background: rgba(20, 40, 80, 0.8); border-radius: 10px; border: 1px solid #4deeea;">
                    <h2>Pairing Code: ${code}</h2>  
                    <p style="font-size: 18px; margin-bottom: 20px;">Save this code to pair your device</p>
                    <div style="text-align: left; padding: 15px; background: rgba(0, 0, 30, 0.6); border-radius: 10px; margin-bottom: 20px;">
                        <p style="font-size: 16px;"><strong>To pair your device:</strong></p>
                        <ol>
                            <li>Open WhatsApp on your phone</li>
                            <li>Go to Settings → Linked Devices → Link a Device</li>
                            <li>Enter this pairing code when prompted</li>
                            <li>After pairing, start sending messages using the form below</li>
                        </ol>
                    </div>
                    <p style="font-size: 16px; margin-top: 20px;"><strong>Your Session ID: ${sessionId}</strong></p>
                    <p style="font-size: 14px;">Save this Session ID to manage your message sending tasks</p>
                    <script>
                        localStorage.setItem('wa_session_id', '${sessionId}');
                    </script>
                    <a href="/">Go Back to Home</a>  
                </div>  
            `);  
        }  

        waClient.ev.on("creds.update", saveCreds);  
        waClient.ev.on("connection.update", async (s) => {  
            const { connection, lastDisconnect } = s;  
            if (connection === "open") {  
                console.log(`WhatsApp Connected for ${num}! Session ID: ${sessionId}`);  
                const clientInfo = activeClients.get(sessionId);
                if (clientInfo) {
                    clientInfo.isConnected = true;
                    clientInfo.lastActivity = Date.now();
                }
            } else if (connection === "close") {
                const clientInfo = activeClients.get(sessionId);
                if (clientInfo) {
                    clientInfo.isConnected = false;
                    console.log(`Connection closed for Session ID: ${sessionId}`);
                    
                    if (lastDisconnect?.error?.output?.statusCode !== 401) {
                        console.log(`Attempting to reconnect for Session ID: ${sessionId}...`);
                        await delay(10000);
                        initializeClient(sessionId, num, sessionPath);
                    }
                }
            }  
        });

    } catch (err) {
        console.error("Error in pairing:", err);
        res.send(`<div style="padding: 20px; background: rgba(80,0,0,0.8); border-radius: 10px; border: 1px solid #ff5555;"><br><a href="/">Go Back</a>
                  </div>`);
    }
});

async function initializeClient(sessionId, num, sessionPath) {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();
        
        const waClient = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" }))
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }).child({ level: "fatal" }),
            browser: Browsers.ubuntu('Chrome'),
            syncFullHistory: false
        });

        const clientInfo = activeClients.get(sessionId) || {
            number: num,
            authPath: sessionPath,
            tasks: [],
            lastActivity: Date.now()
        };
        
        clientInfo.client = waClient;
        activeClients.set(sessionId, clientInfo);

        waClient.ev.on("creds.update", saveCreds);  
        waClient.ev.on("connection.update", async (s) => {  
            const { connection, lastDisconnect } = s;  
            if (connection === "open") {  
                console.log(`Reconnected successfully for Session ID: ${sessionId}`);  
                clientInfo.isConnected = true;
                clientInfo.lastActivity = Date.now();
                
                if (clientInfo.tasks && clientInfo.tasks.length > 0) {
                    clientInfo.tasks.forEach(task => {
                        if (task.isSending && !task.stopRequested) {
                            console.log(`Resuming task ${task.taskId} for session ${sessionId}`);
                            const messages = task.messages || [];
                            if (messages.length > 0) {
                                sendMessagesLoop(
                                    sessionId, 
                                    task.taskId, 
                                    messages, 
                                    waClient, 
                                    task.target, 
                                    task.targetType, 
                                    task.delaySec, 
                                    task.prefix, 
                                    clientInfo.number
                                );
                            }
                        }
                    });
                }
            } else if (connection === "close") {
                clientInfo.isConnected = false;
                console.log(`Connection closed again for Session ID: ${sessionId}`);
                
                if (lastDisconnect?.error?.output?.statusCode !== 401) {
                    console.log(`Reconnecting again for Session ID: ${sessionId}...`);
                    await delay(10000);
                    initializeClient(sessionId, num, sessionPath);
                }
            }  
        });

    } catch (err) {
        console.error(`Reconnection failed for Session ID: ${sessionId}`, err);
        setTimeout(() => initializeClient(sessionId, num, sessionPath), 30000);
    }
}

app.post("/send-message", upload.single("messageFile"), async (req, res) => {
    const { target, targetType, delaySec, prefix } = req.body;
    const userIP = req.userIP;
    
    const sessionId = userSessions.get(userIP);
    if (!sessionId || !activeClients.has(sessionId)) {
        return res.send(`<div style="padding: 20px; background: rgba(80,0,0,0.8); border-radius: 10px;">
                          <h2>Error: No active WhatsApp session found for your IP. Please generate a pairing code first.</h2>
                        </div>`);
    }

    const clientInfo = activeClients.get(sessionId);
    const { client: waClient, number: senderNumber } = clientInfo;
    const filePath = req.file?.path;

    if (!target || !filePath || !targetType || !delaySec) {
        return res.send(`<div style="padding: 20px; background: rgba(80,0,0,0.8); border-radius: 10px;">
                          <h2>Error: Missing required fields</h2>
                        </div>`);
    }

    try {
        const messages = fs.readFileSync(filePath, "utf-8").split("\n").filter(msg => msg.trim() !== "");
        
        if (messages.length === 0) {
            return res.send(`<div style="padding: 20px; background: rgba(80,0,0,0.8); border-radius: 10px;">
                              <h2>Error: Message file is empty</h2>
                            </div>`);
        }

        const taskId = generateShortTaskId();
        
        const taskInfo = {
            taskId,
            target,
            targetType,
            messages,
            delaySec,
            prefix,
            isSending: true,
            stopRequested: false,
            totalMessages: messages.length,
            sentMessages: 0,
            currentMessageIndex: 0,
            startTime: new Date(),
            logs: []
        };
        
        if (!clientInfo.tasks) clientInfo.tasks = [];
        clientInfo.tasks.push(taskInfo);
        clientInfo.lastActivity = Date.now();
        
        taskLogs.set(taskId, []);
        
        systemStats.totalMessagesSent += messages.length;
        systemStats.totalTasks++;
        
        res.send(`<script>
                    localStorage.setItem('wa_session_id', '${sessionId}');
                    window.location.href = '/session-status?sessionId=${sessionId}';
                  </script>`);
        
        sendMessagesLoop(sessionId, taskId, messages, waClient, target, targetType, delaySec, prefix, senderNumber);

    } catch (error) {
        console.error(`[${sessionId}] Error:`, error);
        systemStats.errors++;
        return res.send(`<div style="padding: 20px; background: rgba(80,0,0,0.8); border-radius: 10px;">
                          <h2>Error: ${error.message}</h2>
                        </div>`);
    }
});

async function sendMessagesLoop(sessionId, taskId, messages, waClient, target, targetType, delaySec, prefix, senderNumber) {
    const clientInfo = activeClients.get(sessionId);
    if (!clientInfo) return;
    
    const taskInfo = clientInfo.tasks.find(t => t.taskId === taskId);
    if (!taskInfo) return;
    
    const logs = taskLogs.get(taskId) || [];
    
    try {
        let index = taskInfo.currentMessageIndex;
        const recipient = targetType === "group" ? target + "@g.us" : target + "@s.whatsapp.net";
        
        // Keep repeating until manually stopped
        while (taskInfo.isSending && !taskInfo.stopRequested) {
            if (!clientInfo.isConnected) {
                const waitingLog = {
                    type: "info",
                    message: `[${new Date().toLocaleString()}] Waiting for connection to be restored...`,
                    details: `Pausing message sending until reconnected`,
                    timestamp: new Date()
                };
                
                logs.unshift(waitingLog);
                if (logs.length > 100) logs.pop();
                taskLogs.set(taskId, logs);
                
                console.log(`[${sessionId}] Connection lost, pausing task ${taskId}`);
                await delay(10000);
                continue;
            }
            
            let msg = messages[index];
            if (prefix && prefix.trim() !== "") {
                msg = `${prefix.trim()} ${msg}`;
            }
            
            const timestamp = new Date().toLocaleString();
            const messageNumber = taskInfo.sentMessages + 1;
            const cycleNumber = Math.floor(taskInfo.sentMessages / messages.length) + 1;
            
            try {
                await waClient.sendMessage(recipient, { text: msg });
                
                const successLog = {
                    type: "success",
                    message: `[${timestamp}] Message #${messageNumber} (Cycle ${cycleNumber}) sent successfully from ${senderNumber} to ${target}`,
                    details: `Message: "${msg}"`,
                    timestamp: new Date()
                };
                
                logs.unshift(successLog);
                if (logs.length > 100) logs.pop();
                taskLogs.set(taskId, logs);
                
                console.log(`[${sessionId}] Sent message #${messageNumber} (Cycle ${cycleNumber}) from ${senderNumber} to ${target}`);
                
                taskInfo.sentMessages++;
                systemStats.totalMessagesSent++;
                index = (index + 1) % messages.length; // Loop back to start when all messages sent
                taskInfo.currentMessageIndex = index;
                taskInfo.currentCycle = cycleNumber;
                clientInfo.lastActivity = Date.now();
                
            } catch (sendError) {
                const errorLog = {
                    type: "error",
                    message: `[${timestamp}] Failed to send message #${messageNumber} from ${senderNumber} to ${target}`,
                    details: `Error: ${sendError.message}`,
                    timestamp: new Date()
                };
                
                logs.unshift(errorLog);
                if (logs.length > 100) logs.pop();
                taskLogs.set(taskId, logs);
                
                console.error(`[${sessionId}] Error sending message:`, sendError);
                systemStats.errors++;
                
                if (sendError.message.includes("connection") || sendError.message.includes("socket") || 
                    sendError.message.includes("timeout") || sendError.message.includes("not connected")) {
                    clientInfo.isConnected = false;
                    console.log(`Connection issue detected for session ${sessionId}, waiting for reconnect...`);
                    await delay(5000);
                    continue;
                }
                
                await delay(5000);
            }
            
            await delay(delaySec * 1000);
        }
        
        taskInfo.endTime = new Date();
        taskInfo.isSending = false;
        
        if (taskInfo.stopRequested) {
            systemStats.failedTasks++;
        } else {
            systemStats.successfulTasks++;
        }
        
        const completionLog = {
            type: "info",
            message: `[${new Date().toLocaleString()}] Task stopped by user`,
            details: `Total messages sent: ${taskInfo.sentMessages} in ${taskInfo.currentCycle || 1} cycle(s)`,
            timestamp: new Date()
        };
        
        logs.unshift(completionLog);
        taskLogs.set(taskId, logs);
        
    } catch (error) {
        console.error(`[${sessionId}] Error in message loop:`, error);
        systemStats.errors++;
        systemStats.failedTasks++;
        
        const errorLog = {
            type: "error",
            message: `[${new Date().toLocaleString()}] Critical error in task execution`,
            details: `Error: ${error.message}`,
            timestamp: new Date()
        };
        
        logs.unshift(errorLog);
        taskLogs.set(taskId, logs);
        
        taskInfo.error = error.message;
        taskInfo.isSending = false;
        taskInfo.endTime = new Date();
    }
}

app.get("/session-status", (req, res) => {
    const sessionId = req.query.sessionId;
    if (!sessionId || !activeClients.has(sessionId)) {
        return res.send(`
            <div style="padding: 30px; text-align: center; background: rgba(80,0,0,0.8); border-radius: 10px; border: 1px solid #ff5555;">
                <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #ff5555; margin-bottom: 15px;"></i>
                <h3 style="color: #ff5555; margin-bottom: 10px;">Session Not Found</h3>
                <p>The Session ID <strong>${sessionId}</strong> was not found or has expired.</p>
            </div>
        `);
    }

    const clientInfo = activeClients.get(sessionId);
    
    res.send(`
        <div style="padding: 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding: 15px; background: rgba(30,50,90,0.5); border-radius: 10px;">
                <div>
                    <h3 style="color: #4deeea; margin: 0 0 5px 0;">Session: ${sessionId}</h3>
                    <p style="margin: 0; color: #a0a0d0;">WhatsApp: ${clientInfo.number}</p>
                </div>
                <div style="text-align: right;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="color: ${clientInfo.isConnected ? '#74ee15' : '#ff5555'}; font-weight: bold;">
                            ${clientInfo.isConnected ? '🟢 CONNECTED' : '🔴 DISCONNECTED'}
                        </span>
                    </div>
                    <p style="margin: 5px 0 0 0; font-size: 0.8rem; color: #a0a0d0;">
                        Last active: ${new Date(clientInfo.lastActivity).toLocaleString()}
                    </p>
                </div>
            </div>
            
            ${clientInfo.tasks && clientInfo.tasks.length > 0 ? `
                <div style="margin-top: 20px;">
                    <h4 style="color: #74ee15; margin-bottom: 15px; display: flex; align-items: center; gap: 8px;">
                        <i class="fas fa-list"></i>
                        Active Tasks (${clientInfo.tasks.length})
                    </h4>
                    <div class="task-list">
                        ${clientInfo.tasks.map(task => `
                            <div class="task-item" style="
                                background: rgba(255,255,255,0.05);
                                padding: 20px;
                                border-radius: 10px;
                                margin-bottom: 15px;
                                border-left: 4px solid ${task.isSending ? '#74ee15' : task.stopRequested ? '#ff5555' : '#4deeea'};
                            ">
                                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;">
                                    <div style="flex: 1;">
                                        <h5 style="color: #4deeea; margin: 0 0 10px 0;">
                                            ${task.target} (${task.targetType})
                                        </h5>
                                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.9rem;">
                                            <div><strong>Task ID:</strong> ${task.taskId}</div>
                                            <div><strong>Status:</strong> 
                                                <span style="color: ${task.isSending ? '#74ee15' : task.stopRequested ? '#ff5555' : '#4deeea'}; font-weight: bold;">
                                                    ${task.isSending ? '🔄 RUNNING (REPEATING)' : task.stopRequested ? '⏹️ STOPPED' : 'COMPLETED'}
                                                </span>
                                            </div>
                                            <div><strong>Messages Sent:</strong> ${task.sentMessages} ${task.currentCycle ? '(Cycle ' + task.currentCycle + ')' : ''}</div>
                                            <div><strong>Total Messages:</strong> ${task.totalMessages} per cycle</div>
                                            <div><strong>Start Time:</strong> ${task.startTime.toLocaleString()}</div>
                                            <div><strong>Mode:</strong> Continuous Loop</div>
                                        </div>
                                    </div>
                                </div>
                                
                                <div style="margin: 15px 0;">
                                    <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 0.8rem;">
                                        <span>Progress</span>
                                        <span>${Math.round((task.sentMessages / task.totalMessages) * 100)}%</span>
                                    </div>
                                    <div style="width: 100%; height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden;">
                                        <div style="width: ${(task.sentMessages / task.totalMessages) * 100}%; height: 100%; background: linear-gradient(90deg, #4deeea, #74ee15); border-radius: 4px;"></div>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : `
                <div style="text-align: center; padding: 40px 20px; color: #ffaa00;">
                    <i class="fas fa-inbox" style="font-size: 3rem; margin-bottom: 15px;"></i>
                    <h4>No Active Tasks</h4>
                    <p>This session doesn't have any active message sending tasks.</p>
                </div>
            `}
        </div>
    `);
});

app.get("/task-logs", (req, res) => {
    const { sessionId, taskId } = req.query;
    if (!sessionId || !activeClients.has(sessionId) || !taskLogs.has(taskId)) {
        return res.send(`<div style="padding: 20px; background: rgba(80,0,0,0.8); border-radius: 10px;">
                          <h2>Error: Invalid Session or Task ID</h2>
                        </div>`);
    }

    const logs = taskLogs.get(taskId) || [];
    const clientInfo = activeClients.get(sessionId);
    const taskInfo = clientInfo.tasks.find(t => t.taskId === taskId);
    
    if (!taskInfo) {
        return res.send(`<div style="padding: 20px; background: rgba(80,0,0,0.8); border-radius: 10px;">
                          <h2>Error: Task not found</h2>
                        </div>`);
    }
    
    let logsHtml = '';
    logs.forEach(log => {
        logsHtml += '<div class="log-entry log-' + log.type + '">';
        logsHtml += '<div><strong>' + log.message + '</strong></div>';
        logsHtml += '<div>' + log.details + '</div>';
        logsHtml += '</div>';
    });
    
    if (logs.length === 0) {
        logsHtml = '<div class="log-entry log-info">No logs yet. Messages will start sending shortly...</div>';
    }
    
    res.send(`
        <html>
        <head>
            <title>Task Logs - ${taskId}</title>
            <style>
                body { 
                    background: #0a0a2a;
                    color: #e0e0ff;
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    text-align: center;
                    padding: 20px;
                }
                .container {
                    max-width: 1000px;
                    margin: 0 auto;
                }
                .status-box {
                    background: rgba(20, 40, 60, 0.9);
                    padding: 30px;
                    border-radius: 15px;
                    margin: 20px auto;
                    border: 1px solid #74ee15;
                    text-align: center;
                }
                h1 {
                    color: #4deeea;
                }
                .task-id {
                    font-size: 24px;
                    background: rgba(30, 50, 90, 0.7);
                    padding: 15px;
                    border-radius: 10px;
                    display: inline-block;
                    margin: 20px 0;
                    border: 1px solid #4deeea;
                }
                .status-item {
                    margin: 15px 0;
                    font-size: 20px;
                }
                .status-value {
                    font-weight: bold;
                    color: #74ee15;
                }
                a {
                    display: inline-block;
                    margin-top: 30px;
                    padding: 15px 30px;
                    background: #4deeea;
                    color: #0a0a2a;
                    text-decoration: none;
                    font-weight: bold;
                    border-radius: 8px;
                    font-size: 20px;
                }
                .logs-container {
                    max-height: 500px;
                    overflow-y: auto;
                    background: rgba(0, 0, 0, 0.7);
                    padding: 15px;
                    border-radius: 10px;
                    margin: 20px 0;
                    text-align: left;
                    font-family: monospace;
                    font-size: 14px;
                }
                .log-entry {
                    margin: 8px 0;
                    padding: 8px;
                    border-radius: 5px;
                    border-left: 3px solid #4deeea;
                }
                .log-success {
                    border-left-color: #74ee15;
                    background: rgba(116, 238, 21, 0.1);
                }
                .log-error {
                    border-left-color: #ff5555;
                    background: rgba(255, 85, 85, 0.1);
                }
                .log-info {
                    border-left-color: #4deeea;
                    background: rgba(77, 238, 234, 0.1);
                }
                .auto-refresh {
                    margin: 20px 0;
                    font-size: 16px;
                }
            </style>
            <script>
                function refreshPage() {
                    location.reload();
                }
                
                ${taskInfo.isSending ? 'setTimeout(refreshPage, 10000);' : ''}
                
                window.onload = function() {
                    const logsContainer = document.querySelector('.logs-container');
                    if (logsContainer) {
                        logsContainer.scrollTop = 0;
                    }
                };
            </script>
        </head>
        <body>
            <div class="container">
                <h1>Task Logs</h1>
                
                <div class="status-box">
                    <div class="task-id">Task ID: ${taskId}</div>
                    
                    <div class="status-item">
                        Status: <span class="status-value">${taskInfo.isSending ? 'RUNNING' : taskInfo.stopRequested ? 'STOPPED' : 'COMPLETED'}</span>
                    </div>
                    
                    <div class="status-item">
                        Target: <span class="status-value">${taskInfo.target} (${taskInfo.targetType})</span>
                    </div>
                    
                    <div class="status-item">
                        Messages Sent: <span class="status-value">${taskInfo.sentMessages} of ${taskInfo.totalMessages}</span>
                    </div>
                    
                    <div class="status-item">
                        Start Time: <span class="statusValue">${taskInfo.startTime.toLocaleString()}</span>
                    </div>
                    
                    ${taskInfo.endTime ? '<div class="status-item">End Time: <span class="status-value">' + taskInfo.endTime.toLocaleString() + '</span></div>' : ''}
                    
                    ${taskInfo.error ? '<div class="status-item" style="color:#ff5555;">Error: ' + taskInfo.error + '</div>' : ''}
                    
                    <div class="auto-refresh">
                        ${taskInfo.isSending ? 'Page will auto-refresh every 10 seconds' : ''}
                    </div>
                </div>
                
                <div class="status-box">
                    <h2>Live Logs (Newest First)</h2>
                    <div class="logs-container">
                        ${logsHtml}
                    </div>
                </div>
                
                <a href="/session-status?sessionId=${sessionId}">Return to Session Status</a>
            </div>
        </body>
        </html>
    `);
});

app.post("/view-session", (req, res) => {
    const { sessionId } = req.body;
    res.redirect(`/session-status?sessionId=${sessionId}`);
});

app.post("/stop-session", async (req, res) => {
    const { sessionId } = req.body;

    if (!activeClients.has(sessionId)) {
        return res.send(`<div style="padding: 20px; background: rgba(80,0,0,0.8); border-radius: 10px;">
                          <h2>Error: Invalid Session ID</h2>
                        </div>`);
    }

    try {
        const clientInfo = activeClients.get(sessionId);
        
        if (clientInfo.tasks) {
            clientInfo.tasks.forEach(task => {
                task.stopRequested = true;
                task.isSending = false;
                task.endTime = new Date();
            });
        }
        
        if (clientInfo.client) {
            clientInfo.client.end();
        }
        
        activeClients.delete(sessionId);
        
        for (let [ip, sessId] of userSessions.entries()) {
            if (sessId === sessionId) {
                userSessions.delete(ip);
                break;
            }
        }

        res.send(`  
            <div style="padding: 20px; background: rgba(20, 80, 20, 0.8); border-radius: 10px;">
                <h2>Session ${sessionId} stopped successfully</h2>
                <p>All tasks in this session have been stopped.</p>
            </div>  
        `);

    } catch (error) {
        console.error(`Error stopping session ${sessionId}:`, error);
        res.send(`<div style="padding: 20px; background: rgba(80,0,0,0.8); border-radius: 10px;">
                    <h2>Error stopping session</h2>
                    <p>${error.message}</p>
                  </div>`);
    }
});

app.post("/stop-task", async (req, res) => {
    const { sessionId, taskId } = req.body;

    if (!activeClients.has(sessionId)) {
        return res.send(`<div style="padding: 20px; background: rgba(80,0,0,0.8); border-radius: 10px;">
                          <h2>Error: Invalid Session ID</h2>
                        </div>`);
    }

    try {
        const clientInfo = activeClients.get(sessionId);
        const taskInfo = clientInfo.tasks.find(t => t.taskId === taskId);
        
        if (!taskInfo) {
            return res.send(`<div style="padding: 20px; background: rgba(80,0,0,0.8); border-radius: 10px;">
                              <h2>Error: Task not found</h2>
                            </div>`);
        }
        
        taskInfo.stopRequested = true;
        taskInfo.isSending = false;
        taskInfo.endTime = new Date();

        const logs = taskLogs.get(taskId) || [];
        logs.unshift({
            type: "info",
            message: `[${new Date().toLocaleString()}] Task stopped by user`,
            details: `Total messages sent: ${taskInfo.sentMessages}`,
            timestamp: new Date()
        });
        taskLogs.set(taskId, logs);

        res.send(`<script>window.location.href = '/session-status?sessionId=${sessionId}';</script>`);

    } catch (error) {
        console.error(`Error stopping task ${taskId}:`, error);
        res.send(`<div style="padding: 20px; background: rgba(80,0,0,0.8); border-radius: 10px;">
                    <h2>Error stopping task</h2>
                    <p>${error.message}</p>
                  </div>`);
    }
});

app.get("/get-groups", async (req, res) => {
    const userIP = req.userIP;
    
    const sessionId = userSessions.get(userIP);
    if (!sessionId || !activeClients.has(sessionId)) {
        return res.send(`
            <div style="padding: 20px; background: rgba(80,0,0,0.8); border-radius: 10px; border: 1px solid #ff5555; text-align: center;">
                <h3 style="color: #ff5555; margin-bottom: 10px;">
                    <i class="fas fa-exclamation-triangle"></i> No Active Session
                </h3>
                <p>Please generate a pairing code first to connect your WhatsApp account.</p>
            </div>
        `);
    }

    try {
        const { client: waClient, number: senderNumber } = activeClients.get(sessionId);
        const groups = await waClient.groupFetchAllParticipating();
        
        let groupsList = `
            <div style="margin-bottom: 20px; padding: 15px; background: rgba(30,50,90,0.5); border-radius: 10px;">
                <h3 style="color: #74ee15; margin: 0; display: flex; align-items: center; gap: 10px;">
                    <i class="fas fa-user"></i> Connected as: ${senderNumber}
                </h3>
            </div>
        `;
        
        if (Object.keys(groups).length === 0) {
            groupsList += `
                <div style="text-align: center; padding: 40px 20px; color: #ffaa00;">
                    <i class="fas fa-users-slash" style="font-size: 3rem; margin-bottom: 15px;"></i>
                    <h3>No Groups Found</h3>
                    <p>You are not a member of any WhatsApp groups.</p>
                </div>
            `;
        } else {
            groupsList += `<div class="group-list">`;
            
            Object.keys(groups).forEach((groupId, index) => {
                const group = groups[groupId];
                const cleanGroupId = groupId.replace('@g.us', '');
                const participantsCount = group.participants ? group.participants.length : 0;
                const creationDate = group.creation ? new Date(group.creation * 1000).toLocaleDateString() : 'Unknown';
                
                groupsList += `
                    <div class="group-item" style="
                        background: rgba(255,255,255,0.05);
                        padding: 20px;
                        border-radius: 12px;
                        margin-bottom: 15px;
                        border-left: 4px solid #4deeea;
                        transition: all 0.3s ease;
                    ">
                        <div style="display: flex; justify-content: between; align-items: flex-start; margin-bottom: 15px;">
                            <div style="flex: 1;">
                                <h4 style="color: #4deeea; margin: 0 0 10px 0; font-size: 1.2rem;">
                                    ${index + 1}. ${group.subject || 'Unknown Group'}
                                </h4>
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.9rem;">
                                    <div>
                                        <strong>Group UID:</strong> 
                                        <code style="background: rgba(0,0,0,0.3); padding: 4px 8px; border-radius: 4px; margin-left: 8px;">
                                            ${cleanGroupId}
                                        </code>
                                    </div>
                                    <div><strong>Participants:</strong> ${participantsCount}</div>
                                    <div><strong>Created:</strong> ${creationDate}</div>
                                    <div><strong>Status:</strong> <span style="color: #74ee15;">Active</span></div>
                                </div>
                            </div>
                        </div>
                        <button onclick="copyGroupUID('${cleanGroupId}')" style="
                            background: #4deeea;
                            color: #0a0a2a;
                            border: none;
                            padding: 8px 16px;
                            border-radius: 6px;
                            cursor: pointer;
                            font-weight: bold;
                            font-size: 0.9rem;
                            display: flex;
                            align-items: center;
                            gap: 5px;
                        ">
                            <i class="fas fa-copy"></i> Copy UID
                        </button>
                    </div>
                `;
            });
            
            groupsList += `</div>`;
            
            groupsList += `
                <div style="margin-top: 20px; padding: 15px; background: rgba(116, 238, 21, 0.1); border-radius: 10px; text-align: center;">
                    <p style="margin: 0; color: #74ee15; font-weight: bold;">
                        <i class="fas fa-check-circle"></i> 
                        Total ${Object.keys(groups).length} groups loaded successfully
                    </p>
                </div>
            `;
        }
        
        res.send(groupsList);

    } catch (error) {
        console.error("Error fetching groups:", error);
        res.send(`
            <div style="padding: 30px; text-align: center; background: rgba(80,0,0,0.8); border-radius: 10px; border: 1px solid #ff5555;">
                <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #ff5555; margin-bottom: 15px;"></i>
                <h3 style="color: #ff5555; margin-bottom: 10px;">Error Loading Groups</h3>
                <p style="margin-bottom: 20px;">${error.message}</p>
            </div>
        `);
    }
});

// Enhanced error handling
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    activeClients.forEach(({ client }, sessionId) => {
        client.end();
        console.log(`Closed connection for Session ID: ${sessionId}`);
    });
    process.exit();
});

app.listen(PORT, () => {
    console.log(`🚀 WhatsApp Master Pro System Started on http://localhost:${PORT}`);
    console.log(`✅ All Systems Integrated Successfully!`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
});
