import { contextBridge, ipcRenderer } from 'electron';
import type { WindowApi } from './types';

const api: WindowApi = {
  programs: {
    getAll: () => ipcRenderer.invoke('programs:getAll'),
    getById: (id) => ipcRenderer.invoke('programs:getById', id),
    getTiers: (programId) => ipcRenderer.invoke('programs:getTiers', programId),
    createRuleVersion: (programId, effective_date, source_notes, tiers) =>
      ipcRenderer.invoke('programs:createRuleVersion', programId, effective_date, source_notes, tiers),
    lastActivity: () => ipcRenderer.invoke('programs:lastActivity'),
  },
  trips: {
    getAll: () => ipcRenderer.invoke('trips:getAll'),
    getById: (id) => ipcRenderer.invoke('trips:getById', id),
    create: (data) => ipcRenderer.invoke('trips:create', data),
    update: (id, data) => ipcRenderer.invoke('trips:update', id, data),
    delete: (id) => ipcRenderer.invoke('trips:delete', id),
  },
  projection: {
    all: () => ipcRenderer.invoke('projection:all'),
  },
  adjustments: {
    all: () => ipcRenderer.invoke('adjustments:all'),
  },
  lifetime: {
    status: () => ipcRenderer.invoke('lifetime:status'),
    setStatus: (data) => ipcRenderer.invoke('lifetime:setStatus', data),
    clearStatus: (programId) => ipcRenderer.invoke('lifetime:clearStatus', programId),
    mileage: () => ipcRenderer.invoke('lifetime:mileage'),
  },
  cardEarnings: {
    getAll: () => ipcRenderer.invoke('cardEarnings:getAll'),
    create: (data) => ipcRenderer.invoke('cardEarnings:create', data),
    update: (id, data) => ipcRenderer.invoke('cardEarnings:update', id, data),
    delete: (id) => ipcRenderer.invoke('cardEarnings:delete', id),
  },
  airports: {
    distance: (a, b) => ipcRenderer.invoke('airports:distance', a, b),
    lookup: (code) => ipcRenderer.invoke('airports:lookup', code),
  },
  refresh: {
    status: () => ipcRenderer.invoke('refresh:status'),
    log: (reviewed, updated) => ipcRenderer.invoke('refresh:log', reviewed, updated),
  },
  file: {
    exportJson: () => ipcRenderer.invoke('file:exportJson'),
    importJson: () => ipcRenderer.invoke('file:importJson'),
    newDb: () => ipcRenderer.invoke('file:newDb'),
    openDb: () => ipcRenderer.invoke('file:openDb'),
    saveAs: () => ipcRenderer.invoke('file:saveAs'),
    currentPath: () => ipcRenderer.invoke('file:currentPath'),
  },
};

contextBridge.exposeInMainWorld('api', api);
