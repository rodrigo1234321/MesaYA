/**
 * PollingCoordinator — Motor de polling HTTP puro (sin React, sin DOM).
 *
 * Encapsula la lógica de scheduling, secuencia de requests, AbortController,
 * descarte de respuestas desfasadas, no-solapamiento, backoff con jitter
 * y cancelación limpia al cambiar de identificador.
 *
 * Los hooks de UI (useSSE, useFloorPlanSSE) lo instancian e inyectan sus
 * callbacks de estado y funciones de fetch concretas.
 *
 * Etapa 18 — Reconexión y avisos consistentes.
 */

export interface PollingCoordinatorOptions<T> {
  /**
   * Función que ejecuta el fetch real.
   * Recibe el identificador activo y un AbortSignal para cancelación.
   */
  fetchFn: (identifier: string, signal: AbortSignal) => Promise<T>;

  /**
   * Callback invocado con los datos al recibir un snapshot válido
   * (no desfasado, no abortado, del identificador correcto).
   */
  onData: (data: T) => void;

  /**
   * Callback invocado al cambiar el estado de conexión (true = conectado, false = desconectado).
   */
  onConnectionChange: (connected: boolean) => void;

  /**
   * Callback invocado ante un error de autenticación (401 / código personalizado).
   * El coordinador detiene el ciclo de polling al invocarlo.
   */
  onAuthError?: () => void;

  /**
   * Intervalo de polling en foreground (ms). Default: 3000.
   */
  intervalMs?: number;

  /**
   * Techo de backoff exponencial (ms). Default: 15000.
   */
  maxBackoffMs?: number;

  /**
   * Función inyectable que indica si la pestaña/ventana está oculta.
   * En producción se conecta a `document.hidden`. En tests se puede
   * inyectar un stub que siempre devuelva false.
   */
  isHidden?: () => boolean;

  /**
   * Función para detectar si un error es de autenticación (401).
   * Default: comprueba `err.statusCode === 401`.
   */
  isAuthError?: (err: unknown) => boolean;
}

export class PollingCoordinator<T> {
  // --- Configuración inyectada ---
  private _fetchFn: PollingCoordinatorOptions<T>['fetchFn'];
  private _onData: PollingCoordinatorOptions<T>['onData'];
  private _onConnectionChange: PollingCoordinatorOptions<T>['onConnectionChange'];
  private _onAuthError: PollingCoordinatorOptions<T>['onAuthError'];
  private _intervalMs: number;
  private _maxBackoffMs: number;
  private _isHidden: () => boolean;
  private _isAuthError: (err: unknown) => boolean;

  // --- Estado interno ---
  private _activeIdentifier: string | null = null;
  private _requestSeq = 0;
  private _isPollingBusy = false;
  private _failures = 0;
  private _pollingTimeout: ReturnType<typeof setTimeout> | null = null;
  private _abortController: AbortController | null = null;

  constructor(options: PollingCoordinatorOptions<T>) {
    this._fetchFn = options.fetchFn;
    this._onData = options.onData;
    this._onConnectionChange = options.onConnectionChange;
    this._onAuthError = options.onAuthError;
    this._intervalMs = options.intervalMs ?? 3000;
    this._maxBackoffMs = options.maxBackoffMs ?? 15000;
    this._isHidden = options.isHidden ?? (() => false);
    this._isAuthError = options.isAuthError ?? ((err: unknown) => {
      const e = err as any;
      return e?.statusCode === 401;
    });
  }

  // ─── Accessors para testing / inspección ───────────────────────────

  /** Identificador activo del ciclo actual (o null si detenido). */
  get activeIdentifier(): string | null {
    return this._activeIdentifier;
  }

  /** True si hay un tick de polling en vuelo. */
  get isPollingBusy(): boolean {
    return this._isPollingBusy;
  }

  /** True si hay un timer de next-poll programado. */
  get hasScheduledTimer(): boolean {
    return this._pollingTimeout !== null;
  }

