import { create } from "zustand";
import type {
  Transcription,
  AiSession,
  UserSettings,
  TransformRecord,
  DictionaryEntry,
} from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { DEFAULT_DICTIONARY_ENTRIES } from "./dictionary";

interface FlunkeyState {
  /* ── user + settings ──────────────────────────────── */
  settings: UserSettings;
  setSettings: (patch: Partial<UserSettings>) => void;
  resetSettings: () => void;

  /* ── data ──────────────────────────────────────────── */
  transcriptions: Transcription[];
  addTranscription: (t: Transcription) => void;
  /** Remove one dictation entry. */
  deleteTranscription: (id: string) => void;
  clearTranscriptions: () => void;

  aiSessions: AiSession[];
  addAiSession: (s: AiSession) => void;
  updateAiSession: (id: string, patch: Partial<AiSession>) => void;
  /** Remove one saved chat. */
  deleteAiSession: (id: string) => void;
  clearAiSessions: () => void;

  transforms: TransformRecord[];
  addTransform: (t: TransformRecord) => void;
  /** Remove one transform record. */
  deleteTransform: (id: string) => void;
  clearTransforms: () => void;

  dictionary: DictionaryEntry[];
  addDictionaryEntry: (entry: DictionaryEntry) => void;
  updateDictionaryEntry: (id: string, patch: Partial<DictionaryEntry>) => void;
  deleteDictionaryEntry: (id: string) => void;
  toggleDictionaryEntry: (id: string) => void;
  setDictionary: (list: DictionaryEntry[]) => void;
  clearDictionary: () => void;

  /** Active multi-turn F9 session id (continuous chat). */
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;
  /** After "New chat", skip auto-resuming the previous session once. */
  f9SkipResume: boolean;
  setF9SkipResume: (v: boolean) => void;

  /* ── runtime UI state ─────────────────────────────── */
  isRecording: boolean;
  setRecording: (v: boolean) => void;
  /**
   * Set when a write to disk failed, so the UI can say so.
   *
   * Save errors used to go to `console.error` only, which a packaged app never
   * shows: a full disk meant dictation history disappeared with no visible
   * sign. Empty means everything is saving normally.
   */
  storageError: string | null;
  setStorageError: (what: string | null) => void;
  activeMode: "f8" | "f9" | "transform" | null;
  setActiveMode: (m: "f8" | "f9" | "transform" | null) => void;
  currentPage: string;
  setCurrentPage: (p: string) => void;
}

export const useStore = create<FlunkeyState>((set) => ({
  settings: { ...DEFAULT_SETTINGS },
  setSettings: (patch) =>
    set((s) => ({ settings: { ...s.settings, ...patch } })),
  resetSettings: () => set({ settings: { ...DEFAULT_SETTINGS } }),

  transcriptions: [],
  addTranscription: (t) =>
    set((s) => ({ transcriptions: [t, ...s.transcriptions] })),
  deleteTranscription: (id) =>
    set((s) => ({
      transcriptions: s.transcriptions.filter((t) => t.id !== id),
    })),
  clearTranscriptions: () => set({ transcriptions: [] }),

  aiSessions: [],
  addAiSession: (s) =>
    set((st) => ({ aiSessions: [s, ...st.aiSessions] })),
  updateAiSession: (id, patch) =>
    set((st) => {
      const merged = st.aiSessions.map((session) =>
        session.id === id ? { ...session, ...patch } : session
      );
      const updated = merged.find((s) => s.id === id);
      if (!updated) return { aiSessions: merged };
      return {
        aiSessions: [updated, ...merged.filter((s) => s.id !== id)],
      };
    }),
  deleteAiSession: (id) =>
    set((st) => ({
      aiSessions: st.aiSessions.filter((s) => s.id !== id),
      // Dropping the live chat would leave the overlay bound to nothing.
      activeChatId: st.activeChatId === id ? null : st.activeChatId,
    })),
  clearAiSessions: () => set({ aiSessions: [], activeChatId: null }),

  transforms: [],
  addTransform: (t) =>
    set((st) => ({ transforms: [t, ...st.transforms] })),
  deleteTransform: (id) =>
    set((st) => ({ transforms: st.transforms.filter((t) => t.id !== id) })),
  clearTransforms: () => set({ transforms: [] }),

  dictionary: [...DEFAULT_DICTIONARY_ENTRIES],
  addDictionaryEntry: (entry) =>
    set((st) => ({ dictionary: [entry, ...st.dictionary] })),
  updateDictionaryEntry: (id, patch) =>
    set((st) => ({
      dictionary: st.dictionary.map((e) =>
        e.id === id ? { ...e, ...patch, updatedAt: Date.now() } : e
      ),
    })),
  deleteDictionaryEntry: (id) =>
    set((st) => ({ dictionary: st.dictionary.filter((e) => e.id !== id) })),
  toggleDictionaryEntry: (id) =>
    set((st) => ({
      dictionary: st.dictionary.map((e) =>
        e.id === id
          ? { ...e, enabled: !e.enabled, updatedAt: Date.now() }
          : e
      ),
    })),
  setDictionary: (list) => set({ dictionary: list }),
  clearDictionary: () => set({ dictionary: [] }),

  activeChatId: null,
  setActiveChatId: (id) => set({ activeChatId: id }),
  f9SkipResume: false,
  setF9SkipResume: (v) => set({ f9SkipResume: v }),

  isRecording: false,
  setRecording: (v) => set({ isRecording: v }),
  storageError: null,
  setStorageError: (what) => set({ storageError: what }),
  activeMode: null,
  setActiveMode: (m) => set({ activeMode: m }),
  currentPage: "dashboard",
  setCurrentPage: (p) => set({ currentPage: p }),
}));
