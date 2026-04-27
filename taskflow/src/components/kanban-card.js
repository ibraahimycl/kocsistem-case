"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDndMonitor } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";

const ACCENT_OPTIONS = ["red", "blue", "green", "pink", "orange"];

const ACCENT_HEX = {
  red: "#ef4444",
  blue: "#3b82f6",
  green: "#22c55e",
  pink: "#ec4899",
  orange: "#f97316",
};

function normalizeAccent(value) {
  const v = String(value ?? "blue").toLowerCase();
  return ACCENT_HEX[v] ? v : "blue";
}

export function KanbanCard({
  card,
  density = "detailed",
  onOpen,
  canDrag = true,
  onAccentChange,
  isDragOverlay = false,
}) {
  const accent = normalizeAccent(card.accentColor);
  const accentFill = ACCENT_HEX[accent];

  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef(null);
  const stripTapRef = useRef(null);
  const ignoreStripTapRef = useRef(false);

  useDndMonitor(
    useMemo(
      () => ({
        onDragStart({ active }) {
          if (active?.id === card.id) {
            setPickerOpen(false);
          }
        },
        onDragEnd({ active }) {
          if (active?.id === card.id) {
            ignoreStripTapRef.current = true;
          }
        },
      }),
      [card.id]
    )
  );

  useEffect(() => {
    if (!pickerOpen) {
      return undefined;
    }
    function handlePointerDown(event) {
      const root = pickerRef.current;
      if (root && !root.contains(event.target)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [pickerOpen]);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: card.id,
    disabled: !canDrag || isDragOverlay,
    data: {
      type: "card",
      cardId: card.id,
      columnId: card.columnId,
    },
  });

  const stripListeners = useMemo(() => {
    if (!canDrag || isDragOverlay) {
      return {};
    }
    return {
      ...listeners,
      onPointerDown: (event) => {
        listeners.onPointerDown?.(event);
        stripTapRef.current = {
          x: event.clientX,
          y: event.clientY,
          t: Date.now(),
          pointerId: event.pointerId,
        };
      },
      onPointerUp: (event) => {
        listeners.onPointerUp?.(event);
        if (ignoreStripTapRef.current) {
          ignoreStripTapRef.current = false;
          stripTapRef.current = null;
          return;
        }
        const start = stripTapRef.current;
        stripTapRef.current = null;
        if (!start || event.pointerId !== start.pointerId) {
          return;
        }
        const dist = Math.hypot(event.clientX - start.x, event.clientY - start.y);
        if (dist < 12 && Date.now() - start.t < 650) {
          setPickerOpen((open) => !open);
        }
      },
    };
  }, [listeners, canDrag, isDragOverlay]);

  const handlePickAccent = useCallback(
    (next) => {
      const normalized = normalizeAccent(next);
      setPickerOpen(false);
      onAccentChange?.(card.id, normalized);
    },
    [card.id, onAccentChange]
  );

  const strip = (
    <div className="relative flex shrink-0 self-stretch">
      {canDrag && !isDragOverlay ? (
        <button
          type="button"
          title="Tap: color · hold & drag: move"
          aria-label="Card accent color and drag handle"
          className="min-h-[44px] w-4 shrink-0 touch-none rounded-lg border border-black/10 shadow-inner outline-none ring-offset-1 focus-visible:ring-2 focus-visible:ring-sky-400"
          style={{ backgroundColor: accentFill }}
          {...stripListeners}
        />
      ) : (
        <div
          className="min-h-[44px] w-4 shrink-0 rounded-lg border border-black/10 shadow-inner"
          style={{ backgroundColor: accentFill }}
          aria-hidden
        />
      )}
      {pickerOpen && canDrag && !isDragOverlay ? (
        <div
          ref={pickerRef}
          className="absolute left-full top-0 z-30 ml-2 flex gap-1.5 rounded-xl border border-slate-200 bg-white p-2 shadow-lg"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {ACCENT_OPTIONS.map((key) => (
            <button
              key={key}
              type="button"
              title={key}
              aria-label={`Set accent ${key}`}
              className={`h-9 w-9 rounded-full border-2 shadow-sm ${
                key === accent ? "border-slate-800 ring-2 ring-slate-300" : "border-white"
              }`}
              style={{ backgroundColor: ACCENT_HEX[key] }}
              onClick={() => handlePickAccent(key)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );

  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={[
        "flex gap-2 rounded-2xl border border-sky-200 bg-white p-3 shadow-sm",
        isDragging ? "opacity-40" : "opacity-100",
      ].join(" ")}
      {...attributes}
    >
      {strip}
      <div
        className="min-w-0 flex-1 select-none"
        style={{ WebkitTouchCallout: "none" }}
      >
        <h4 className="text-sm font-semibold tracking-tight text-stone-900">{card.title}</h4>
        {density === "detailed" ? (
          <p className="mt-2 text-xs leading-5 text-slate-600">{card.description || "-"}</p>
        ) : null}
        <div className="mt-3 flex items-center justify-between text-[11px] text-stone-500">
          <span>{card.dueDate ? `Due: ${new Date(card.dueDate).toLocaleDateString()}` : "Due: -"}</span>
          <button
            type="button"
            className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onOpen?.(card.id);
            }}
          >
            Details
          </button>
        </div>
      </div>
    </article>
  );
}
