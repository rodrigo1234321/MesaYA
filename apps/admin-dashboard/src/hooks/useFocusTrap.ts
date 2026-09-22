import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Focus-trap hook para diálogos modales accesible y resistente a rerenders (Ficha P2).
 * - Mantiene el callback onClose actualizado mediante ref para no reinstalar listeners ni resetear foco.
 * - Captura el foco inicial únicamente en la transición de false -> true (o montaje inicial).
 * - Cancela cualquier requestAnimationFrame pendiente al cerrar o desmontar.
 * - Soporta Tab y Shift+Tab ciclando entre controles interactivos no disabled.
 * - Soporta Escape llamando al onClose vigente (si fue provisto).
 * - Retorna el foco al elemento disparador (trigger) al cerrar o desmontar.
 */
export function useFocusTrap(
  isOpen: boolean,
  onClose?: () => void
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);
  const onCloseRef = useRef<(() => void) | undefined>(onClose);
  const prevIsOpenRef = useRef<boolean>(false);
  const rafIdRef = useRef<number | null>(null);

  // Mantener onCloseRef siempre sincronizado con el callback más reciente sin disparar efectos
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen) {
      if (prevIsOpenRef.current) {
        // Transición de abierto a cerrado: cancelar cualquier frame pendiente y devolver foco al disparador
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        if (triggerRef.current && triggerRef.current instanceof HTMLElement) {
          triggerRef.current.focus();
        }
        triggerRef.current = null;
      }
      prevIsOpenRef.current = false;
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    // Solo guardamos el disparador y programamos el foco inicial cuando isOpen pasa a true por primera vez
    const isFirstOpen = !prevIsOpenRef.current;
    prevIsOpenRef.current = true;

    if (isFirstOpen) {
      triggerRef.current = document.activeElement;

      // Buscar el primer elemento enfocable
      const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute('disabled') && el.getAttribute('tabindex') !== '-1'
      );
      if (focusables.length > 0) {
        rafIdRef.current = requestAnimationFrame(() => {
          // Solo enfocar si el usuario no movió el foco manualmente en ese tick
          if (container.contains(document.activeElement)) return;
          focusables[0]?.focus();
        });
      }
    }

    if (!container.getAttribute('aria-modal')) {
      container.setAttribute('aria-modal', 'true');
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (onCloseRef.current) {
          e.preventDefault();
          e.stopPropagation();
          onCloseRef.current();
        }
        return;
      }

      if (e.key !== 'Tab') return;

      const currentFocusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute('disabled') && el.getAttribute('tabindex') !== '-1'
      );
      if (currentFocusables.length === 0) {
        e.preventDefault();
        return;
      }

      const firstElement = currentFocusables[0];
      const lastElement = currentFocusables[currentFocusables.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: wrap hacia el último elemento
        if (document.activeElement === firstElement || !container.contains(document.activeElement)) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab: wrap hacia el primer elemento
        if (document.activeElement === lastElement || !container.contains(document.activeElement)) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [isOpen]);

  // Cleanup al desmontar completamente el componente si estaba abierto
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (prevIsOpenRef.current && triggerRef.current && triggerRef.current instanceof HTMLElement) {
        triggerRef.current.focus();
      }
    };
  }, []);

  return containerRef;
}
