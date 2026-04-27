const STEP = 10000;

function midpoint(a, b) {
  return Math.floor((a + b) / 2);
}

function distributeBetween(leftBound, rightBound, total) {
  const span = rightBound - leftBound;
  const step = Math.floor(span / (total + 1));
  if (step < 1) {
    return null;
  }

  const values = [];
  for (let i = 1; i <= total; i += 1) {
    values.push(leftBound + step * i);
  }
  return values;
}

export function computeOrderPlan(cards, insertionIndex) {
  const left = insertionIndex > 0 ? cards[insertionIndex - 1] : null;
  const right = insertionIndex < cards.length ? cards[insertionIndex] : null;

  if (left && right && right.order_index - left.order_index > 1) {
    return {
      mode: "single",
      newOrderIndex: midpoint(left.order_index, right.order_index),
      updates: [],
    };
  }

  if (left && !right) {
    return {
      mode: "single",
      newOrderIndex: left.order_index + STEP,
      updates: [],
    };
  }

  if (!left && right && right.order_index > 1) {
    return {
      mode: "single",
      newOrderIndex: Math.floor(right.order_index / 2),
      updates: [],
    };
  }

  const n = cards.length;
  let radius = 1;

  while (radius <= n + 1) {
    const start = Math.max(0, insertionIndex - radius);
    const end = Math.min(n - 1, insertionIndex + radius - 1);

    const leftBound = start > 0 ? cards[start - 1].order_index : 0;
    const rightBound = end < n - 1 ? cards[end + 1].order_index : null;

    const windowCards = cards.slice(start, end + 1);
    const insertInWindow = insertionIndex - start;
    const total = windowCards.length + 1;

    if (rightBound == null) {
      const updates = [];
      let cursor = leftBound;
      for (let i = 0; i < total; i += 1) {
        cursor += STEP;
        if (i === insertInWindow) {
          continue;
        }
        const sourceIndex = i < insertInWindow ? i : i - 1;
        updates.push({
          id: windowCards[sourceIndex].id,
          orderIndex: cursor,
        });
      }

      return {
        mode: "elastic-window",
        newOrderIndex: leftBound + STEP * (insertInWindow + 1),
        updates,
      };
    }

    const distributed = distributeBetween(leftBound, rightBound, total);
    if (distributed) {
      const updates = [];
      for (let i = 0; i < total; i += 1) {
        if (i === insertInWindow) {
          continue;
        }
        const sourceIndex = i < insertInWindow ? i : i - 1;
        updates.push({
          id: windowCards[sourceIndex].id,
          orderIndex: distributed[i],
        });
      }

      return {
        mode: "elastic-window",
        newOrderIndex: distributed[insertInWindow],
        updates,
      };
    }

    radius += 1;
  }

  const updates = [];
  for (let i = 0; i < cards.length; i += 1) {
    const orderIndex = STEP * (i + 1 + (i >= insertionIndex ? 1 : 0));
    updates.push({ id: cards[i].id, orderIndex });
  }

  return {
    mode: "global-rebalance",
    newOrderIndex: STEP * (insertionIndex + 1),
    updates,
  };
}
