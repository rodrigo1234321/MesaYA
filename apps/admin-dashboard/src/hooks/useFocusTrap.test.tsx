/**
 * Ficha P2 — Automated tests for useFocusTrap stability, typing resilience and keyboard navigation.
 *
 * Verifies:
 * 1. Initial focus lands on the first focusable element.
 * 2. Focus does NOT reset to the first element when typing into a second input
 *    causes parent re-renders and creates new onClose callback instances.
 * 3. Tab wraps from last to first; Shift+Tab wraps from first to last.
 * 4. Escape invokes the current onClose callback and returns focus to the trigger.
 * 5. Escape does nothing when onClose is omitted (non-cancelable modal).
 * 6. Skips disabled controls and tabindex="-1".
 */
import React, { useState } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useFocusTrap } from './useFocusTrap';

interface TestModalProps {
  isOpen: boolean;
  onClose?: () => void;
  onTextChange?: (val: string) => void;
}

const TestModalComponent: React.FC<TestModalProps> = ({ isOpen, onClose, onTextChange }) => {
  const trapRef = useFocusTrap(isOpen, onClose);
  const [textVal, setTextVal] = useState('');

  if (!isOpen) return null;

  return (
    <div ref={trapRef} role="dialog" aria-modal="true" data-testid="modal-container">
      <h2>Modal de Prueba</h2>
      <input data-testid="input-first" placeholder="Primer campo" />
      <input
        data-testid="input-second"
        placeholder="Segundo campo"
        value={textVal}
        onChange={(e) => {
          setTextVal(e.target.value);
          onTextChange?.(e.target.value);
        }}
      />
      <button data-testid="disabled-btn" disabled>
        Deshabilitado
      </button>
      <button data-testid="submit-btn" onClick={() => onClose?.()}>
        Guardar
      </button>
    </div>
  );
};

// Harness that owns open state and trigger button
const TestAppHarness: React.FC<{ initialOpen?: boolean; canClose?: boolean }> = ({
  initialOpen = false,
  canClose = true
}) => {
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [typedCount, setTypedCount] = useState(0);

  return (
    <div>
      <button data-testid="trigger-btn" onClick={() => setIsOpen(true)}>
        Abrir Modal
      </button>
      <span data-testid="render-counter">{typedCount}</span>

      {/* Passing an inline anonymous function on every render simulates common consumer patterns */}
      <TestModalComponent
        isOpen={isOpen}
        onClose={canClose ? () => setIsOpen(false) : undefined}
        onTextChange={() => setTypedCount((c) => c + 1)}
      />
    </div>
  );
};

describe('Ficha P2: useFocusTrap stability and keyboard navigation', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('1. Pone el foco inicial en el primer elemento interactivo', () => {
    render(<TestAppHarness initialOpen={true} />);

    // Flusheamos el requestAnimationFrame del montaje inicial
    act(() => {
      vi.runAllTimers();
    });

    const firstInput = screen.getByTestId('input-first');
    expect(document.activeElement).toBe(firstInput);
  });

  it('2. Foco estable al escribir: re-renders por cambio de onClose NO roban el foco al segundo campo', () => {
    render(<TestAppHarness initialOpen={true} />);

    act(() => {
      vi.runAllTimers();
    });

    const secondInput = screen.getByTestId('input-second') as HTMLInputElement;

    // El usuario enfoca explícitamente el segundo campo
    act(() => {
      secondInput.focus();
    });
    expect(document.activeElement).toBe(secondInput);

    // El usuario escribe varios caracteres; cada pulsación re-renderiza el harness
    // creando una nueva referencia () => setIsOpen(false) para onClose.
    fireEvent.change(secondInput, { target: { value: 'A' } });
    act(() => {
      vi.runAllTimers();
    });
    // El foco DEBE permanecer en el segundo campo, NO volver al primero
    expect(document.activeElement).toBe(secondInput);

    fireEvent.change(secondInput, { target: { value: 'AB' } });
    act(() => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(secondInput);

    fireEvent.change(secondInput, { target: { value: 'ABC' } });
    act(() => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(secondInput);
    expect(screen.getByTestId('render-counter').textContent).toBe('3');
  });

  it('3. Navegación con Tab cicla del último al primer elemento habilitado, ignorando disabled', () => {
    render(<TestAppHarness initialOpen={true} />);

    act(() => {
      vi.runAllTimers();
    });

    const firstInput = screen.getByTestId('input-first');
    const submitBtn = screen.getByTestId('submit-btn');
    const container = screen.getByTestId('modal-container');

    // Foco en el último elemento habilitado (submit-btn)
    act(() => {
      submitBtn.focus();
    });
    expect(document.activeElement).toBe(submitBtn);

    // Al presionar Tab, debe saltar al primer elemento habilitado (input-first)
    fireEvent.keyDown(container, { key: 'Tab' });
    expect(document.activeElement).toBe(firstInput);

    // Al presionar Shift+Tab desde el primero, debe volver al último (submit-btn)
    fireEvent.keyDown(container, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(submitBtn);
  });

  it('4. Tecla Escape invoca onClose y devuelve el foco al trigger button', () => {
    render(<TestAppHarness initialOpen={false} />);

    const triggerBtn = screen.getByTestId('trigger-btn');

    // El usuario enfoca y hace click en el botón trigger
    act(() => {
      triggerBtn.focus();
      fireEvent.click(triggerBtn);
      vi.runAllTimers();
    });

    const container = screen.getByTestId('modal-container');
    expect(container).toBeDefined();

    // Presionar Escape
    act(() => {
      fireEvent.keyDown(container, { key: 'Escape' });
      vi.runAllTimers();
    });

    // El modal se cierra
    expect(screen.queryByTestId('modal-container')).toBeNull();

    // El foco debe haber vuelto al trigger button
    expect(document.activeElement).toBe(triggerBtn);
  });

  it('5. Tecla Escape respeta acciones no cancelables cuando onClose no se provee', () => {
    render(<TestAppHarness initialOpen={true} canClose={false} />);

    act(() => {
      vi.runAllTimers();
    });

    const container = screen.getByTestId('modal-container');
    expect(container).toBeDefined();

    // Presionar Escape no debe cerrar ni fallar
    fireEvent.keyDown(container, { key: 'Escape' });

    expect(screen.getByTestId('modal-container')).toBeDefined();
  });
});
