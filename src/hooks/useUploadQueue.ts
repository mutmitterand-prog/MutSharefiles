import { useCallback, useRef, useState } from 'react';
import { ApiError } from '@/services/api';
import { createControl, uploadFile, type UploadControl } from '@/services/uploader';

const MAX_PARALLEL = 2;

export type UploadPolicy = 'ask' | 'rename' | 'overwrite';
export type QueueStatus = 'waiting' | 'preparing' | 'uploading' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'duplicate';

export interface QueueItem {
  key: string;
  file: File;
  status: QueueStatus;
  sent: number;
  speed: number;
  error: string | null;
  policy: UploadPolicy;
  resultName: string | null;
  control: UploadControl;
}

interface QueueConfig {
  basePath: string;
  token?: string | null;
  meta: { rootId?: string; folder?: string };
  onCompleted?: () => void;
}

export function useUploadQueue(config: QueueConfig) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const pending = useRef<QueueItem[]>([]);
  const activeCount = useRef(0);
  const configRef = useRef(config);
  configRef.current = config;

  const patch = useCallback((key: string, changes: Partial<QueueItem>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...changes } : item)));
  }, []);

  const runItem = async (item: QueueItem) => {
    const { basePath, token, meta } = configRef.current;
    patch(item.key, { status: 'preparing', error: null, sent: 0, speed: 0 });
    try {
      const result = await uploadFile(item.file, {
        basePath,
        token,
        meta: { ...meta, policy: item.policy },
        control: item.control,
        onPreparing: () => patch(item.key, { status: 'preparing' }),
        onProgress: ({ sent, speedBytesPerSec }) => patch(item.key, { status: 'uploading', sent, speed: speedBytesPerSec }),
        onResumed: () => patch(item.key, { status: 'paused' }),
      });
      if (result === 'cancelled') {
        patch(item.key, { status: 'cancelled' });
      } else {
        patch(item.key, { status: 'completed', sent: item.file.size, speed: 0, resultName: result.fileName });
        configRef.current.onCompleted?.();
      }
    } catch (error) {
      if (item.control.cancelled) {
        patch(item.key, { status: 'cancelled' });
      } else if (error instanceof ApiError && error.code === 'DUPLICATE') {
        patch(item.key, { status: 'duplicate', error: 'Un fichier portant ce nom existe déjà à cet emplacement.' });
      } else {
        patch(item.key, { status: 'failed', error: error instanceof Error ? error.message : 'Échec du transfert.' });
      }
    }
  };

  // Jusqu'à MAX_PARALLEL fichiers sont envoyés en même temps ; les autres attendent leur tour.
  const drain = () => {
    while (activeCount.current < MAX_PARALLEL && pending.current.length > 0) {
      const next = pending.current.shift();
      if (!next || next.control.cancelled) continue;
      activeCount.current += 1;
      void runItem(next).finally(() => {
        activeCount.current -= 1;
        drain();
      });
    }
  };

  const enqueue = (files: File[], policy: UploadPolicy = 'ask') => {
    const created = files.map<QueueItem>((file) => ({
      key: `${file.name}-${file.size}-${crypto.randomUUID()}`,
      file,
      status: 'waiting',
      sent: 0,
      speed: 0,
      error: null,
      policy,
      resultName: null,
      control: createControl(),
    }));
    pending.current.push(...created);
    setItems((current) => [...current, ...created]);
    drain();
  };

  const pause = (key: string) => {
    const item = items.find((entry) => entry.key === key);
    if (!item) return;
    item.control.paused = true;
    patch(key, { status: 'paused', speed: 0 });
  };

  const resume = (key: string) => {
    const item = items.find((entry) => entry.key === key);
    if (!item) return;
    item.control.paused = false;
    patch(key, { status: 'uploading' });
  };

  const cancel = (key: string) => {
    const item = items.find((entry) => entry.key === key);
    if (!item) return;
    item.control.cancelled = true;
    item.control.abort.abort();
    if (item.status === 'waiting' || item.status === 'duplicate') {
      patch(key, { status: 'cancelled' });
    }
  };

  const resolveDuplicate = (key: string, policy: Exclude<UploadPolicy, 'ask'>) => {
    const item = items.find((entry) => entry.key === key);
    if (!item) return;
    const retry: QueueItem = { ...item, policy, status: 'waiting', error: null, control: createControl() };
    setItems((current) => current.map((entry) => (entry.key === key ? retry : entry)));
    pending.current.push(retry);
    drain();
  };

  // Réessayer après un échec (coupure Wi-Fi...) : le PC reprend le transfert à l'octet déjà reçu.
  const retry = (key: string) => {
    const item = items.find((entry) => entry.key === key);
    if (!item) return;
    const again: QueueItem = { ...item, status: 'waiting', error: null, speed: 0, control: createControl() };
    setItems((current) => current.map((entry) => (entry.key === key ? again : entry)));
    pending.current.push(again);
    drain();
  };

  const clearFinished = () => {
    setItems((current) => current.filter((item) => !['completed', 'failed', 'cancelled'].includes(item.status)));
  };

  return { items, enqueue, pause, resume, cancel, retry, resolveDuplicate, clearFinished };
}
