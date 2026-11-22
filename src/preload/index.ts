import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type PoeApi, type SessionState } from '@shared/api'
import { PLAN_IPC, type PlanView } from '@shared/plan'

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
  toggleOverlay: () => ipcRenderer.invoke(IPC.toggleOverlay),
  plan: {
    get: () => ipcRenderer.invoke(PLAN_IPC.get),
    onChange: (listener) => {
      const handler = (_event: IpcRendererEvent, view: PlanView): void => listener(view)
      ipcRenderer.on(PLAN_IPC.state, handler)
      return () => {
        ipcRenderer.removeListener(PLAN_IPC.state, handler)
      }
    },
    setAnswers: (answers) => ipcRenderer.invoke(PLAN_IPC.setAnswers, answers),
    chooseBuild: (buildId) => ipcRenderer.invoke(PLAN_IPC.chooseBuild, buildId),
    setOptions: (patch) => ipcRenderer.invoke(PLAN_IPC.setOptions, patch),
    setPosition: (position) => ipcRenderer.invoke(PLAN_IPC.setPosition, position),
    moveGroup: (delta) => ipcRenderer.invoke(PLAN_IPC.moveGroup, delta)
  }
}

contextBridge.exposeInMainWorld('poe', api)
