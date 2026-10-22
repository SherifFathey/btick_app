const {
  app,
  BrowserWindow,
  Menu,
  shell,
  ipcMain,
  nativeImage,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { RecordingStore } = require("./recordingStore.cjs");

// Single-instance lock to prevent multiple instances from conflicting
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.warn("[BTick] Another instance is already running. Quitting.");
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Explicitly set the application identity for desktop environments (Ubuntu Dock, GNOME, taskbars)
app.setName("BTick");
app.name = "BTick";
if (app.setDesktopName) {
  app.setDesktopName("btick.desktop");
}
if (app.setAppUserModelId) {
  app.setAppUserModelId("com.sheriffathey.btick");
}

// Ensure Linux window managers and desktop docks identify the window class as BTick
if (process.platform === "linux") {
  app.commandLine.appendSwitch("class", "BTick");
  app.commandLine.appendSwitch("name", "BTick");
}

// Configure Linux stability & sandbox switches
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-sandbox");

let mainWindow = null;
let discoveryProcess = null;
let lastTreeMessage = null;
let recordingStore = null;

function getBridgeScriptPath() {
  const fs = require("fs");
  let targetPath;
  if (app.isPackaged) {
    targetPath = path.join(process.resourcesPath, "bridge", "bt_bridge.py");
  } else {
    targetPath = path.join(__dirname, "..", "bridge", "bt_bridge.py");
  }
  if (!fs.existsSync(targetPath)) {
    console.error(
      `[BTick] Bridge script not found at expected path: ${targetPath}`,
    );
  }
  return targetPath;
}

function sendBridgeMessage(msgObj) {
  if (
    discoveryProcess &&
    discoveryProcess.stdin &&
    !discoveryProcess.stdin.destroyed
  ) {
    try {
      const line = JSON.stringify(msgObj) + "\n";
      discoveryProcess.stdin.write(line);
    } catch (e) {
      console.warn(
        "[BTick] Failed to send message to bridge process:",
        e.message,
      );
    }
  }
}

function sendROS2Command(cmdObj) {
  sendBridgeMessage({ type: "command", data: cmdObj });
}

function sendSwitchSource(sourceData) {
  sendBridgeMessage({ type: "switch_source", ...sourceData });
}

function sendDisconnectSource(source) {
  sendBridgeMessage({ type: "disconnect", source });
}

function broadcastToClients(data) {
  if (!data) return;

  if (data.type === "tree_created" || data.type === "sync_state") {
    lastTreeMessage = data;
  }

  // Send via native Electron IPC directly to the UI
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("ros2_event", data);
  }
}

function startROS2TopicListeners() {
  const fs = require("fs");
  const env = { ...process.env, PYTHONUNBUFFERED: "1" };
  const bridgeScript = getBridgeScriptPath();
  const wsPort = process.env.BTICK_WS_PORT || "8080";

  const distros = ["jazzy", "iron", "humble", "rolling"];
  let rosSetup = "";
  if (
    process.env.ROS_DISTRO &&
    fs.existsSync(`/opt/ros/${process.env.ROS_DISTRO}/setup.bash`)
  ) {
    rosSetup = `/opt/ros/${process.env.ROS_DISTRO}/setup.bash`;
  } else {
    for (const d of distros) {
      const candidate = `/opt/ros/${d}/setup.bash`;
      if (fs.existsSync(candidate)) {
        rosSetup = candidate;
        break;
      }
    }
  }

  const bashCmd = rosSetup
    ? `source "${rosSetup}" && exec python3 -u "$0" "$@"`
    : `exec python3 -u "$0" "$@"`;

  let stderrTail = "";

  try {
    const proc = spawn(
      "bash",
      ["-c", bashCmd, bridgeScript, "--http-port", "0", "--ws-port", wsPort],
      { env },
    );

    let buffer = "";
    proc.stdout.on("data", (data) => {
      process.stdout.write(data);
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop(); // Keep remainder in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
          try {
            const parsed = JSON.parse(trimmed);
            broadcastToClients(parsed);
          } catch (e) {
            // Ignore non-JSON output
          }
        }
      }
    });

    proc.stderr.on("data", (err) => {
      process.stderr.write(err);
      stderrTail = (stderrTail + err.toString()).slice(-2000);
    });

    proc.on("error", (err) => {
      console.error("[BTick] Bridge process error:", err.message);
      broadcastToClients({
        type: "bridge_status",
        status: "error",
        error: err.message,
        stderr: stderrTail,
      });
    });

    proc.on("exit", (code, signal) => {
      if (code !== 0 && code !== null) {
        console.warn(
          `[BTick] Bridge process exited with code ${code}, signal ${signal}`,
        );
        broadcastToClients({
          type: "bridge_status",
          status: "stopped",
          code,
          signal,
          error: `Bridge process terminated (exit code: ${code})`,
          stderr: stderrTail,
        });
      }
    });

    discoveryProcess = proc;
  } catch (e) {
    console.error("[BTick] Failed to start bridge process:", e.message);
    broadcastToClients({
      type: "bridge_status",
      status: "error",
      error: e.message,
      stderr: stderrTail,
    });
  }
}

function stopROS2TopicListeners() {
  if (discoveryProcess) {
    discoveryProcess.kill();
    discoveryProcess = null;
  }
}

