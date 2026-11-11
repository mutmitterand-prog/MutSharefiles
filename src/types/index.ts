export interface Device {
  id: string;
  name: string;
  ip: string;
  createdAt: string;
  lastSeen: string;
}

export interface SharedFolder {
  id: string;
  label: string;
  path: string;
}

export interface DiskInfo {
  id: string;
  label: string;
  path: string;
  free: number | null;
  total: number | null;
}

export interface PairingInfo {
  url: string;
  ip: string;
  port: number;
  expiresAt: string;
  qrDataUrl: string;
}

export interface Overview {
  computerName: string;
  port: number;
  ips: string[];
  startedAt: string;
  serverStatus: 'running';
  devicesCount: number;
  pendingRequests: number;
  outboxCount: number;
  pairing: PairingInfo | null;
  disks: DiskInfo[];
}

export interface PairingRequest {
  id: string;
  deviceName: string;
  ip: string;
  createdAt: string;
}

export type TransferDirection = 'android_to_pc' | 'pc_to_android';
export type TransferStatus = 'completed' | 'failed' | 'cancelled';

export interface HistoryEntry {
  id: string;
  direction: TransferDirection;
  fileName: string;
  size: number;
  deviceName: string;
  status: TransferStatus;
  error: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
}

export interface FolderEntry {
  name: string;
  type: 'folder' | 'file';
  size: number | null;
  modifiedAt: string;
  path: string;
}

export interface FolderListing {
  root: { id: string; label: string };
  path: string;
  truncated: boolean;
  entries: FolderEntry[];
}

export interface OutboxItem {
  id: string;
  name: string;
  size: number;
  sha256: string;
  createdAt: string;
}

export interface Settings {
  computerName: string;
  port: number;
  sharedFolders: SharedFolder[];
}

export interface DeviceInfo {
  id: string;
  name: string;
  kind: string;
}

