"use client";

import { useEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { KanbanCard } from "@/components/kanban-card";

export function KanbanColumn({
  column,
  density,
  canManageColumn,
  canManageCards,
  onAddCard,
  onOpenCard,
  onCardAccentChange,
  onRenameColumn,
  onDeleteColumn,
  renameActive,
}) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(column.name);
  const renameInputRef = useRef(null);

  useEffect(() => {
    setDraftName(column.name);
  }, [column.name]);

  useEffect(() => {
    if (renameActive) {
      setIsRenaming(true);
    }
  }, [renameActive]);

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  function submitRename() {
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === column.name) {
      setIsRenaming(false);
      setDraftName(column.name);
      return;
    }
    onRenameColumn?.(column.id, trimmed);
    setIsRenaming(false);
  }

  const { setNodeRef, isOver } = useDroppable({
    id: `column:${column.id}`,
    data: {
      type: "column",
      columnId: column.id,
    },
  });
  const {
    attributes,
    listeners,
    setNodeRef: setSortableNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `column-sort:${column.id}`,
    data: {
      type: "column-sort",
      columnId: column.id,
    },
    disabled: !canManageColumn,
  });

  return (
    <div
      ref={setSortableNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.75 : 1,
      }}
      className="min-w-72 max-w-72"
    >
      <section
        ref={setNodeRef}
        className={[
          "flex h-[75vh] min-w-72 max-w-72 flex-col rounded-3xl border border-slate-200 bg-slate-50/95 p-3",
          "shadow-[0_14px_30px_rgba(15,23,42,0.14)] backdrop-blur-sm",
          isOver ? "ring-2 ring-sky-500/70" : "",
        ].join(" ")}
      >
      <header className="mb-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          {isRenaming ? (
            <input
              ref={renameInputRef}
              className="w-full rounded-lg border border-sky-400 bg-white px-2 py-1 text-sm font-semibold text-slate-900 outline-none ring-2 ring-sky-200"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onBlur={submitRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  submitRename();
                }
                if (event.key === "Escape") {
                  setDraftName(column.name);
                  setIsRenaming(false);
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="w-full rounded-md px-1 py-1 text-left text-sm font-semibold uppercase tracking-[0.12em] text-slate-800 hover:bg-slate-200/70"
              onDoubleClick={() => canManageColumn && setIsRenaming(true)}
              title={canManageColumn ? "Double-click to rename" : column.name}
            >
              {column.name}
            </button>
          )}
          <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
            {column.cards.length}
          </span>
        </div>
        {canManageColumn ? (
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600"
              title="Drag column"
              {...attributes}
              {...listeners}
            >
              Drag
            </button>
            <button
              type="button"
              className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700 hover:bg-sky-100"
              onClick={() => setIsRenaming(true)}
            >
              Rename
            </button>
            <button
              type="button"
              className="rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-[11px] font-semibold text-orange-700 hover:bg-orange-100"
              onClick={() => onDeleteColumn?.(column)}
            >
              Delete
            </button>
          </div>
        ) : null}
      </header>

      <SortableContext
        items={column.cards.map((card) => card.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto pr-1">
          {column.cards.map((card) => (
            <KanbanCard
              key={card.id}
              card={card}
              density={density}
              canDrag={canManageCards}
              onOpen={onOpenCard}
              onAccentChange={onCardAccentChange}
            />
          ))}
        </div>
      </SortableContext>

      <button
        type="button"
        className="mt-3 rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100"
        onClick={() => onAddCard(column.id)}
        disabled={!canManageCards}
      >
        + Add Card
      </button>
      </section>
    </div>
  );
}
