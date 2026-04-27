"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { createClient } from "@supabase/supabase-js";
import { KanbanCard } from "@/components/kanban-card";
import { KanbanColumn } from "@/components/kanban-column";
import { CardDetailsModal } from "@/components/card-details-modal";

async function api(url, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

function moveCardLocal(columns, cardId, toColumnId, beforeCardId = null) {
  let movingCard = null;
  const nextColumns = columns.map((column) => {
    const remaining = column.cards.filter((card) => {
      if (card.id === cardId) {
        movingCard = card;
        return false;
      }
      return true;
    });
    return { ...column, cards: remaining };
  });

  if (!movingCard) {
    return columns;
  }

  return nextColumns.map((column) => {
    if (column.id !== toColumnId) {
      return column;
    }

    const cards = [...column.cards];
    const insertAt = beforeCardId
      ? cards.findIndex((card) => card.id === beforeCardId)
      : cards.length;

    cards.splice(insertAt >= 0 ? insertAt : cards.length, 0, {
      ...movingCard,
      columnId: toColumnId,
    });

    return { ...column, cards };
  });
}

function findCardPosition(columns, cardId) {
  for (const column of columns) {
    const index = column.cards.findIndex((card) => card.id === cardId);
    if (index >= 0) {
      return {
        columnId: column.id,
        index,
        cards: column.cards,
      };
    }
  }
  return null;
}

function toIsoOrNull(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function mapCardRowFromDb(row) {
  if (!row?.id) {
    return null;
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    startDate: row.start_date,
    dueDate: row.due_date,
    orderIndex: row.order_index,
    columnId: row.column_id,
    accentColor: row.accent_color ?? "blue",
  };
}

function applyRealtimeCardPayload(cols, payload) {
  if (payload.eventType === "DELETE") {
    const id = payload.old?.id;
    if (!id) {
      return cols;
    }
    return cols.map((col) => ({
      ...col,
      cards: col.cards.filter((c) => c.id !== id),
    }));
  }
  if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
    const mapped = mapCardRowFromDb(payload.new);
    if (!mapped?.columnId) {
      return cols;
    }
    const without = cols.map((col) => ({
      ...col,
      cards: col.cards.filter((c) => c.id !== mapped.id),
    }));
    return without.map((col) => {
      if (col.id !== mapped.columnId) {
        return col;
      }
      const nextCards = [...col.cards, mapped].sort((a, b) => a.orderIndex - b.orderIndex);
      return { ...col, cards: nextCards };
    });
  }
  return cols;
}

function applyRealtimeColumnPayload(cols, payload) {
  if (payload.eventType === "DELETE") {
    const id = payload.old?.id;
    if (!id) {
      return cols;
    }
    return cols.filter((col) => col.id !== id);
  }
  if (payload.eventType === "INSERT") {
    const row = payload.new;
    if (!row?.id) {
      return cols;
    }
    const exists = cols.some((col) => col.id === row.id);
    if (exists) {
      return cols;
    }
    const newCol = {
      id: row.id,
      name: row.name ?? "Untitled",
      orderIndex: row.order_index ?? 0,
      cards: [],
    };
    return [...cols, newCol].sort((a, b) => a.orderIndex - b.orderIndex);
  }
  if (payload.eventType === "UPDATE") {
    const row = payload.new;
    if (!row?.id) {
      return cols;
    }
    const exists = cols.some((col) => col.id === row.id);
    if (!exists) {
      const newCol = {
        id: row.id,
        name: row.name ?? "Untitled",
        orderIndex: row.order_index ?? 0,
        cards: [],
      };
      return [...cols, newCol].sort((a, b) => a.orderIndex - b.orderIndex);
    }
    return cols
      .map((col) =>
        col.id === row.id
          ? { ...col, name: row.name ?? col.name, orderIndex: row.order_index ?? col.orderIndex }
          : col
      )
      .sort((a, b) => a.orderIndex - b.orderIndex);
  }
  return cols;
}

export default function Home() {
  const MOVE_DEBOUNCE_MS = 800;
  const MOVE_MAX_WAIT_MS = 3000;
  const PENDING_MOVES_STORAGE_KEY = "taskflow:pending-card-moves:v1";
  const COLUMN_MOVE_DEBOUNCE_MS = 800;
  const COLUMN_MOVE_MAX_WAIT_MS = 3000;
  const PENDING_COLUMN_MOVES_STORAGE_KEY = "taskflow:pending-column-moves:v1";
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [user, setUser] = useState(null);
  const [boards, setBoards] = useState([]);
  const [selectedBoardId, setSelectedBoardId] = useState("");
  const [boardMeta, setBoardMeta] = useState(null);
  const [columns, setColumns] = useState([]);
  const [activeCard, setActiveCard] = useState(null);
  const [density, setDensity] = useState("detailed");
  const [isBoardsDrawerOpen, setIsBoardsDrawerOpen] = useState(false);
  const [isRequestsPanelOpen, setIsRequestsPanelOpen] = useState(false);
  const [isMembersDrawerOpen, setIsMembersDrawerOpen] = useState(false);
  const [renamingColumnId, setRenamingColumnId] = useState("");
  const [boardMembers, setBoardMembers] = useState([]);
  const [cardModal, setCardModal] = useState({
    open: false,
    mode: "detail",
    columnId: "",
    cardId: "",
  });
  const [createCardDraft, setCreateCardDraft] = useState({
    title: "",
    description: "",
    startDate: "",
    dueDate: "",
  });
  const [selectedCard, setSelectedCard] = useState(null);
  const [selectedCardDraft, setSelectedCardDraft] = useState({
    title: "",
    description: "",
    startDate: "",
    dueDate: "",
  });
  const [createCardChecklist, setCreateCardChecklist] = useState([]);
  const [createChecklistInput, setCreateChecklistInput] = useState({
    title: "",
    description: "",
  });
  const [selectedCardChecklist, setSelectedCardChecklist] = useState([]);
  const [checklistInput, setChecklistInput] = useState({ title: "", description: "" });
  const [modalSaving, setModalSaving] = useState(false);
  const [cardModalLoading, setCardModalLoading] = useState(false);
  const boardLoadSeqRef = useRef(0);
  const latestAppliedBoardLoadSeqRef = useRef(0);
  const moveSeqRef = useRef(0);
  const lastBoardRevisionRef = useRef(0);
  const pendingMovesRef = useRef(new Map());
  const flushTimerRef = useRef(null);
  const maxWaitTimerRef = useRef(null);
  const isFlushingMovesRef = useRef(false);
  const pendingColumnMovesRef = useRef(new Map());
  const columnFlushTimerRef = useRef(null);
  const columnMaxWaitTimerRef = useRef(null);
  const isFlushingColumnMovesRef = useRef(false);

  function createMutationId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `mutation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function persistPendingMovesToStorage() {
    if (typeof window === "undefined") {
      return;
    }
    const values = Array.from(pendingMovesRef.current.values());
    if (values.length === 0) {
      window.localStorage.removeItem(PENDING_MOVES_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(PENDING_MOVES_STORAGE_KEY, JSON.stringify(values));
  }

  function hydratePendingMovesFromStorage() {
    if (typeof window === "undefined") {
      return;
    }
    const raw = window.localStorage.getItem(PENDING_MOVES_STORAGE_KEY);
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }
      for (const move of parsed) {
        if (!move?.cardId || !move?.boardId || !move?.toColumnId) {
          continue;
        }
        pendingMovesRef.current.set(move.cardId, move);
      }
    } catch {
      window.localStorage.removeItem(PENDING_MOVES_STORAGE_KEY);
    }
  }

  function persistPendingColumnMovesToStorage() {
    if (typeof window === "undefined") {
      return;
    }
    const values = Array.from(pendingColumnMovesRef.current.values());
    if (values.length === 0) {
      window.localStorage.removeItem(PENDING_COLUMN_MOVES_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(PENDING_COLUMN_MOVES_STORAGE_KEY, JSON.stringify(values));
  }

  function hydratePendingColumnMovesFromStorage() {
    if (typeof window === "undefined") {
      return;
    }
    const raw = window.localStorage.getItem(PENDING_COLUMN_MOVES_STORAGE_KEY);
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }
      for (const move of parsed) {
        if (!move?.columnId || !move?.boardId) {
          continue;
        }
        pendingColumnMovesRef.current.set(move.columnId, move);
      }
    } catch {
      window.localStorage.removeItem(PENDING_COLUMN_MOVES_STORAGE_KEY);
    }
  }

  async function flushPendingMoves(reason = "debounce") {
    if (isFlushingMovesRef.current) {
      return;
    }
    const pending = Array.from(pendingMovesRef.current.values());
    if (pending.length === 0) {
      return;
    }

    isFlushingMovesRef.current = true;
    pendingMovesRef.current.clear();
    persistPendingMovesToStorage();

    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (maxWaitTimerRef.current) {
      clearTimeout(maxWaitTimerRef.current);
      maxWaitTimerRef.current = null;
    }

    try {
      for (const move of pending) {
        const moveResponse = await api(`/api/boards/${move.boardId}/move-card`, {
          method: "POST",
          body: {
            cardId: move.cardId,
            toColumnId: move.toColumnId,
            beforeCardId: move.beforeCardId,
            mutationId: move.mutationId,
          },
        });
        const serverRevision = moveResponse.boardRevision ?? lastBoardRevisionRef.current;
        lastBoardRevisionRef.current = Math.max(lastBoardRevisionRef.current, serverRevision);
        setBoardMeta((prev) =>
          prev && prev.id === move.boardId ? { ...prev, revision: lastBoardRevisionRef.current } : prev
        );
      }
      console.debug("[moves-flush] success", { reason, count: pending.length });
    } catch (err) {
      console.debug("[moves-flush] failure", { reason, message: err.message });
      for (const move of pending) {
        pendingMovesRef.current.set(move.cardId, move);
      }
      persistPendingMovesToStorage();
      setError(err.message);
      if (selectedBoardId) {
        await loadBoard(selectedBoardId, "moves-flush-recovery");
      }
    } finally {
      isFlushingMovesRef.current = false;
    }
  }

  async function flushPendingColumnMoves(reason = "debounce") {
    if (isFlushingColumnMovesRef.current) {
      return;
    }
    const pending = Array.from(pendingColumnMovesRef.current.values());
    if (pending.length === 0) {
      return;
    }

    isFlushingColumnMovesRef.current = true;
    pendingColumnMovesRef.current.clear();
    persistPendingColumnMovesToStorage();

    if (columnFlushTimerRef.current) {
      clearTimeout(columnFlushTimerRef.current);
      columnFlushTimerRef.current = null;
    }
    if (columnMaxWaitTimerRef.current) {
      clearTimeout(columnMaxWaitTimerRef.current);
      columnMaxWaitTimerRef.current = null;
    }

    try {
      for (const move of pending) {
        await api(`/api/boards/${move.boardId}/move-column`, {
          method: "POST",
          body: {
            columnId: move.columnId,
            beforeColumnId: move.beforeColumnId,
            mutationId: move.mutationId,
          },
        });
      }
      console.debug("[column-moves-flush] success", { reason, count: pending.length });
    } catch (err) {
      console.debug("[column-moves-flush] failure", { reason, message: err.message });
      for (const move of pending) {
        pendingColumnMovesRef.current.set(move.columnId, move);
      }
      persistPendingColumnMovesToStorage();
      setError(err.message);
      if (selectedBoardId) {
        await loadBoard(selectedBoardId, "column-moves-flush-recovery");
      }
    } finally {
      isFlushingColumnMovesRef.current = false;
    }
  }

  function scheduleMoveFlush() {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
    }
    flushTimerRef.current = setTimeout(() => {
      flushPendingMoves("debounce");
    }, MOVE_DEBOUNCE_MS);

    if (!maxWaitTimerRef.current) {
      maxWaitTimerRef.current = setTimeout(() => {
        flushPendingMoves("max-wait");
      }, MOVE_MAX_WAIT_MS);
    }
  }

  function scheduleColumnMoveFlush() {
    if (columnFlushTimerRef.current) {
      clearTimeout(columnFlushTimerRef.current);
    }
    columnFlushTimerRef.current = setTimeout(() => {
      flushPendingColumnMoves("debounce");
    }, COLUMN_MOVE_DEBOUNCE_MS);

    if (!columnMaxWaitTimerRef.current) {
      columnMaxWaitTimerRef.current = setTimeout(() => {
        flushPendingColumnMoves("max-wait");
      }, COLUMN_MOVE_MAX_WAIT_MS);
    }
  }

  const [authForm, setAuthForm] = useState({
    mode: "login",
    email: "",
    password: "",
    displayName: "",
  });
  const [showAuthPassword, setShowAuthPassword] = useState(false);

  const [createBoardForm, setCreateBoardForm] = useState({
    name: "",
    roomPassword: "",
  });

  const [joinForm, setJoinForm] = useState({
    roomCode: "",
    roomPassword: "",
    role: "viewer",
  });
  const [resetRoomPassword, setResetRoomPassword] = useState("");
  const [resetRoomStatus, setResetRoomStatus] = useState("");

  const selectedBoardRole = useMemo(() => {
    const board = boards.find((item) => item.id === selectedBoardId);
    return board?.role ?? null;
  }, [boards, selectedBoardId]);
  const canManageCards = selectedBoardRole === "admin" || selectedBoardRole === "editor";
  const canManageColumns = Boolean(user?.id && boardMeta?.createdBy && boardMeta.createdBy === user.id);
  const pendingMembers = useMemo(
    () => boardMembers.filter((member) => member.status === "pending"),
    [boardMembers]
  );
  const activeMembers = useMemo(
    () => boardMembers.filter((member) => member.status === "active"),
    [boardMembers]
  );

  const sensors = useSensors(
    /* Cards use a dedicated Drag handle; instant touch pickup works there. */
    useSensor(TouchSensor),
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const loadBoards = useCallback(async () => {
    const data = await api("/api/boards");
    setBoards(data.boards);
    if (!selectedBoardId && data.boards.length > 0) {
      setSelectedBoardId(data.boards[0].id);
    }
  }, [selectedBoardId]);

  const loadBoard = useCallback(async (boardId, source = "unknown") => {
    const seq = ++boardLoadSeqRef.current;
    console.debug(`[board-load:${seq}] start`, { boardId, source });
    const data = await api(`/api/boards/${boardId}`);
    if (seq < latestAppliedBoardLoadSeqRef.current) {
      console.debug(`[board-load:${seq}] ignored as stale`, {
        latestApplied: latestAppliedBoardLoadSeqRef.current,
        boardId,
        source,
      });
      return;
    }
    latestAppliedBoardLoadSeqRef.current = seq;
    console.debug(`[board-load:${seq}] apply`, {
      boardId,
      source,
      columnCount: data.columns?.length ?? 0,
      revision: data.board?.revision ?? 0,
    });
    lastBoardRevisionRef.current = data.board?.revision ?? 0;
    setBoardMeta(data.board);
    setColumns(data.columns);
  }, []);

  const loadBoardMembers = useCallback(async (boardId) => {
    if (!boardId) {
      setBoardMembers([]);
      return;
    }

    const data = await api(`/api/boards/${boardId}/members`);
    setBoardMembers(data.members ?? []);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const me = await api("/api/auth/me");
        setUser(me.user);
        setStatus("ready");
        await loadBoards();
      } catch {
        setStatus("auth");
      }
    })();
  }, [loadBoards]);

  useEffect(() => {
    if (!selectedBoardId) {
      return;
    }

    (async () => {
      try {
        await loadBoard(selectedBoardId, "board-select");
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [loadBoard, selectedBoardId]);

  useEffect(() => {
    (async () => {
      try {
        await loadBoardMembers(selectedBoardId);
      } catch {
        setBoardMembers([]);
      }
    })();
  }, [loadBoardMembers, selectedBoardId]);

  useEffect(() => {
    if (!selectedBoardId || status !== "ready" || !user?.id) {
      return undefined;
    }

    let cancelled = false;
    let supabase = null;
    let channel = null;

    (async () => {
      try {
        const cfg = await api("/api/auth/realtime");
        if (cancelled) {
          return;
        }
        supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        await supabase.realtime.setAuth(cfg.accessToken);
        if (cancelled) {
          supabase.realtime.disconnect();
          return;
        }
        channel = supabase
          .channel(`board:${selectedBoardId}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "cards",
              filter: `board_id=eq.${selectedBoardId}`,
            },
            (payload) => {
              if (cancelled) {
                return;
              }
              setColumns((cols) => applyRealtimeCardPayload(cols, payload));
            }
          )
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "columns",
              filter: `board_id=eq.${selectedBoardId}`,
            },
            (payload) => {
              if (cancelled) {
                return;
              }
              setColumns((cols) => applyRealtimeColumnPayload(cols, payload));
            }
          )
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "board_members",
              filter: `board_id=eq.${selectedBoardId}`,
            },
            (payload) => {
              if (cancelled) {
                return;
              }
              loadBoardMembers(selectedBoardId);
            }
          )
          .subscribe((subscribeStatus, err) => {
            if (subscribeStatus === "CHANNEL_ERROR" && err) {
              console.warn("[realtime]", subscribeStatus, err);
            }
          });
      } catch (e) {
        console.warn("[realtime] setup failed", e);
      }
    })();

    return () => {
      cancelled = true;
      if (supabase && channel) {
        supabase.removeChannel(channel).catch(() => {});
      }
      if (supabase) {
        supabase.realtime.disconnect();
      }
    };
  }, [selectedBoardId, status, user?.id]);

  useEffect(() => {
    setResetRoomPassword("");
    setResetRoomStatus("");
  }, [selectedBoardId]);

  useEffect(() => {
    hydratePendingMovesFromStorage();
    hydratePendingColumnMovesFromStorage();
    if (pendingMovesRef.current.size > 0) {
      scheduleMoveFlush();
    }
    if (pendingColumnMovesRef.current.size > 0) {
      scheduleColumnMoveFlush();
    }
  }, []);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        flushPendingMoves("visibility-hidden");
        flushPendingColumnMoves("visibility-hidden");
      }
    }

    function handleBeforeUnload() {
      flushPendingMoves("before-unload");
      flushPendingColumnMoves("before-unload");
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [selectedBoardId, loadBoard]);

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setError("");

    try {
      if (authForm.mode === "login") {
        await api("/api/auth/login", {
          method: "POST",
          body: {
            email: authForm.email,
            password: authForm.password,
          },
        });
      } else {
        const response = await api("/api/auth/signup", {
          method: "POST",
          body: {
            email: authForm.email,
            password: authForm.password,
            displayName: authForm.displayName,
          },
        });

        if (response.emailConfirmationRequired) {
          setError("Email confirmation is required before signing in.");
          return;
        }
      }

      const me = await api("/api/auth/me");
      setUser(me.user);
      setStatus("ready");
      await loadBoards();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleLogout() {
    await api("/api/auth/logout", { method: "POST" });
    setError("");
    setUser(null);
    setBoards([]);
    setColumns([]);
    setBoardMeta(null);
    setSelectedBoardId("");
    setStatus("auth");
  }

  async function handleCreateBoard(event) {
    event.preventDefault();
    setError("");

    try {
      const data = await api("/api/boards", {
        method: "POST",
        body: createBoardForm,
      });

      setCreateBoardForm({ name: "", roomPassword: "" });
      await loadBoards();
      setSelectedBoardId(data.boardId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleJoinBoard(event) {
    event.preventDefault();
    setError("");

    try {
      await api("/api/boards/join", {
        method: "POST",
        body: joinForm,
      });
      setJoinForm({ roomCode: "", roomPassword: "", role: "viewer" });
      await loadBoards();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleResetRoomPassword(event) {
    event.preventDefault();
    setError("");
    setResetRoomStatus("");

    if (!selectedBoardId || !canManageColumns) {
      setError("Only the board owner can reset room password.");
      return;
    }

    if (!resetRoomPassword.trim() || resetRoomPassword.trim().length < 6) {
      setError("New room password must be at least 6 characters.");
      return;
    }

    try {
      const response = await api(`/api/boards/${selectedBoardId}/room-password`, {
        method: "PATCH",
        body: {
          roomPassword: resetRoomPassword.trim(),
        },
      });
      setResetRoomPassword("");
      setResetRoomStatus(response.message || "Room password updated.");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAddColumn() {
    if (!canManageColumns) {
      setError("Only the board owner can manage columns.");
      return;
    }
    const tempId = `temp-column-${Date.now()}`;
    const tempColumn = {
      id: tempId,
      name: "Untitled",
      orderIndex: Date.now(),
      cards: [],
    };

    setColumns((prev) => [...prev, tempColumn]);
    setRenamingColumnId(tempId);

    try {
      const data = await api(`/api/boards/${selectedBoardId}/columns`, {
        method: "POST",
        body: { name: "Untitled" },
      });
      setColumns((prev) =>
        prev.map((column) => (column.id === tempId ? data.column : column))
      );
      setRenamingColumnId(data.column.id);
    } catch (err) {
      setColumns((prev) => prev.filter((column) => column.id !== tempId));
      setRenamingColumnId("");
      setError(err.message);
    }
  }

  async function handleRenameColumn(columnId, nextName) {
    if (!canManageColumns) {
      setError("Only the board owner can manage columns.");
      return;
    }
    const column = columns.find((item) => item.id === columnId);
    if (!column || !nextName?.trim() || nextName.trim() === column.name) {
      return;
    }

    const previousColumns = columns;
    setColumns((prev) =>
      prev.map((item) => (item.id === column.id ? { ...item, name: nextName.trim() } : item))
    );

    try {
      await api(`/api/boards/${selectedBoardId}/columns`, {
        method: "PATCH",
        body: { columnId, name: nextName.trim() },
      });
      setRenamingColumnId((current) => (current === columnId ? "" : current));
    } catch (err) {
      setColumns(previousColumns);
      setError(err.message);
    }
  }

  async function handleDeleteColumn(column) {
    if (!canManageColumns) {
      setError("Only the board owner can manage columns.");
      return;
    }
    const previousColumns = columns;
    setColumns((prev) => prev.filter((item) => item.id !== column.id));

    try {
      await api(`/api/boards/${selectedBoardId}/columns`, {
        method: "DELETE",
        body: { columnId: column.id },
      });
    } catch (err) {
      setColumns(previousColumns);
      setError(err.message);
    }
  }

  async function handleCardAccentColor(cardId, accentColor) {
    if (!selectedBoardId || !canManageCards) {
      return;
    }
    setError("");
    const previousColumns = columns;
    setColumns((cols) =>
      cols.map((column) => ({
        ...column,
        cards: column.cards.map((c) => (c.id === cardId ? { ...c, accentColor } : c)),
      }))
    );
    try {
      await api(`/api/boards/${selectedBoardId}/cards/${cardId}`, {
        method: "PATCH",
        body: { accentColor },
      });
    } catch (err) {
      setColumns(previousColumns);
      setError(err.message);
    }
  }

  async function handleAddCard(columnId) {
    setCreateCardDraft({
      title: "",
      description: "",
      startDate: "",
      dueDate: "",
    });
    setCardModal({
      open: true,
      mode: "create",
      columnId,
      cardId: "",
    });
    setCreateCardChecklist([]);
    setCreateChecklistInput({ title: "", description: "" });
  }

  async function openCardDetails(cardId) {
    setCardModal({
      open: true,
      mode: "detail",
      columnId: "",
      cardId,
    });
    setCardModalLoading(true);
    setSelectedCard(null);
    setSelectedCardChecklist([]);
    try {
      const data = await api(`/api/boards/${selectedBoardId}/cards/${cardId}`);
      setSelectedCard(data.card);
      setSelectedCardDraft({
        title: data.card.title ?? "",
        description: data.card.description ?? "",
        startDate: data.card.startDate ? new Date(data.card.startDate).toISOString().slice(0, 16) : "",
        dueDate: data.card.dueDate ? new Date(data.card.dueDate).toISOString().slice(0, 16) : "",
      });
      setSelectedCardChecklist(data.checklist ?? []);
      setCardModal({
        open: true,
        mode: "detail",
        columnId: data.card.columnId,
        cardId,
      });
    } catch (err) {
      setError(err.message);
      closeCardModal();
    } finally {
      setCardModalLoading(false);
    }
  }

  function closeCardModal() {
    setCardModal({ open: false, mode: "detail", columnId: "", cardId: "" });
    setChecklistInput({ title: "", description: "" });
    setCreateChecklistInput({ title: "", description: "" });
    setCreateCardChecklist([]);
    setCardModalLoading(false);
  }

  function handleAddCreateChecklistItem() {
    if (!createChecklistInput.title.trim()) {
      return;
    }
    setCreateCardChecklist((prev) => [
      ...prev,
      {
        id: `temp-check-${Date.now()}-${prev.length}`,
        title: createChecklistInput.title.trim(),
        description: createChecklistInput.description.trim(),
      },
    ]);
    setCreateChecklistInput({ title: "", description: "" });
  }

  function handlePatchCreateChecklistItem(itemId, payload) {
    setCreateCardChecklist((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, ...payload } : item))
    );
  }

  function handleDeleteCreateChecklistItem(itemId) {
    setCreateCardChecklist((prev) => prev.filter((item) => item.id !== itemId));
  }

  async function handleCreateCardFromModal() {
    if (!createCardDraft.title.trim() || !cardModal.columnId) {
      return;
    }

    setModalSaving(true);
    try {
      const data = await api(`/api/boards/${selectedBoardId}/cards`, {
        method: "POST",
        body: {
          columnId: cardModal.columnId,
          title: createCardDraft.title,
          description: createCardDraft.description,
          startDate: toIsoOrNull(createCardDraft.startDate),
          dueDate: toIsoOrNull(createCardDraft.dueDate),
        },
      });

      setColumns((prev) =>
        prev.map((column) =>
          column.id === data.card.columnId
            ? {
                ...column,
                cards: column.cards.some((c) => c.id === data.card.id)
                  ? column.cards
                  : [...column.cards, data.card],
              }
            : column
        )
      );
      if (createCardChecklist.length > 0) {
        await Promise.all(
          createCardChecklist
            .filter((item) => item.title?.trim())
            .map((item) =>
              api(`/api/boards/${selectedBoardId}/cards/${data.card.id}/checklist`, {
                method: "POST",
                body: {
                  title: item.title.trim(),
                  description: item.description?.trim() ?? "",
                },
              })
            )
        );
      }
      closeCardModal();
    } catch (err) {
      setError(err.message);
    } finally {
      setModalSaving(false);
    }
  }

  async function handleSaveCardDetails(localCard) {
    if (!cardModal.cardId) {
      return;
    }

    setModalSaving(true);
    try {
      const response = await api(`/api/boards/${selectedBoardId}/cards/${cardModal.cardId}`, {
        method: "PATCH",
        body: {
          title: localCard.title,
          description: localCard.description,
          startDate: toIsoOrNull(localCard.startDate),
          dueDate: toIsoOrNull(localCard.dueDate),
        },
      });

      setSelectedCard(response.card);
      setSelectedCardDraft({
        title: response.card.title ?? "",
        description: response.card.description ?? "",
        startDate: response.card.startDate
          ? new Date(response.card.startDate).toISOString().slice(0, 16)
          : "",
        dueDate: response.card.dueDate
          ? new Date(response.card.dueDate).toISOString().slice(0, 16)
          : "",
      });
      setColumns((prev) =>
        prev.map((column) => ({
          ...column,
          cards: column.cards.map((card) =>
            card.id === response.card.id ? { ...card, ...response.card } : card
          ),
        }))
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setModalSaving(false);
    }
  }

  async function handleAddChecklistItem() {
    if (!cardModal.cardId || !checklistInput.title.trim()) {
      return;
    }

    try {
      const data = await api(
        `/api/boards/${selectedBoardId}/cards/${cardModal.cardId}/checklist`,
        {
          method: "POST",
          body: {
            title: checklistInput.title,
            description: checklistInput.description,
          },
        }
      );

      setSelectedCardChecklist((prev) => [...prev, data.item]);
      setChecklistInput({ title: "", description: "" });
    } catch (err) {
      setError(err.message);
    }
  }

  async function handlePatchChecklistItem(itemId, payload, localOnly = false) {
    if (!cardModal.cardId) {
      return;
    }

    if (localOnly) {
      setSelectedCardChecklist((prev) =>
        prev.map((item) => (item.id === itemId ? { ...item, ...payload } : item))
      );
      return;
    }

    try {
      const data = await api(
        `/api/boards/${selectedBoardId}/cards/${cardModal.cardId}/checklist/${itemId}`,
        {
          method: "PATCH",
          body: payload,
        }
      );

      setSelectedCardChecklist((prev) =>
        prev.map((item) => (item.id === itemId ? data.item : item))
      );
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteChecklistItem(itemId) {
    if (!cardModal.cardId) {
      return;
    }

    try {
      await api(`/api/boards/${selectedBoardId}/cards/${cardModal.cardId}/checklist/${itemId}`, {
        method: "DELETE",
      });

      setSelectedCardChecklist((prev) => prev.filter((item) => item.id !== itemId));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleMemberAction(userId, action) {
    try {
      await api(`/api/boards/${selectedBoardId}/members`, {
        method: "PATCH",
        body: { userId, action },
      });
      setBoardMembers((prev) =>
        prev.map((member) =>
          member.user_id === userId
            ? { ...member, status: action === "approve" ? "active" : "rejected" }
            : member
        )
      );
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDragStart(event) {
    const data = event.active.data.current;
    if (!data || data.type !== "card") {
      return;
    }

    for (const column of columns) {
      const found = column.cards.find((card) => card.id === data.cardId);
      if (found) {
        setActiveCard(found);
        break;
      }
    }
  }

  async function handleDragEnd(event) {
    setActiveCard(null);
    const activeData = event.active.data.current;
    const overData = event.over?.data?.current;

    if (!activeData || !overData) {
      return;
    }

    if (activeData.type === "column-sort") {
      if (!canManageColumns) {
        return;
      }
      const overId =
        overData.type === "column-sort"
          ? overData.columnId
          : overData.type === "column"
            ? overData.columnId
            : null;
      if (!overId) {
        return;
      }
      const columnId = activeData.columnId;
      const activeIndex = columns.findIndex((column) => column.id === columnId);
      const overIndex = columns.findIndex((column) => column.id === overId);
      if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) {
        return;
      }
      const nextColumns = arrayMove(columns, activeIndex, overIndex);
      setColumns(nextColumns);
      const movedIndex = nextColumns.findIndex((column) => column.id === columnId);
      const beforeColumnId = nextColumns[movedIndex + 1]?.id ?? null;
      const mutationId = createMutationId();
      pendingColumnMovesRef.current.set(columnId, {
        boardId: selectedBoardId,
        columnId,
        beforeColumnId,
        mutationId,
      });
      persistPendingColumnMovesToStorage();
      scheduleColumnMoveFlush();
      return;
    }

    if (activeData.type !== "card") {
      return;
    }

    let toColumnId = null;
    let beforeCardId = null;

    if (overData.type === "card") {
      toColumnId = overData.columnId;
      beforeCardId = overData.cardId;

      const activePos = findCardPosition(columns, activeData.cardId);
      const overPos = findCardPosition(columns, overData.cardId);
      if (activePos && overPos && activePos.columnId === overPos.columnId) {
        // Same-column downward move: insert after hovered card.
        if (activePos.index < overPos.index) {
          const afterHovered = overPos.cards[overPos.index + 1];
          beforeCardId = afterHovered?.id ?? null;
        }
      }
    } else if (overData.type === "column") {
      toColumnId = overData.columnId;
      beforeCardId = null;
    }

    if (!toColumnId) {
      return;
    }

    const moveSeq = ++moveSeqRef.current;
    const mutationId = createMutationId();
    const oldColumns = columns;
    const nextColumns = moveCardLocal(columns, activeData.cardId, toColumnId, beforeCardId);
    console.debug(`[move:${moveSeq}] optimistic-apply`, {
      boardId: selectedBoardId,
      cardId: activeData.cardId,
      toColumnId,
      beforeCardId,
      mutationId,
    });
    setColumns(nextColumns);

    pendingMovesRef.current.set(activeData.cardId, {
      boardId: selectedBoardId,
      cardId: activeData.cardId,
      toColumnId,
      beforeCardId,
      mutationId,
      moveSeq,
      oldColumns,
    });
    persistPendingMovesToStorage();
    scheduleMoveFlush();
  }

  if (status === "loading") {
    return <main className="flex min-h-screen items-center justify-center">Loading...</main>;
  }

  if (status === "auth") {
    return (
      <main className="min-h-screen bg-[radial-gradient(1400px_700px_at_15%_-25%,#1d4ed8,transparent_60%),radial-gradient(1000px_700px_at_100%_0%,#0f766e,transparent_65%),#020617] px-4 py-10">
        <section className="mx-auto max-w-md rounded-3xl border border-slate-600/60 bg-slate-900/85 p-7 shadow-[0_28px_70px_rgba(2,6,23,0.55)] backdrop-blur-md">
          <h1 className="text-3xl font-bold tracking-tight text-white">TaskFlow</h1>
          <p className="mt-2 text-sm text-slate-300">Collaborative boards with secure server-side API access.</p>

          <form className="mt-6 space-y-3" onSubmit={handleAuthSubmit}>
            <div className="flex rounded-xl bg-slate-800 p-1 text-sm">
              <button
                type="button"
                className={`flex-1 rounded-lg py-2 font-semibold transition ${
                  authForm.mode === "login"
                    ? "bg-sky-600 text-white shadow"
                    : "text-slate-300 hover:bg-slate-700"
                }`}
                onClick={() => setAuthForm((prev) => ({ ...prev, mode: "login" }))}
              >
                Sign in
              </button>
              <button
                type="button"
                className={`flex-1 rounded-lg py-2 font-semibold transition ${
                  authForm.mode === "signup"
                    ? "bg-sky-600 text-white shadow"
                    : "text-slate-300 hover:bg-slate-700"
                }`}
                onClick={() => setAuthForm((prev) => ({ ...prev, mode: "signup" }))}
              >
                Sign up
              </button>
            </div>

            {authForm.mode === "signup" ? (
              <input
                className="w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100 placeholder:text-slate-400"
                placeholder="Display name"
                value={authForm.displayName}
                onChange={(event) =>
                  setAuthForm((prev) => ({ ...prev, displayName: event.target.value }))
                }
                required
                minLength={2}
              />
            ) : null}

            <input
              className="w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100 placeholder:text-slate-400"
              placeholder="Email"
              type="email"
              value={authForm.email}
              onChange={(event) =>
                setAuthForm((prev) => ({ ...prev, email: event.target.value }))
              }
              required
            />

            <div className="relative">
              <input
                className="w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 pr-11 text-slate-100 placeholder:text-slate-400"
                placeholder="Password"
                type={showAuthPassword ? "text" : "password"}
                value={authForm.password}
                onChange={(event) =>
                  setAuthForm((prev) => ({ ...prev, password: event.target.value }))
                }
                required
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-slate-500 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
                onClick={() => setShowAuthPassword((prev) => !prev)}
              >
                {showAuthPassword ? "Hide" : "Show"}
              </button>
            </div>

            <button
              type="submit"
              className="w-full rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500"
            >
              {authForm.mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>

          {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main
      className="min-h-screen bg-slate-950 bg-cover bg-center bg-no-repeat px-4 py-4"
      style={{
        backgroundImage:
          "linear-gradient(rgba(3,7,18,0.72), rgba(3,7,18,0.82)), url('/api/branding-bg')",
      }}
    >
      <div className="mx-auto mb-3 flex w-full max-w-[1600px] items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-xl border border-slate-400/60 bg-slate-900/80 px-3 py-2 text-xs font-semibold text-slate-100 shadow-sm hover:bg-slate-800/90"
            onClick={() => setIsBoardsDrawerOpen(true)}
          >
            Boards
          </button>
          <span className="text-sm font-semibold text-slate-200">
            {boardMeta?.name || "No board selected"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-300">
            {user?.email}
            {boardMeta ? ` • Room: ${boardMeta.roomCode}` : ""}
          </span>
          <button
            type="button"
            className="rounded-xl border border-red-300/80 bg-red-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-red-500"
            onClick={handleLogout}
          >
            Log out
          </button>
        </div>
      </div>

      {isBoardsDrawerOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[1px]"
          onClick={() => setIsBoardsDrawerOpen(false)}
        />
      ) : null}

      <aside
        className={`fixed left-0 top-0 z-50 h-full w-[320px] border-r border-slate-600 bg-slate-900/95 p-4 text-slate-100 shadow-2xl transition-transform duration-300 ${
          isBoardsDrawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-200">
            My Boards
          </h2>
          <button
            type="button"
            className="rounded-md border border-slate-500 bg-slate-800 px-2 py-1 text-xs hover:bg-slate-700"
            onClick={() => setIsBoardsDrawerOpen(false)}
          >
            Close
          </button>
        </div>
        <div className="mt-3 flex max-h-48 flex-col gap-2 overflow-auto">
            {boards.map((board) => (
              <button
                key={board.id}
                type="button"
                className={`rounded-xl border px-3 py-2 text-left text-sm ${
                  selectedBoardId === board.id
                    ? "border-teal-400 bg-slate-800 text-slate-100"
                    : "border-slate-600 bg-slate-800 text-slate-100"
                }`}
                onClick={() => {
                  setSelectedBoardId(board.id);
                  setIsBoardsDrawerOpen(false);
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 rounded-full border ${
                      selectedBoardId === board.id
                        ? "border-emerald-400 bg-emerald-400"
                        : "border-slate-300 bg-transparent"
                    }`}
                  />
                  <div className="font-semibold">{board.name}</div>
                </div>
                <div className="text-xs opacity-80">{board.role}</div>
              </button>
            ))}
          </div>

        <form className="mt-4 space-y-2" onSubmit={handleCreateBoard} autoComplete="off">
            <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-300">Create Board</h3>
            <input
              className="w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
              placeholder="Board name"
              autoComplete="off"
              name="boardName"
              value={createBoardForm.name}
              onChange={(event) =>
                setCreateBoardForm((prev) => ({ ...prev, name: event.target.value }))
              }
              required
            />
            <input
              className="w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
              placeholder="Room password"
              type="password"
              autoComplete="new-password"
              name="boardRoomPassword"
              value={createBoardForm.roomPassword}
              onChange={(event) =>
                setCreateBoardForm((prev) => ({ ...prev, roomPassword: event.target.value }))
              }
              required
            />
            <button className="w-full rounded-xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500" type="submit">
              Create
            </button>
          </form>

          <form className="mt-4 space-y-2" onSubmit={handleJoinBoard} autoComplete="off">
            <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-300">Join Room</h3>
            <input
              className="w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm uppercase"
              placeholder="Room code"
              autoComplete="off"
              name="joinRoomCode"
              maxLength={8}
              value={joinForm.roomCode}
              onChange={(event) =>
                setJoinForm((prev) => ({
                  ...prev,
                  roomCode: event.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase(),
                }))
              }
              required
            />
            <input
              className="w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
              placeholder="Room password"
              type="password"
              autoComplete="new-password"
              name="joinRoomPassword"
              value={joinForm.roomPassword}
              onChange={(event) =>
                setJoinForm((prev) => ({ ...prev, roomPassword: event.target.value }))
              }
              required
            />
            <select
              className="w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
              value={joinForm.role}
              onChange={(event) =>
                setJoinForm((prev) => ({ ...prev, role: event.target.value }))
              }
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
            <button className="w-full rounded-xl border border-teal-500 bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-500" type="submit">
              Send request
            </button>
          </form>
          {canManageColumns && selectedBoardId ? (
            <form className="mt-6 space-y-2" onSubmit={handleResetRoomPassword} autoComplete="off">
              <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-300">
                Reset Room Password
              </h3>
              <input
                className="w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
                placeholder="New room password"
                type="password"
                autoComplete="new-password"
                name="resetRoomPassword"
                value={resetRoomPassword}
                onChange={(event) => setResetRoomPassword(event.target.value)}
                required
                minLength={6}
              />
              <button
                className="w-full rounded-xl border border-amber-400 bg-amber-500 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-400"
                type="submit"
              >
                Update password
              </button>
              {resetRoomStatus ? (
                <p className="text-xs text-emerald-300">{resetRoomStatus}</p>
              ) : null}
            </form>
          ) : null}
      </aside>

      <section className="mx-auto w-full max-w-[1600px]">
          <div className="mb-3 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-xl border border-slate-500 bg-slate-900/85 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-800"
                onClick={() => setDensity((prev) => (prev === "compact" ? "detailed" : "compact"))}
              >
                Card details: {density === "compact" ? "Off" : "On"}
              </button>
              {selectedBoardRole === "admin" ? (
                <>
                  <button
                    type="button"
                    className="rounded-xl border border-emerald-300 bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                    onClick={() => setIsRequestsPanelOpen((prev) => !prev)}
                  >
                    Requests {pendingMembers.length > 0 ? `(${pendingMembers.length})` : ""} {isRequestsPanelOpen ? "▲" : "▼"}
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border border-cyan-300 bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-500"
                    onClick={() => setIsMembersDrawerOpen(true)}
                  >
                    Members
                  </button>
                </>
              ) : null}
              {selectedBoardId && canManageColumns ? (
                <button
                  type="button"
                  className="rounded-xl border border-sky-300 bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500"
                  onClick={handleAddColumn}
                >
                  + Column
                </button>
              ) : null}
            </div>
          </div>

          {selectedBoardId ? (
            <DndContext
              sensors={sensors}
              collisionDetection={(args) => {
                const pointer = pointerWithin(args);
                return pointer.length > 0 ? pointer : closestCorners(args);
              }}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={columns.map((column) => `column-sort:${column.id}`)}
                strategy={horizontalListSortingStrategy}
              >
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {columns.map((column) => (
                    <KanbanColumn
                      key={column.id}
                      column={column}
                      density={density}
                      canManageColumn={canManageColumns}
                      canManageCards={canManageCards}
                      renameActive={renamingColumnId === column.id}
                      onAddCard={handleAddCard}
                      onOpenCard={openCardDetails}
                      onCardAccentChange={handleCardAccentColor}
                      onRenameColumn={handleRenameColumn}
                      onDeleteColumn={handleDeleteColumn}
                    />
                  ))}
                </div>
              </SortableContext>
              <DragOverlay>
                {activeCard ? (
                  <KanbanCard
                    card={activeCard}
                    density={density}
                    onOpen={() => {}}
                    isDragOverlay
                  />
                ) : null}
              </DragOverlay>
            </DndContext>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-400 bg-slate-900/60 p-6 text-sm text-slate-200">
              Open the board drawer and pick a board, or create a new one.
            </div>
          )}
      </section>

      {isRequestsPanelOpen && selectedBoardRole === "admin" ? (
        <>
          <div
            className="fixed inset-0 z-20 bg-black/20"
            onClick={() => setIsRequestsPanelOpen(false)}
          />
          <aside className="fixed right-4 top-20 z-30 w-[320px] rounded-2xl border border-amber-300 bg-white p-4 shadow-xl">
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-amber-700">Requests</h2>
            <p className="mt-1 text-xs text-slate-600">Only admins can review pending access requests.</p>
            <div className="mt-3 max-h-[70vh] space-y-2 overflow-auto">
              {pendingMembers.length === 0 ? (
                <p className="text-xs text-slate-600">No pending requests.</p>
              ) : (
                pendingMembers.map((member) => (
                  <div key={member.id} className="rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm text-slate-800">
                    <div className="font-semibold text-slate-900">{member.display_name ?? "-"}</div>
                    <div className="break-all text-slate-700">{member.email ?? member.user_id}</div>
                    <div className="mt-1 text-slate-700">Role: {member.role}</div>
                    <div className="mt-2 flex gap-1">
                      <button
                        type="button"
                        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
                        onClick={() => handleMemberAction(member.user_id, "approve")}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white"
                        onClick={() => handleMemberAction(member.user_id, "reject")}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        </>
      ) : null}

      {isMembersDrawerOpen && selectedBoardRole === "admin" ? (
        <>
          <div
            className="fixed inset-0 z-20 bg-black/20"
            onClick={() => setIsMembersDrawerOpen(false)}
          />
          <aside className="fixed right-4 top-20 z-30 h-[78vh] w-[520px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-cyan-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-cyan-700">
                Members
              </h2>
              <button
                type="button"
                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                onClick={() => setIsMembersDrawerOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="h-full overflow-auto p-4">
              {activeMembers.length === 0 ? (
                <p className="text-sm text-slate-600">No active members.</p>
              ) : (
                <table className="w-full table-auto border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.08em] text-slate-500">
                      <th className="px-2 py-2">Name</th>
                      <th className="px-2 py-2">Email</th>
                      <th className="px-2 py-2">Role</th>
                      <th className="px-2 py-2">Joined at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeMembers.map((member) => (
                      <tr key={member.id} className="border-b border-slate-100 align-top">
                        <td className="px-2 py-2 font-medium text-slate-900">
                          {member.display_name ?? member.email ?? "Unknown"}
                        </td>
                        <td className="break-all px-2 py-2 text-slate-700">
                          {member.email ?? "-"}
                        </td>
                        <td className="px-2 py-2 text-slate-700">{member.role}</td>
                        <td className="px-2 py-2 text-slate-700">
                          {member.created_at
                            ? new Date(member.created_at).toLocaleString()
                            : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </aside>
        </>
      ) : null}

      {error ? (
        <div className="mx-auto mt-4 w-full max-w-[1500px] rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <CardDetailsModal
        open={cardModal.open}
        loading={cardModalLoading}
        mode={cardModal.mode}
        draft={createCardDraft}
        setDraft={setCreateCardDraft}
        createCardChecklist={createCardChecklist}
        createChecklistInput={createChecklistInput}
        setCreateChecklistInput={setCreateChecklistInput}
        selectedCard={selectedCard}
        selectedCardDraft={selectedCardDraft}
        setSelectedCardDraft={setSelectedCardDraft}
        selectedCardChecklist={selectedCardChecklist}
        checklistInput={checklistInput}
        setChecklistInput={setChecklistInput}
        saving={modalSaving}
        onClose={closeCardModal}
        onCreateCard={handleCreateCardFromModal}
        onAddCreateChecklist={handleAddCreateChecklistItem}
        onPatchCreateChecklist={handlePatchCreateChecklistItem}
        onDeleteCreateChecklist={handleDeleteCreateChecklistItem}
        onSaveCard={handleSaveCardDetails}
        onAddChecklist={handleAddChecklistItem}
        onPatchChecklist={handlePatchChecklistItem}
        onDeleteChecklist={handleDeleteChecklistItem}
      />
    </main>
  );
}
