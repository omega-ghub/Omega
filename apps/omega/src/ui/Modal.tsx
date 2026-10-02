import { useEffect, type ReactNode } from 'react';

export function Modal({ children, onClose, width = 920, className = '' }: { children: ReactNode; onClose: () => void; width?: number; className?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal__backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${className}`} style={{ width }} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}
