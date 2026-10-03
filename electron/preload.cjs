const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  onROS2Event: (callback) => {
    ipcRenderer.on('ros2_event', (_event, data) => callback(data));
  },
  requestTree: () => {
    ipcRenderer.send('get_tree');
  },
  notifyReady: () => {
    ipcRenderer.send('renderer_ready');
  },
  sendCommand: (cmd) => {
    ipcRenderer.send('ros2_command', cmd);
  },
  switchSource: (data) => {
    ipcRenderer.send('switch_source', data);
  },
  disconnectSource: (source) => {
    ipcRenderer.send('disconnect_source', source);
  },
  recordingStorage: {
    startSession: (sessionId, initialTrees, metadata) =>
      ipcRenderer.invoke('recording:start', sessionId, initialTrees, metadata),
    appendBatch: (sessionId, records) =>
      ipcRenderer.invoke('recording:append-batch', sessionId, records),
    finalize: (sessionId, finalTrees) =>
      ipcRenderer.invoke('recording:finalize', sessionId, finalTrees),
    readRecords: (sessionId) =>
      ipcRenderer.invoke('recording:read-records', sessionId),
    deleteSession: (sessionId) =>
      ipcRenderer.invoke('recording:delete', sessionId),
    updateHeartbeat: (sessionId, timestamp) =>
      ipcRenderer.invoke('recording:update-heartbeat', sessionId, timestamp),
  },
});
