"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notesApi } from "@/lib/local-api";
import CommentsThread from "@/components/CommentsThread";
import type { Note } from "@/lib/types";

interface NoteCommentsThreadProps {
  note: Note;
}

// Thin wrapper around the shared `CommentsThread` for Notes. The shared
// component (added when Lab comments were extended to Experiments per
// Grant's clickable design lock) handles draft + collapse state + rendering;
// this wrapper just wires the Note-specific mutation hooks + cache
// invalidations.
export default function NoteCommentsThread({ note }: NoteCommentsThreadProps) {
  const queryClient = useQueryClient();

  const invalidateNotes = () => {
    queryClient.invalidateQueries({ queryKey: ["notes"] });
    queryClient.invalidateQueries({ queryKey: ["lab-notes"] });
    queryClient.invalidateQueries({ queryKey: ["lab", "notes-shared"] });
    // Per-user notes cache used by LabUserDetailPanel.
    queryClient.invalidateQueries({ queryKey: ["lab", "notes"] });
  };

  const addCommentMutation = useMutation({
    mutationFn: ({ text, author }: { text: string; author: string }) =>
      notesApi.addComment(note.id, note.username, text, author),
    onSuccess: invalidateNotes,
  });

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) =>
      notesApi.deleteComment(note.id, note.username, commentId),
    onSuccess: invalidateNotes,
  });

  return (
    <CommentsThread
      entityKind="note"
      entityId={note.id}
      entityOwner={note.username}
      comments={note.comments ?? []}
      isShared={note.is_shared}
      notSharedHint="This note isn't shared with the lab. Turn on sharing to let lab mates comment."
      onAdd={async (text, author) => {
        await addCommentMutation.mutateAsync({ text, author });
      }}
      onDelete={async (commentId) => {
        await deleteCommentMutation.mutateAsync(commentId);
      }}
    />
  );
}
