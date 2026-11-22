import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type PoeApi, type SessionState } from '@shared/api'

const api: PoeApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  onState: (listener) => {
    const handler = (_event: IpcRendererEvent, state: SessionState): void => listener(state)
    ipcRenderer.on(IPC.state, handler)
    return () => {
      ipcRenderer.removeListener(IPC.state, handler)
    }
  },
  getConfig: () => ipcRenderer.invoke(IPC.getConfig),
  setConfig: (patch) => ipcRenderer.invoke(IPC.setConfig, patch),
  pickLogFile: () => ipcRenderer.invoke(IPC.pickLogFile),
  detectLog: () => ipcRenderer.invoke(IPC.detectLog),
  toggleOverlay: () => ipcRenderer.invoke(IPC.toggleOverlay)
}

contextBridge.exposeInMainWorld('poe', api)
