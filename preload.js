const { contextBridge } = require('electron')
contextBridge.exposeInMainWorld('ipc', {
  send: require('electron').ipcRenderer.send
})