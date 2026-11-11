import { create } from 'zustand';
import { setSoundEnabled } from './sound';

export interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'err' | 'info';
  link?: { href: string; label: string };
}

const SOUND_KEY = 'sl0t:sound';
const readSound = () => {
  try {
    return localStorage.getItem(SOUND_KEY) === 'on';
  } catch {
    return false;
  }
};

interface State {
  toasts: Toast[];
  toast: (text: string, kind?: Toast['kind'], link?: Toast['link']) => void;
  dismiss: (id: number) => void;
  sound: boolean;
  toggleSound: () => void;
  introOpen: boolean;
  setIntroOpen: (v: boolean) => void;
  /** bump to make data hooks refetch now */
  refreshKey: number;
  refresh: () => void;
}

let nextId = 1;
const initialSound = readSound();
setSoundEnabled(initialSound);

export const useStore = create<State>((set, get) => ({
  toasts: [],
  toast: (text, kind = 'info', link) => {
    const id = nextId++;
    set({ toasts: [...get().toasts.slice(-3), { id, text, kind, link }] });
    setTimeout(() => get().dismiss(id), kind === 'err' ? 7000 : 4500);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  sound: initialSound,
  toggleSound: () => {
    const sound = !get().sound;
    setSoundEnabled(sound);
    try {
      localStorage.setItem(SOUND_KEY, sound ? 'on' : 'off');
    } catch {
      /* ignore */
    }
    set({ sound });
  },
  introOpen: false,
  setIntroOpen: (introOpen) => set({ introOpen }),
  refreshKey: 0,
  refresh: () => set({ refreshKey: get().refreshKey + 1 }),
}));

export const toast = (text: string, kind?: Toast['kind'], link?: Toast['link']) => useStore.getState().toast(text, kind, link);
