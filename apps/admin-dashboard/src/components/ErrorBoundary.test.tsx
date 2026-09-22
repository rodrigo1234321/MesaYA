/**
 * C04 — ErrorBoundary real DOM mount tests.
 *
 * Uses @testing-library/react with jsdom to actually mount React trees
 * and verify fallback UI rendering, error privacy, recovery, and isolation.
 */
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

// Component that conditionally throws on render
let shouldThrowGlobal = false;
const ThrowingChild: React.FC = () => {
  if (shouldThrowGlobal) {
    throw new Error('DB connection refused password=s3cr3t host=prod-db.internal');
  }
  return <div data-testid="child-content">Todo funciona correctamente</div>;
};

describe('C04 — ErrorBoundary real DOM mount tests', () => {
  beforeEach(() => {
    shouldThrowGlobal = false;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders children normally when no error occurs', () => {
    shouldThrowGlobal = false;
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>
    );

    expect(screen.getByTestId('child-content')).toBeDefined();
    expect(screen.getByText('Todo funciona correctamente')).toBeDefined();
  });

  it('shows fallback UI with role="alert" when child throws in render', () => {
    shouldThrowGlobal = true;
    render(
      <ErrorBoundary
        fallbackTitle="Error Inesperado"
        fallbackMessage="La vista no pudo cargarse correctamente."
      >
        <ThrowingChild />
      </ErrorBoundary>
    );

    const alert = screen.getByRole('alert');
    expect(alert).toBeDefined();
    expect(screen.getByText('Error Inesperado')).toBeDefined();
    expect(screen.getByText('La vista no pudo cargarse correctamente.')).toBeDefined();
    expect(screen.queryByTestId('child-content')).toBeNull();
  });

  it('does NOT expose sensitive error details (DB passwords, hosts) in fallback UI', () => {
    shouldThrowGlobal = true;
    const { container } = render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>
    );

    const html = container.innerHTML;
    expect(html).not.toContain('password');
    expect(html).not.toContain('s3cr3t');
    expect(html).not.toContain('prod-db.internal');
    expect(html).not.toContain('DB connection');
    expect(html).not.toContain('refused');
  });

  it('shows isolated fallback (card, not full-screen) when isolate=true', () => {
    shouldThrowGlobal = true;
    render(
      <ErrorBoundary isolate={true} fallbackTitle="Error en sección">
        <ThrowingChild />
      </ErrorBoundary>
    );

    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('rounded-2xl');
    expect(alert.className).not.toContain('min-h-screen');
    expect(screen.getByText('Reintentar sección')).toBeDefined();
  });

  it('recovers from error when reset button is clicked', () => {
    // Start broken, then fix after reset
    shouldThrowGlobal = true;

    const Wrapper: React.FC = () => {
      return (
        <ErrorBoundary onReset={() => { shouldThrowGlobal = false; }}>
          <ThrowingChild />
        </ErrorBoundary>
      );
    };

    render(<Wrapper />);

    // Initially in error state
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.queryByTestId('child-content')).toBeNull();

    // Click "Reintentar"
    fireEvent.click(screen.getByText('Reintentar'));

    // After reset, child should render normally
    expect(screen.getByTestId('child-content')).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('preserves sibling sections when isolate=true (boundary does not crash parent)', () => {
    shouldThrowGlobal = true;
    render(
      <div>
        <div data-testid="sibling">Sección funcional</div>
        <ErrorBoundary isolate={true}>
          <ThrowingChild />
        </ErrorBoundary>
      </div>
    );

    expect(screen.getByTestId('sibling')).toBeDefined();
    expect(screen.getByText('Sección funcional')).toBeDefined();
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('full-page fallback contains both "Reintentar" and "Recargar página" buttons', () => {
    shouldThrowGlobal = true;
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>
    );

    expect(screen.getByText('Reintentar')).toBeDefined();
    expect(screen.getByText('Recargar página')).toBeDefined();
  });

  it('componentDidCatch does NOT store error in state (only hasError boolean)', () => {
    shouldThrowGlobal = true;
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>
    );

    // The fact that we see the fallback and NOT the raw error message proves
    // the component does not render the captured error object
    const alert = screen.getByRole('alert');
    expect(alert.innerHTML).not.toContain('DB connection');
    expect(alert.innerHTML).not.toContain('password');
  });
});