function registerIpcHandlers() {
  recordingStore = new RecordingStore(
    path.join(app.getPath("userData"), "recordings"),
  );

  ipcMain.handle(
    "recording:start",
    async (_event, sessionId, initialTrees, metadata) => {
      try {
        await recordingStore.startSession(sessionId, initialTrees, metadata);
      } catch (error) {
        throw new Error(`Recording start failed: ${error.message}`);
      }
    },
  );
  ipcMain.handle(
    "recording:append-batch",
    async (_event, sessionId, records) => {
      try {
        await recordingStore.appendBatch(sessionId, records);
      } catch (error) {
        throw new Error(`Recording append failed: ${error.message}`);
      }
    },
  );
  ipcMain.handle(
    "recording:finalize",
    async (_event, sessionId, finalTrees) => {
      try {
        return await recordingStore.finalize(sessionId, finalTrees);
      } catch (error) {
        throw new Error(`Recording finalize failed: ${error.message}`);
      }
    },
  );
  ipcMain.handle("recording:read-records", async (_event, sessionId) => {
    try {
      return await recordingStore.readRecords(sessionId);
    } catch (error) {
      throw new Error(`Recording read failed: ${error.message}`);
    }
  });
  ipcMain.handle("recording:delete", async (_event, sessionId) => {
    try {
      await recordingStore.deleteSession(sessionId);
    } catch (error) {
      throw new Error(`Recording delete failed: ${error.message}`);
    }
  });
  ipcMain.handle(
    "recording:update-heartbeat",
    async (_event, sessionId, timestamp) => {
      try {
        await recordingStore.updateHeartbeat(sessionId, timestamp);
      } catch (error) {
        // Non-fatal heartbeat warning
      }
    },
  );

  // Handle renderer ready and get_tree requests
  ipcMain.on("renderer_ready", (event) => {
    if (lastTreeMessage) {
      event.reply("ros2_event", lastTreeMessage);
    }
    sendBridgeMessage({ type: "get_tree" });
  });

  ipcMain.on("get_tree", (event) => {
    if (lastTreeMessage) {
      event.reply("ros2_event", lastTreeMessage);
    }
    sendBridgeMessage({ type: "get_tree" });
  });

  ipcMain.on("ros2_command", (_event, cmd) => {
    sendROS2Command(cmd);
  });

  ipcMain.on("switch_source", (_event, data) => {
    sendSwitchSource(data);
  });

  ipcMain.on("disconnect_source", (_event, source) => {
    sendDisconnectSource(source);
  });
}

function getAppIcon() {
  const os = require("os");
  const candidates = [
    path.join(__dirname, "../build/icons/512x512.png"),
    path.join(__dirname, "../build/icons/icon.png"),
    path.join(__dirname, "../public/tree.png"),
    path.join(__dirname, "../dist/tree.png"),
    path.join(process.resourcesPath || "", "build/icons/512x512.png"),
    path.join(process.resourcesPath || "", "build/icons/icon.png"),
    path.join(process.resourcesPath || "", "dist/tree.png"),
    path.join(process.resourcesPath || "", "public/tree.png"),
    "/usr/share/icons/hicolor/512x512/apps/btick.png",
    path.join(
      os.homedir(),
      ".local/share/icons/hicolor/512x512/apps/btick.png",
    ),
    "/usr/share/pixmaps/btick.png",
  ];
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        const img = nativeImage.createFromPath(candidate);
        if (!img.isEmpty()) {
          return { img, path: candidate };
        }
      }
    } catch (_) {}
  }
  return { img: null, path: null };
}

function createWindow() {
  const wsPort = process.env.BTICK_WS_PORT || "8080";
  const appIcon = getAppIcon();

  const windowOptions = {
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: "BTick",
    backgroundColor: "#F8FAFC",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  };

  if (appIcon.img && !appIcon.img.isEmpty()) {
    windowOptions.icon = appIcon.img;
  } else if (appIcon.path) {
    windowOptions.icon = appIcon.path;
  }

  mainWindow = new BrowserWindow(windowOptions);

  if (appIcon.img && !appIcon.img.isEmpty()) {
    try {
      mainWindow.setIcon(appIcon.img);
    } catch (_) {}
  }

  // Automatically maximize window to fill screen width and height (not F11 fullscreen)
  mainWindow.maximize();

  // Load the built Vite production single-page app
  const indexPath = path.join(__dirname, "../dist/index.html");
  mainWindow.loadFile(indexPath, {
    query: { v: String(Date.now()), ws_port: wsPort },
  });

  mainWindow.webContents.on("did-finish-load", () => {
    if (lastTreeMessage) {
      mainWindow.webContents.send("ros2_event", lastTreeMessage);
    }
  });

  // Open external links in default system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Build native application menu
  const menuTemplate = [
    {
      label: "File",
      submenu: [
        {
          label: "Quit",
          accelerator: "CmdOrCtrl+Q",
          click: () => app.quit(),
        },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About BTick",
          click: () => {
            const { dialog } = require("electron");
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "About BTick",
              message: `BTick v${app.getVersion()}`,
              detail:
                "Standalone BehaviorTree.CPP 4.x & ROS 2 Live Visualizer.\n100% Free & Open-Source.",
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  //   console.log(
  //     String.raw` ____ _____ _      _
  // | __ )_   _(_) ___| | __
  // |  _ \ | | | |/ __| |/ /
  // | |_) || | | | (__|   <
  // |____/ |_| |_|\___|_|\_\
  //                         `
  //   );
  //   console.log('='.repeat(66));
  //   console.log(' 🌲 BTICK UNIFIED MULTI-PROTOCOL BRIDGE SERVER');
  //   console.log('='.repeat(66));

  registerIpcHandlers();
  startROS2TopicListeners();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  stopROS2TopicListeners();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
