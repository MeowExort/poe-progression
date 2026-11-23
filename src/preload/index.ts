import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type PoeApi, type SessionState } from '@shared/api'
import { FILTER_IPC, type FilterView } from '@shared/filter'
import { PLAN_IPC, type PlanView } from '@shared/plan'
import { SANCTUM_IPC, type SanctumView } from '@shared/sanctum'
import { UPDATE_IPC, type UpdateState } from '@shared/update'

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
  editOverlay: (layout) => ipcRenderer.invoke(IPC.editOverlay, layout),
  setOverlayBounds: (bounds) => ipcRenderer.invoke(IPC.setOverlayBounds, bounds),
  resetOverlay: (layout) => ipcRenderer.invoke(IPC.resetOverlay, layout),
  copyText: (text) => ipcRenderer.invoke(IPC.copyText, text),
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
    importPob: (code) => ipcRenderer.invoke(PLAN_IPC.importPob, code),
    refreshTree: () => ipcRenderer.invoke(PLAN_IPC.refreshTree),
    setTreeTarget: (index) => ipcRenderer.invoke(PLAN_IPC.setTreeTarget, index),
    clearPob: () => ipcRenderer.invoke(PLAN_IPC.clearPob),
    setPobSets: (indexes) => ipcRenderer.invoke(PLAN_IPC.setPobSets, indexes),
    setOptions: (patch) => ipcRenderer.invoke(PLAN_IPC.setOptions, patch),
    setPosition: (position) => ipcRenderer.invoke(PLAN_IPC.setPosition, position),
    moveGroup: (delta) => ipcRenderer.invoke(PLAN_IPC.moveGroup, delta)
  },
  sanctum: {
    get: () => ipcRenderer.invoke(SANCTUM_IPC.get),
    onChange: (listener) => {
      const handler = (_event: IpcRendererEvent, view: SanctumView): void => listener(view)
      ipcRenderer.on(SANCTUM_IPC.state, handler)
      return () => {
        ipcRenderer.removeListener(SANCTUM_IPC.state, handler)
      }
    },
    saveAccess: (access) => ipcRenderer.invoke(SANCTUM_IPC.saveAccess, access),
    clearCookie: () => ipcRenderer.invoke(SANCTUM_IPC.clearCookie),
    snapshot: () => ipcRenderer.invoke(SANCTUM_IPC.snapshot),
    setTracked: (names, trackAll) => ipcRenderer.invoke(SANCTUM_IPC.setTracked, names, trackAll),
    getCatalog: () => ipcRenderer.invoke(SANCTUM_IPC.getCatalog),
    newSession: () => ipcRenderer.invoke(SANCTUM_IPC.newSession),
    failActive: () => ipcRenderer.invoke(SANCTUM_IPC.failActive),
    dumpSiteAnswer: () => ipcRenderer.invoke(SANCTUM_IPC.dumpSiteAnswer),
    setOutcome: (runId, outcome) => ipcRenderer.invoke(SANCTUM_IPC.setOutcome, runId, outcome),
    deleteRun: (runId) => ipcRenderer.invoke(SANCTUM_IPC.deleteRun, runId)
  },
  filter: {
    get: () => ipcRenderer.invoke(FILTER_IPC.get),
    onChange: (listener) => {
      const handler = (_event: IpcRendererEvent, view: FilterView): void => listener(view)
      ipcRenderer.on(FILTER_IPC.state, handler)
      return () => {
        ipcRenderer.removeListener(FILTER_IPC.state, handler)
      }
    },
    setOptions: (patch) => ipcRenderer.invoke(FILTER_IPC.setOptions, patch),
    openFolder: () => ipcRenderer.invoke(FILTER_IPC.openFolder)
  },
  update: {
    get: () => ipcRenderer.invoke(UPDATE_IPC.get),
    onChange: (listener) => {
      const handler = (_event: IpcRendererEvent, state: UpdateState): void => listener(state)
      ipcRenderer.on(UPDATE_IPC.state, handler)
      return () => {
        ipcRenderer.removeListener(UPDATE_IPC.state, handler)
      }
    },
    check: () => ipcRenderer.invoke(UPDATE_IPC.check),
    install: () => ipcRenderer.invoke(UPDATE_IPC.install),
    dismissWhatsNew: () => ipcRenderer.invoke(UPDATE_IPC.dismissWhatsNew)
  }
}

contextBridge.exposeInMainWorld('poe', api)
