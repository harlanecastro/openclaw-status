const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('openclawBridge', {
  onLogsData: (callback) => ipcRenderer.on('logs-data', (_event, data) => callback(data)),
  onAboutData: (callback) => ipcRenderer.on('about-data', (_event, data) => callback(data)),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  clearLogs: () => ipcRenderer.invoke('clear-logs'),
  getLang: () => ipcRenderer.invoke('get-lang'),
  refreshLogs: () => ipcRenderer.invoke('refresh-logs')
});
