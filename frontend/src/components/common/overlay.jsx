import { useState } from 'react';
import { Button } from './ui.jsx';
import { TextAreaField } from '../forms/controls.jsx';

export function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md rounded-card bg-white p-5 shadow-xl">
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="mt-3">{children}</div>
        <button onClick={onClose} className="sr-only">Close</button>
      </div>
    </div>
  );
}

/** Confirmation for high-impact actions, with optional (or required) comment. */
export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', commentLabel, commentRequired, onConfirm, onCancel, busy, error }) {
  const [comment, setComment] = useState('');
  const missing = commentLabel && commentRequired && !comment.trim();
  return (
    <Modal title={title} onClose={onCancel}>
      {message && <p className="mb-3 text-sm text-muted">{message}</p>}
      {commentLabel && (
        <TextAreaField label={commentLabel} required={commentRequired} value={comment} onChange={(e) => setComment(e.target.value)} />
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error.message}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button onClick={() => onConfirm(comment.trim() || undefined)} disabled={busy || missing}>{busy ? 'Working…' : confirmLabel}</Button>
      </div>
    </Modal>
  );
}
