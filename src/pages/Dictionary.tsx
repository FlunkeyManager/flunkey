import { useState, useMemo, useRef } from "react";
import { useStore } from "../store";
import { saveDictionary } from "../persistence";
import {
  exportDictionaryAsJson,
  importDictionaryFromJson,
  normalizeDictionaryList,
} from "../dictionary";
import { countCorrections, findCorrectionOwner } from "../dictionaryCorrections";
import type { DictionaryEntry } from "../types";
import { smartSearch } from "../smartSearch";
import { SearchBar, useDebouncedValue } from "../components/SearchBar";

export function Dictionary() {
  const dictionary = useStore((s) => s.dictionary);
  const addDictionaryEntry = useStore((s) => s.addDictionaryEntry);
  const updateDictionaryEntry = useStore((s) => s.updateDictionaryEntry);
  const deleteDictionaryEntry = useStore((s) => s.deleteDictionaryEntry);
  const toggleDictionaryEntry = useStore((s) => s.toggleDictionaryEntry);
  const setDictionary = useStore((s) => s.setDictionary);

  const [search, setSearch] = useState("");

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<DictionaryEntry | null>(null);
  const [formWord, setFormWord] = useState("");
  /** Known misspellings that must become `formWord`. */
  const [formCorrections, setFormCorrections] = useState<string[]>([]);
  const [formCorrectionDraft, setFormCorrectionDraft] = useState("");

  // Toast / Export menu
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Filtered dictionary list (same smart search as history pages).
  const { debounced, pending } = useDebouncedValue(search);
  const filteredEntries = useMemo(() => {
    return smartSearch(
      dictionary,
      debounced,
      (entry) => [{ text: entry.word, weight: 1 }],
      (entry) => entry.updatedAt
    );
  }, [dictionary, debounced]);

  const activeCount = useMemo(
    () => dictionary.filter((e) => e.enabled).length,
    [dictionary]
  );

  const correctionCount = useMemo(
    () => countCorrections(dictionary),
    [dictionary]
  );

  const handleOpenAdd = (seedWord?: string) => {
    setEditingEntry(null);
    setFormWord(seedWord ?? "");
    setFormCorrections([]);
    setFormCorrectionDraft("");
    setIsModalOpen(true);
  };

  const handleOpenEdit = (entry: DictionaryEntry) => {
    setEditingEntry(entry);
    setFormWord(entry.word);
    setFormCorrections(entry.corrections ?? []);
    setFormCorrectionDraft("");
    setIsModalOpen(true);
  };

  const commitCorrectionDraft = () => {
    const value = formCorrectionDraft.trim();
    if (!value) return;
    if (value.toLowerCase() === formWord.trim().toLowerCase()) {
      showToast(`"${value}" is the same as the correct spelling`);
      setFormCorrectionDraft("");
      return;
    }
    const owner = findCorrectionOwner(dictionary, value, editingEntry?.id);
    if (owner) {
      // Silently stealing another entry's rule would make one of them stop
      // firing, which is exactly the unpredictability this feature is for.
      showToast(`"${value}" already corrects to "${owner.word}"`);
      setFormCorrectionDraft("");
      return;
    }
    if (!formCorrections.some((c) => c.toLowerCase() === value.toLowerCase())) {
      setFormCorrections((prev) => [...prev, value]);
    }
    setFormCorrectionDraft("");
  };

  const handleSaveEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    const word = formWord.trim();
    if (!word) return;
    // A half-typed misspelling is still in the draft box.
    if (formCorrectionDraft.trim()) commitCorrectionDraft();

    // No duplicates (case-insensitive), excluding the entry being edited
    const clash = dictionary.some(
      (item) =>
        item.word.toLowerCase() === word.toLowerCase() &&
        item.id !== editingEntry?.id
    );
    if (clash) {
      showToast(`"${word}" is already in your dictionary`);
      return;
    }

    const now = Date.now();
    // Trim blanks, drop duplicates, and never store a correction identical to
    // the target: it could never fire.
    const corrections = Array.from(
      new Set(
        formCorrections
          .map((c) => c.trim())
          .filter((c) => c.length > 0 && c.toLowerCase() !== word.toLowerCase()),
      ),
    );

    if (editingEntry) {
      updateDictionaryEntry(editingEntry.id, { word, corrections });
      const updated = dictionary.map((item) =>
        item.id === editingEntry.id ? { ...item, word, corrections, updatedAt: now } : item
      );
      await saveDictionary(updated);
      showToast(
        corrections.length
          ? `Updated "${word}" and ${corrections.length} correction${corrections.length === 1 ? "" : "s"}`
          : `Updated "${word}"`,
      );
    } else {
      const newEntry: DictionaryEntry = {
        id: crypto.randomUUID(),
        word,
        enabled: true,
        createdAt: now,
        updatedAt: now,
        ...(corrections.length > 0 ? { corrections } : {}),
      };
      addDictionaryEntry(newEntry);
      const updated = [newEntry, ...dictionary];
      await saveDictionary(updated);
      showToast(
        corrections.length
          ? `Added "${word}" with ${corrections.length} correction${corrections.length === 1 ? "" : "s"}`
          : `Added "${word}" to dictionary`,
      );
    }

    setIsModalOpen(false);
  };

  const handleToggleEntry = async (id: string) => {
    toggleDictionaryEntry(id);
    const updated = dictionary.map((item) =>
      item.id === id ? { ...item, enabled: !item.enabled, updatedAt: Date.now() } : item
    );
    await saveDictionary(updated);
  };

  const handleDeleteEntry = async (id: string, word: string) => {
    deleteDictionaryEntry(id);
    const updated = dictionary.filter((item) => item.id !== id);
    await saveDictionary(updated);
    showToast(`Removed "${word}"`);
  };

  const handleExport = () => {
    const content = exportDictionaryAsJson(dictionary);
    const filename = `flunkey-dictionary-${new Date().toISOString().slice(0, 10)}.json`;
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const { valid, count } = importDictionaryFromJson(text);
      if (count > 0) {
        // Merge without duplicating existing words
        const existingWords = new Set(dictionary.map((d) => d.word.toLowerCase()));
        const toAdd = valid.filter((v) => !existingWords.has(v.word.toLowerCase()));
        const merged = normalizeDictionaryList([...toAdd, ...dictionary]);
        setDictionary(merged);
        await saveDictionary(merged);
        showToast(
          toAdd.length > 0
            ? `Imported ${toAdd.length} ${toAdd.length === 1 ? "word" : "words"}`
            : "All imported words already exist"
        );
      } else {
        showToast("No valid dictionary words found in file");
      }
    } catch {
      showToast("Failed to parse dictionary file");
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
    setShowExportMenu(false);
  };

  return (
    <div className="page" onClick={() => setShowExportMenu(false)}>
      {/* Page Header — clean, not overloaded */}
      <div className="pageHeader">
        <div>
          <div className="pageTitle">Dictionary</div>
          <div className="pageSubtitle">
            Teach Flunkey your names, jargon and spellings — works the same for F8 and F10
          </div>
        </div>
      </div>
      {toastMessage && (
        <div className="dict-toast-banner">
          <span>✨ {toastMessage}</span>
        </div>
      )}

      {/* Stats and Top Actions Bar */}
      <div className="memory-top-bar">
        <div className="memory-stats-group">
          <div className="stat-pill">
            <span className="stat-pill-num">{activeCount}</span>
            <span className="stat-pill-label">Active words</span>
          </div>
          <div className="stat-pill">
            <span className="stat-pill-num">{dictionary.length}</span>
            <span className="stat-pill-label">Total words</span>
          </div>
          <div className="stat-pill">
            <span className="stat-pill-num">{correctionCount}</span>
            <span className="stat-pill-label">Misspelling fixes</span>
          </div>
        </div>

        <div className="memory-actions-group">
          {/* Export / Import Menu */}
          <div className="memory-export-wrap" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="memory-action-btn"
              onClick={() => setShowExportMenu((prev) => !prev)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Manage
            </button>
            {showExportMenu && (
              <div className="memory-export-menu">
                <button type="button" onClick={handleExport}>
                  Export JSON (.json)
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Import JSON...
                </button>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              style={{ display: "none" }}
              onChange={handleImportFile}
            />
          </div>

          {/* Add Word Button */}
          <button
            type="button"
            className="memory-add-btn"
            onClick={() => handleOpenAdd()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Word
          </button>
        </div>
      </div>

      {/* Search (shared component: debounced + progress spinner) */}
      <div className="memory-filter-row">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Smart search words…"
          searching={pending}
        />
      </div>

      {/* Dictionary Entries List */}
      <div className="dict-list">
        {filteredEntries.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              {dictionary.length === 0 ? (
                <>
                  <div style={{ marginBottom: 6, fontWeight: 600 }}>Your dictionary is empty</div>
                  <div>
                    Click <strong>Add Word</strong> to teach Flunkey a name or term —
                    e.g. <span className="mono">Groq</span>, so "grok" or "grock" always come out right.
                  </div>
                </>
              ) : (
                <>No words match your search.</>
              )}
            </div>
          </div>
        ) : (
          filteredEntries.map((item) => (
            <div
              key={item.id}
              className={`dict-card ${!item.enabled ? "dict-card--disabled" : ""}`}
            >
              <div className="dict-card-main">
                <div className="dict-card-top">
                  <span className="dict-word">{item.word}</span>
                </div>
                <div className="dict-replacement-row">
                  <span className="dict-replace-hint">Recognized in dictation & transforms</span>
                  {(item.corrections ?? []).length > 0 && (
                    <span
                      className="dict-replace-hint"
                      title={(item.corrections ?? []).join(", ")}
                    >
                      {" · "}
                      fixes {(item.corrections ?? []).join(", ")}
                    </span>
                  )}
                </div>
              </div>

              <div className="dict-card-actions">
                {/* Enable / Disable toggle */}
                <button
                  type="button"
                  className={`toggle small${item.enabled ? " on" : ""}`}
                  onClick={() => handleToggleEntry(item.id)}
                  title={item.enabled ? "Disable this word" : "Enable this word"}
                  aria-label="Toggle word active"
                >
                  <div className="toggle-handle" />
                </button>

                {/* Edit */}
                <button
                  type="button"
                  className="memory-card-btn"
                  onClick={() => handleOpenEdit(item)}
                  title="Edit word"
                >
                  Edit
                </button>

                {/* Delete */}
                <button
                  type="button"
                  className="memory-card-btn danger"
                  onClick={() => handleDeleteEntry(item.id, item.word)}
                  title="Delete word"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add / Edit Modal */}
      {isModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                {editingEntry ? "Edit Word" : "Add Custom Word"}
              </div>
              <button className="modal-close" onClick={() => setIsModalOpen(false)}>
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEntry} className="dict-modal-form">
              <div className="dict-modal-scroll">
                <div className="dict-modal-info">
                  Flunkey recognizes this word and its close variants in{" "}
                  <span className="mono">F8</span> dictation and{" "}
                  <span className="mono">F10</span> transforms.
                </div>

                <div className="dict-field-group">
                  <label className="form-label">Correct spelling <span className="dict-required">*</span></label>
                  <input
                    type="text"
                    className="dict-modal-input"
                    placeholder="Groq  •  Flunkey  •  PostgreSQL"
                    value={formWord}
                    onChange={(e) => setFormWord(e.target.value)}
                    required
                    autoFocus
                  />
                  <div className="dict-field-hint">Exact spelling and casing — e.g. <span className="mono">PostgreSQL</span> not <span className="mono">postgres</span></div>
                </div>

                <div className="dict-field-group">
                  <label className="form-label">
                    Fix this specific misspelling
                  </label>
                  <div className="dict-field-hint" style={{ marginBottom: 8 }}>
                    Optional. For errors that keep coming back and that close-match
                    matching will not reach — a model that always hears{" "}
                    <span className="mono">"get"</span> for{" "}
                    <span className="mono">Git</span>, for example.
                  </div>

                  {formCorrections.length > 0 && (
                    <div className="dict-correction-chips">
                      {formCorrections.map((c) => (
                        <span key={c} className="dict-correction-chip">
                          <span className="dict-correction-from">{c}</span>
                          <span className="dict-correction-arrow">→</span>
                          <span className="dict-correction-to">
                            {formWord.trim() || "…"}
                          </span>
                          <button
                            type="button"
                            className="dict-correction-remove"
                            aria-label={`Remove correction ${c}`}
                            title="Remove this correction"
                            onClick={() =>
                              setFormCorrections((prev) =>
                                prev.filter((x) => x !== c),
                              )
                            }
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="dict-correction-add">
                    <input
                      type="text"
                      className="dict-modal-input"
                      placeholder="What Flunkey wrongly hears"
                      value={formCorrectionDraft}
                      onChange={(e) => setFormCorrectionDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          // Enter adds a correction instead of saving, so a
                          // word does not get saved with a half-typed one.
                          e.preventDefault();
                          commitCorrectionDraft();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn-cancel"
                      onClick={commitCorrectionDraft}
                      disabled={!formCorrectionDraft.trim()}
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  {editingEntry ? "Save Changes" : "Add to Dictionary"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
