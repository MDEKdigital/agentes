# Delete Conversation — Design Spec

**Date:** 2026-06-14  
**Status:** Approved

---

## Goal

Allow operators to delete a conversation (and its messages) from the inbox. The contact record is preserved — if the contact messages again, a new conversation is created.

---

## Behavior

- Delete button appears in two places: hover on each conversation item in the left list, and at the bottom of the right SidePanel.
- No confirmation dialog — action is immediate.
- On delete, messages, notes, and metrics cascade-delete automatically (existing `ON DELETE CASCADE` in DB).
- If the deleted conversation was currently open in the chat, the next conversation in the list is selected automatically (by index). If no next exists, the previous is selected. If the list becomes empty, the chat panel closes.

---

## Architecture

### 1. API — `DELETE /conversations/:conversationId`

**File:** `apps/api/src/routes/conversations/index.ts`

- Protected by existing `authMiddleware`.
- Fetches `organization_id` from the conversation to verify the caller has membership.
- Returns `204 No Content` on success, `404` if not found, `403` if no membership.
- Uses `getAdminClient()` to delete — same pattern as the existing `PATCH /status` route.

### 2. `ConversationList` — hover delete button

**File:** `apps/web/src/components/inbox/conversation-list.tsx`

- Each item gets a `group` class. On hover, a `Trash2` icon button becomes visible (`opacity-0 group-hover:opacity-100`).
- The button calls `onDelete(conv.id)` and stops click propagation so it doesn't also select the conversation.
- New prop: `onDelete: (id: string) => void`.

### 3. `SidePanel` — delete button

**File:** `apps/web/src/components/inbox/side-panel.tsx`

- A `Trash2` button added at the bottom of the panel, styled as destructive (red text, border).
- Calls `onDelete()`.
- New prop: `onDelete: () => void`.

### 4. `inbox/page.tsx` — orchestration

**File:** `apps/web/src/app/(dashboard)/inbox/page.tsx`

```
handleDelete(id):
  1. Call DELETE /conversations/:id via apiFetch
  2. Find index of deleted conversation in current list
  3. Compute next selected: conversations[index + 1] ?? conversations[index - 1] ?? null
  4. Remove conversation from local state (setConversations)
  5. If id === selectedId: navigate to next (router.push(`/inbox?id=${nextId}`) or `/inbox`)
```

No optimistic update — wait for API success before mutating state to avoid showing a deleted conversation as if it still exists.

---

## Data Flow

```
User clicks delete
  → handleDelete(id) in inbox/page.tsx
  → apiFetch DELETE /conversations/:id
  → API verifies membership → DB DELETE (cascades to messages, notes, metrics)
  → API returns 204
  → Remove from conversations state
  → Navigate to next conversation (or /inbox if none)
```

---

## Error Handling

- If the API call fails, show `alert(err.message)` and do not remove from state — same pattern used in `SidePanel.handleStatusChange`.

---

## Files Changed

| File | Change |
|------|--------|
| `apps/api/src/routes/conversations/index.ts` | Add `DELETE /:conversationId` route |
| `apps/web/src/components/inbox/conversation-list.tsx` | Add hover trash button + `onDelete` prop |
| `apps/web/src/components/inbox/side-panel.tsx` | Add delete button at bottom + `onDelete` prop |
| `apps/web/src/app/(dashboard)/inbox/page.tsx` | Add `handleDelete`, wire props |

No new files. No migrations needed.