  /** Número de secuencia actual (para inspección en tests). */
  get requestSeq(): number {
    return this._requestSeq;
  }

  // ─── Mutadores de callbacks (para que el hook actualice closures) ──

  set onData(fn: PollingCoordinatorOptions<T>['onData']) {
    this._onData = fn;
  }

  set onConnectionChange(fn: PollingCoordinatorOptions<T>['onConnectionChange']) {
    this._onConnectionChange = fn;
  }

  set onAuthError(fn: PollingCoordinatorOptions<T>['onAuthError']) {
    this._onAuthError = fn;
  }

  // ─── API pública ───────────────────────────────────────────────────

  /**
   * Inicia (o reinicia) el ciclo de polling para un nuevo identificador.
   * Cancela cualquier ciclo anterior de forma inmediata.
   */
  start(identifier: string): void {
    this._cancelPendingCycle();
    this._activeIdentifier = identifier;
    this._failures = 0;
    this._onConnectionChange(false);
    this._pollTick();
  }

  /**
   * Detiene el ciclo: cancela timer, aborta fetch en vuelo, incrementa seq.
   */
  stop(): void {
    this._cancelPendingCycle();
    this._activeIdentifier = null;
  }

  /**
   * Dispara un poll inmediato si no hay uno en curso.
   * Pensado para reconexión de red / recuperación de foco.
   */
  triggerNow(): void {
    if (!this._isPollingBusy && this._activeIdentifier) {
      this._failures = 0;
      this._pollTick();
    }
  }

  /**
   * Alias de stop(). Limpieza definitiva.
   */
  destroy(): void {
    this.stop();
  }

  // ─── Internos ──────────────────────────────────────────────────────

  private _cancelPendingCycle(): void {
    if (this._pollingTimeout) {
      clearTimeout(this._pollingTimeout);
      this._pollingTimeout = null;
    }
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    this._requestSeq += 1;
    this._isPollingBusy = false;
  }

  private _scheduleNextPoll(delayMs: number): void {
    if (this._pollingTimeout) {
      clearTimeout(this._pollingTimeout);
      this._pollingTimeout = null;
    }
    this._pollingTimeout = setTimeout(() => {
      this._pollingTimeout = null;
      this._pollTick();
    }, delayMs);
  }

  private async _pollTick(): Promise<void> {
    const currentIdentifier = this._activeIdentifier;
    if (!currentIdentifier || this._isPollingBusy) return;

    // Tab oculta: espaciar a 10s
    if (this._isHidden()) {
      this._scheduleNextPoll(10000);
      return;
    }

    this._isPollingBusy = true;
    const currentSeq = ++this._requestSeq;
    const controller = new AbortController();
    this._abortController = controller;

    try {
      const data = await this._fetchFn(currentIdentifier, controller.signal);

      // Respuesta desfasada: el identificador cambió o la seq fue superada
      if (currentSeq !== this._requestSeq || currentIdentifier !== this._activeIdentifier) {
        return;
      }

      this._failures = 0;
      this._onConnectionChange(true);
      this._onData(data);

      // Siguiente ciclo en intervalo normal
      this._scheduleNextPoll(this._intervalMs);
    } catch (err: unknown) {
      // Respuesta desfasada post-error
      if (currentSeq !== this._requestSeq || currentIdentifier !== this._activeIdentifier) {
        return;
      }
      if (err instanceof Error && err.name === 'AbortError') return;

      this._onConnectionChange(false);

      // Error de autenticación: detener el ciclo
      if (this._isAuthError(err)) {
        this._onAuthError?.();
        return;
      }

      // Backoff exponencial con jitter
      this._failures += 1;
      const backoff =
        Math.min(this._intervalMs * Math.pow(1.5, this._failures), this._maxBackoffMs) +
        Math.random() * 1000;
      this._scheduleNextPoll(backoff);
    } finally {
      if (currentSeq === this._requestSeq) {
        this._isPollingBusy = false;
        this._abortController = null;
      }
    }
  }
}
