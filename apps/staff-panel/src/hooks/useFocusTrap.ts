import { useEffect, useRef } from 'react';

/**
 * Focus-trap hook for modal dialogs.
 * - Sets initial focus to the first focusable element on mount.
 * - Traps Tab / Shift+Tab within the container.
 * - Returns focus to the trigger element on unmount.
 * - Closes on Escape via optional onClose callback.
 */
export function useFocusTrap(
  isOpen: boolean,
  onClose?: () => void
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Remember what was focused before the modal opened
    triggerRef.current = document.activeElement;

    const container = containerRef.current;
    if (!container) return;

    const FOCUSABLE_SELECTOR =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const getFocusableElements = (): HTMLElement[] => {
      return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    };

    // Set initial focus
    const focusables = getFocusableElements();
    if (focusables.length > 0) {
      // Delay to ensure DOM is fully rendered
      requestAnimationFrame(() => {
        focusables[0]?.focus();
      });
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose?.();
        return;
      }

      if (e.key !== 'Tab') return;

      const currentFocusables = getFocusableElements();
      if (currentFocusables.length === 0) return;

      const firstElement = currentFocusables[0];
      const lastElement = currentFocusables[currentFocusables.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: wrap to last element
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab: wrap to first element
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      // Return focus to trigger element
      if (triggerRef.current && triggerRef.current instanceof HTMLElement) {
        triggerRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  return containerRef;
}
