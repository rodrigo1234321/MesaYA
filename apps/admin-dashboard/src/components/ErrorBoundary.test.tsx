/**
 * C04 — ErrorBoundary component tests.
 *
 * Pure unit tests that verify:
 * - getDerivedStateFromError transitions
 * - Fallback rendering (full-page and isolated modes)
 * - Error privacy (no sensitive data in state)
 * - Recovery via reset handler
 * - role="alert" accessibility attribute
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

describe('C04 — ErrorBoundary Component Tests', () => {

  it('initializes with hasError=false and renders children directly', () => {
    const child = React.createElement('div', { 'data-testid': 'child' }, 'Contenido normal');
    const boundary = new ErrorBoundary({ children: child });
    expect(boundary.state.hasError).toBe(false);

    const rendered = boundary.render() as React.ReactElement;
    expect(rendered).toBeDefined();
    expect(rendered.props['data-testid']).toBe('child');
  });

  it('getDerivedStateFromError sets hasError=true', () => {
    const error = new Error('Fallo crítico simulado');
    const newState = ErrorBoundary.getDerivedStateFromError(error);
    expect(newState).toEqual({ hasError: true });
  });

  it('renders full-page fallback with role="alert" when hasError=true', () => {
    const boundary = new ErrorBoundary({
      children: React.createElement('div', null, 'Hijo'),
      fallbackTitle: 'Error Personalizado',
      fallbackMessage: 'Mensaje de prueba sin filtración técnica'
    });
    boundary.state = { hasError: true };

    const rendered = boundary.render() as React.ReactElement;
    expect(rendered.props.role).toBe('alert');
    // Full-page mode uses min-h-screen
    expect(rendered.props.className).toContain('min-h-screen');
  });

  it('renders isolated fallback (card) when isolate=true without derribar app', () => {
    const boundary = new ErrorBoundary({
      children: React.createElement('div', null, 'Tab Content'),
      isolate: true,
      fallbackTitle: 'Error en Tab',
      fallbackMessage: 'La sección no pudo cargar'
    });
    boundary.state = { hasError: true };

    const rendered = boundary.render() as React.ReactElement;
    expect(rendered.props.role).toBe('alert');
    expect(rendered.props.className).toContain('rounded-2xl');
    // Should NOT be full-screen
    expect(rendered.props.className).not.toContain('min-h-screen');
  });

  it('componentDidCatch does NOT store error message in state (privacy)', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boundary = new ErrorBoundary({ children: 'test' });
    const testError = new Error('DB connection refused password=secret host=prod.internal');

    boundary.componentDidCatch(testError, { componentStack: 'in FaultyComponent' });

    // State must NOT contain the error object, message, or stack
    expect(boundary.state).not.toHaveProperty('error');
    expect(boundary.state).not.toHaveProperty('errorMessage');
    expect(boundary.state).not.toHaveProperty('stack');
    // Only hasError boolean is stored
    expect(Object.keys(boundary.state)).toEqual(['hasError']);
    consoleErrorSpy.mockRestore();
  });

  it('handleReset clears error state and invokes onReset callback', () => {
    const onResetMock = vi.fn();
    const boundary = new ErrorBoundary({
      children: React.createElement('div', null, 'Content'),
      onReset: onResetMock
    });
    boundary.state = { hasError: true };

    // Simulate reset
    (boundary as any).handleReset();

    expect(boundary.state.hasError).toBe(false);
    expect(onResetMock).toHaveBeenCalledOnce();
  });

  it('isolated fallback contains "Reintentar sección" button text', () => {
    const boundary = new ErrorBoundary({
      children: React.createElement('div'),
      isolate: true
    });
    boundary.state = { hasError: true };

    const rendered = boundary.render() as React.ReactElement;
    // Deep-check the rendered tree contains the retry text
    const jsonStr = JSON.stringify(rendered);
    expect(jsonStr).toContain('Reintentar sección');
  });

  it('full-page fallback contains both "Reintentar" and "Recargar página" buttons', () => {
    const boundary = new ErrorBoundary({
      children: React.createElement('div')
    });
    boundary.state = { hasError: true };

    const rendered = boundary.render() as React.ReactElement;
    const jsonStr = JSON.stringify(rendered);
    expect(jsonStr).toContain('Reintentar');
    expect(jsonStr).toContain('Recargar página');
  });
});
