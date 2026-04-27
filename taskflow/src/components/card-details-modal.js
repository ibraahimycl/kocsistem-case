"use client";

import { useMemo } from "react";

function formatDateLabel(value) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return parsed.toLocaleString();
}

export function CardDetailsModal({
  open,
  loading,
  mode,
  draft,
  setDraft,
  createCardChecklist,
  createChecklistInput,
  setCreateChecklistInput,
  selectedCard,
  selectedCardDraft,
  setSelectedCardDraft,
  selectedCardChecklist,
  checklistInput,
  setChecklistInput,
  saving,
  onClose,
  onCreateCard,
  onAddCreateChecklist,
  onPatchCreateChecklist,
  onDeleteCreateChecklist,
  onSaveCard,
  onAddChecklist,
  onPatchChecklist,
  onDeleteChecklist,
}) {
  const isCreateMode = mode === "create";
  const checklistItems = isCreateMode ? createCardChecklist : selectedCardChecklist;

  const checklistProgress = useMemo(() => {
    if (!checklistItems || checklistItems.length === 0) {
      return "0/0";
    }

    const done = checklistItems.filter((item) => item.isDone).length;
    return `${done}/${checklistItems.length}`;
  }, [checklistItems]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-slate-700/40 bg-slate-900/95 p-5 text-slate-100 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-white">
              {isCreateMode ? "New Card" : "Card Details"}
            </h3>
            {!isCreateMode ? (
              <p className="mt-1 text-xs text-slate-300">
                Start: {formatDateLabel(selectedCard?.startDate)} • Due: {formatDateLabel(selectedCard?.dueDate)}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="rounded-lg border border-slate-500 bg-slate-800 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-700"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {loading ? (
          <div className="space-y-3 rounded-2xl border border-slate-700 bg-slate-800/60 p-4">
            <div className="h-6 w-1/3 animate-pulse rounded bg-slate-700" />
            <div className="h-12 w-full animate-pulse rounded bg-slate-700" />
            <div className="h-24 w-full animate-pulse rounded bg-slate-700" />
            <div className="h-10 w-full animate-pulse rounded bg-slate-700" />
          </div>
        ) : null}

        {!loading && isCreateMode ? (
          <div className="space-y-4">
            <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">
              Title
              <input
                className="mt-1 w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
                value={draft.title}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, title: event.target.value }))
                }
                placeholder="Example: Update sprint plan"
              />
            </label>

            <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">
              Description
              <textarea
                className="mt-1 min-h-24 w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
                value={draft.description}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, description: event.target.value }))
                }
                placeholder="Write card details"
              />
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">
                Start Date
                <input
                  type="datetime-local"
                  className="mt-1 w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
                  value={draft.startDate}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, startDate: event.target.value }))
                  }
                />
              </label>
              <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">
                Due Date
                <input
                  type="datetime-local"
                  className="mt-1 w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
                  value={draft.dueDate}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, dueDate: event.target.value }))
                  }
                />
              </label>
            </div>

            <button
              type="button"
              className="w-full rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500"
              onClick={onCreateCard}
              disabled={saving}
            >
              {saving ? "Saving..." : "Create Card"}
            </button>

            <div className="rounded-2xl border border-slate-700 bg-slate-800/40 p-3">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-100">Checklist</h4>
                <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-100">
                  {checklistProgress}
                </span>
              </div>

              <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <input
                  className="rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
                  placeholder="Checklist item title"
                  value={createChecklistInput.title}
                  onChange={(event) =>
                    setCreateChecklistInput((prev) => ({ ...prev, title: event.target.value }))
                  }
                />
                <input
                  className="rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
                  placeholder="Checklist item description"
                  value={createChecklistInput.description}
                  onChange={(event) =>
                    setCreateChecklistInput((prev) => ({
                      ...prev,
                      description: event.target.value,
                    }))
                  }
                />
                <button
                  type="button"
                  className="rounded-xl border border-teal-500 bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-500"
                  onClick={onAddCreateChecklist}
                >
                  Add
                </button>
              </div>

              <div className="space-y-2">
                {(createCardChecklist ?? []).map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-600 bg-slate-800/80 p-2">
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        <input
                          className="w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-sm"
                          value={item.title}
                          onChange={(event) =>
                            onPatchCreateChecklist(item.id, { title: event.target.value })
                          }
                        />
                        <textarea
                          className="mt-1 min-h-16 w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-xs"
                          value={item.description || ""}
                          onChange={(event) =>
                            onPatchCreateChecklist(item.id, { description: event.target.value })
                          }
                        />
                      </div>
                      <button
                        type="button"
                        className="rounded-md border border-orange-300 bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-900 hover:bg-orange-200"
                        onClick={() => onDeleteCreateChecklist(item.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {!loading && !isCreateMode ? (
          <div className="space-y-4">
            <div className="space-y-3 rounded-2xl border border-slate-700 bg-slate-800/70 p-3">
              <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">
                Title
                <input
                  className="mt-1 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
                  value={selectedCardDraft.title}
                  onChange={(event) =>
                    setSelectedCardDraft((prev) => ({ ...prev, title: event.target.value }))
                  }
                />
              </label>

              <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">
                Description
                <textarea
                  className="mt-1 min-h-24 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
                  value={selectedCardDraft.description}
                  onChange={(event) =>
                    setSelectedCardDraft((prev) => ({ ...prev, description: event.target.value }))
                  }
                />
              </label>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">
                  Start Date
                  <input
                    type="datetime-local"
                    className="mt-1 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
                    value={selectedCardDraft.startDate}
                    onChange={(event) =>
                      setSelectedCardDraft((prev) => ({ ...prev, startDate: event.target.value }))
                    }
                  />
                </label>
                <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">
                  Due Date
                  <input
                    type="datetime-local"
                    className="mt-1 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
                    value={selectedCardDraft.dueDate}
                    onChange={(event) =>
                      setSelectedCardDraft((prev) => ({ ...prev, dueDate: event.target.value }))
                    }
                  />
                </label>
              </div>

              <button
                type="button"
                className="w-full rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500"
                onClick={() => onSaveCard(selectedCardDraft)}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Card"}
              </button>
            </div>

            <div className="rounded-2xl border border-slate-700 bg-slate-800/40 p-3">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-100">Checklist</h4>
                <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-100">
                  {checklistProgress}
                </span>
              </div>

              <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <input
                  className="rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
                  placeholder="Checklist item title"
                  value={checklistInput.title}
                  onChange={(event) =>
                    setChecklistInput((prev) => ({ ...prev, title: event.target.value }))
                  }
                />
                <input
                  className="rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
                  placeholder="Checklist item description"
                  value={checklistInput.description}
                  onChange={(event) =>
                    setChecklistInput((prev) => ({ ...prev, description: event.target.value }))
                  }
                />
                <button
                  type="button"
                  className="rounded-xl border border-teal-500 bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-500"
                  onClick={onAddChecklist}
                >
                  Add
                </button>
              </div>

              <div className="space-y-2">
                {(selectedCardChecklist ?? []).map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-600 bg-slate-800/80 p-2">
                    <div className="flex items-start gap-2">
                      <input
                        className="mt-1"
                        type="checkbox"
                        checked={item.isDone}
                        onChange={(event) =>
                          onPatchChecklist(item.id, {
                            isDone: event.target.checked,
                          })
                        }
                      />
                      <div className="flex-1">
                        <input
                          className="w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-sm"
                          value={item.title}
                          onChange={(event) =>
                            onPatchChecklist(item.id, { title: event.target.value }, true)
                          }
                          onBlur={(event) =>
                            onPatchChecklist(item.id, { title: event.target.value })
                          }
                        />
                        <textarea
                          className="mt-1 min-h-16 w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-xs"
                          value={item.description || ""}
                          onChange={(event) =>
                            onPatchChecklist(item.id, { description: event.target.value }, true)
                          }
                          onBlur={(event) =>
                            onPatchChecklist(item.id, { description: event.target.value })
                          }
                        />
                      </div>
                      <button
                        type="button"
                        className="rounded-md border border-orange-300 bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-900 hover:bg-orange-200"
                        onClick={() => onDeleteChecklist(item.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
