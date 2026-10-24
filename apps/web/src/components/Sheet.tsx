"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface SheetProps {
  /** accessible name of the dialog */
  label: string;
  /** Escape, a tap on the backdrop, or the parent closing us all end up here */
  onClose: () => void;
  children: ReactNode;
}

/**
 * A bottom sheet on the native <dialog>: showModal() moves focus in, traps it, makes the page
 * behind inert and closes on Escape. We restore focus to whatever opened it. Render it only while
 * it should be open.
 */
export function Sheet({ label, onClose, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const opener = document.activeElement as HTMLElement | null;
    if (!d.open) d.showModal();
    // the control that wants focus first (Got it / Play), else the browser's choice
    d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    let notified = false;
    const onNativeClose = () => {
      if (notified) return;
      notified = true;
      closeRef.current();
    };
    d.addEventListener("close", onNativeClose);
    return () => {
      notified = true; // we are unmounting: do not report a close the parent already knows about
      d.removeEventListener("close", onNativeClose);
      if (d.open) d.close();
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={label}
      onClick={(e) => {
        // a tap on the dim area lands on the dialog element itself
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <div className="sheet-body">{children}</div>
    </dialog>
  );
}
