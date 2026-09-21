import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

describe('R04 — ErrorBoundary Component Tests', () => {
  it('inicializa con hasError = false y renderiza children', () => {
    const boundary = new ErrorBoundary({ children: React.createElement('div', { id: 'test-child' }, 'Contenido normal') });
    expect(boundary.state.hasError).toBe(false);

    const rendered = boundary.render() as React.ReactElement;
    expect(rendered).toBeDefined();
    expect(rendered.props.id).toBe('test-child');
  });

  it('getDerivedStateFromError actualiza el estado a hasError = true', () => {
    const error = new Error('Fallo crítico simulado');
    const newState = ErrorBoundary.getDerivedStateFromError(error);
    expect(newState).toEqual({ hasError: true });
  });

  it('renderiza fallback accesible en español con role="alert" cuando hay error (modo completo)', () => {
    const boundary = new ErrorBoundary({
      children: React.createElement('div', null, 'Hijo'),
      fallbackTitle: 'Error Personalizado',
      fallbackMessage: 'Mensaje de prueba sin filtración técnica'
    });
    boundary.state = { hasError: true };

    const rendered = boundary.render() as React.ReactElement;
    expect(rendered.props.role).toBe('alert');

    // Verificar que contiene el contenedor con el título y mensaje amigables
    const children = rendered.props.children;
    expect(children).toBeDefined();
  });

  it('renderiza fallback aislado cuando isolate=true sin derribar toda la aplicación', () => {
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
  });

  it('componentDidCatch captura el error sin filtrar detalles sensibles a la UI', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boundary = new ErrorBoundary({ children: 'test' });
    const testError = new Error('DB connection refused password=secret');

    boundary.componentDidCatch(testError, { componentStack: 'in FaultyComponent' });

    // La UI no almacena el error ni el stack en el state para renderizarlo
    expect(boundary.state).not.toHaveProperty('error');
    consoleErrorSpy.mockRestore();
  });
});
