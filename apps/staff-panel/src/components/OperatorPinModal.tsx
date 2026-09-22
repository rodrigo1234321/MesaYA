import React, { useState, useEffect, useCallback } from 'react';
import { StaffApi } from '../lib/api';
import { StaffUserDTO } from '@mesaya/shared';
import { unlockAudio } from '../lib/audio';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { Lock, ArrowRight, X, UserRound, Sparkles, UserCheck, Shield } from 'lucide-react';

interface OperatorPinModalProps {
  isOpen: boolean;
  restaurantSlug: string;
  restaurantName?: string;
  currentOperatorName?: string | null;
  pendingActionLabel?: string | null;
  canClose?: boolean;
  onSuccess: (user: StaffUserDTO, token: string) => void;
  onClose?: () => void;
}

export const OperatorPinModal: React.FC<OperatorPinModalProps> = ({
  isOpen,
  restaurantSlug,
  restaurantName,
  currentOperatorName,
  pendingActionLabel,
  canClose = true,
  onSuccess,
  onClose
}) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const focusTrapRef = useFocusTrap(isOpen, canClose ? onClose : undefined);

  // Reset al abrir
  useEffect(() => {
    if (isOpen) {
      setPin('');
      setError(null);
      setLoading(false);
    }
  }, [isOpen]);

  const doLogin = useCallback(async (pinToUse: string) => {
    if (!pinToUse || loading || !restaurantSlug) return;
    setLoading(true);
    setError(null);
    unlockAudio();

    try {
      const data = await StaffApi.login({
        restaurantSlug,
        pin: pinToUse
      });
      onSuccess(data.staffUser, data.token);
    } catch (err: any) {
      setError(err.message || 'PIN incorrecto');
      setPin('');
    } finally {
      setLoading(false);
    }
  }, [restaurantSlug, loading, onSuccess]);

  const handleKeyPress = (num: string) => {
    if (pin.length < 6) {
      const newPin = pin + num;
      setPin(newPin);
      setError(null);
      unlockAudio();
      if (newPin.length === 6) {
        doLogin(newPin);
      }
    }
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
    setError(null);
  };

  // Soporte de teclado físico (números, Backspace, Enter, Escape)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (loading) return;

      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        setPin(prev => {
          if (prev.length < 6) {
            const next = prev + e.key;
            if (next.length === 6) {
              setTimeout(() => doLogin(next), 50);
            }
            return next;
          }
          return prev;
        });
        setError(null);
        unlockAudio();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setPin(prev => prev.slice(0, -1));
        setError(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (pin.length >= 4 && pin.length <= 6) {
          doLogin(pin);
        }
      } else if (e.key === 'Escape' && canClose && onClose) {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, pin, loading, canClose, onClose, doLogin]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pin-modal-title"
    >
      <div
        ref={focusTrapRef}
        className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5 my-auto animate-in fade-in zoom-in-95 duration-150"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 text-indigo-400 flex items-center justify-center shadow-inner shadow-indigo-500/20">
              <Lock className="w-6 h-6" />
            </div>
            <div>
              <h2 id="pin-modal-title" className="text-base font-extrabold text-white tracking-tight">
                {currentOperatorName ? 'Cambiar de Mozo' : 'Identificación de Mozo'}
              </h2>
              <p className="text-[11px] text-slate-400">
                {restaurantName || restaurantSlug}
              </p>
            </div>
          </div>
          {canClose && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="min-h-[48px] min-w-[48px] p-3 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-all flex items-center justify-center focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none"
              aria-label="Cerrar modal"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {pendingActionLabel && (
          <div className="p-3 rounded-xl bg-indigo-950/50 border border-indigo-800/60 text-xs sm:text-sm font-semibold text-indigo-200 flex items-center gap-2.5">
            <UserRound className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>Ingresá tu PIN para: <strong>{pendingActionLabel}</strong></span>
          </div>
        )}

        {error && (
          <div role="alert" className="p-3 rounded-xl bg-red-950/70 border border-red-800 text-xs sm:text-sm font-bold text-red-300 text-center animate-shake">
            {error}
          </div>
        )}

        {/* Visor de puntos de PIN */}
        <div className="flex justify-center items-center space-x-3 py-2" aria-label={`Dígitos ingresados: ${pin.length}`}>
          {Array.from({ length: Math.max(4, Math.min(6, pin.length + 1)) }).map((_, idx) => (
            <div
              key={idx}
              className={`w-4 h-4 rounded-full border-2 transition-all duration-200 ${
                pin.length > idx
                  ? 'bg-indigo-500 border-indigo-300 scale-125 shadow-md shadow-indigo-500/50'
                  : 'bg-slate-800 border-slate-700'
              }`}
            />
          ))}
        </div>

        {/* Teclado numérico táctil (targets >= 48px para tablet y dedos con espaciado >= 8px) */}
        <div className="grid grid-cols-3 gap-2.5" role="group" aria-label="Teclado numérico de PIN">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(n => (
            <button
              key={n}
              type="button"
              disabled={loading}
              onClick={() => handleKeyPress(n)}
              className="min-h-[48px] py-3 rounded-2xl bg-slate-800/90 hover:bg-slate-700/80 active:bg-indigo-600 border border-slate-700/60 text-xl font-bold text-white active:scale-95 transition-all shadow-sm focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none"
            >
              {n}
            </button>
          ))}
          <button
            type="button"
            disabled={loading}
            onClick={handleBackspace}
            className="min-h-[48px] py-3 rounded-2xl bg-slate-800/50 hover:bg-slate-800 text-sm font-bold text-slate-400 active:scale-95 transition-all border border-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none"
            aria-label="Borrar dígito"
          >
            ⌫
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => handleKeyPress('0')}
            className="min-h-[48px] py-3 rounded-2xl bg-slate-800/90 hover:bg-slate-700/80 active:bg-indigo-600 border border-slate-700/60 text-xl font-bold text-white active:scale-95 transition-all shadow-sm focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none"
          >
            0
          </button>
          <button
            type="button"
            disabled={loading || pin.length < 4 || pin.length > 6}
            onClick={() => doLogin(pin)}
            className="min-h-[48px] py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold flex items-center justify-center shadow-lg shadow-indigo-600/40 active:scale-95 transition-all focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:outline-none"
            aria-label="Confirmar PIN"
          >
            {loading ? (
              <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
            ) : (
              <ArrowRight className="w-5 h-5" />
            )}
          </button>
        </div>

        {/* Atajos de prueba en modo demo si está habilitado */}
        {import.meta.env.VITE_DEMO_MODE === 'true' && (
          <div className="pt-2 border-t border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400 font-semibold px-1">
              <span className="flex items-center gap-1 text-slate-400">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" /> Acceso Rápido Demo
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => { setPin('1234'); doLogin('1234'); }}
                className="flex items-center justify-center gap-1.5 min-h-[48px] py-2.5 px-3 rounded-xl bg-indigo-950/60 hover:bg-indigo-900/60 border border-indigo-800/60 text-indigo-200 text-xs font-bold active:scale-95 transition-all focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none"
              >
                <UserCheck className="w-3.5 h-3.5 text-indigo-400" />
                <span>Mozo (1234)</span>
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => { setPin('9999'); doLogin('9999'); }}
                className="flex items-center justify-center gap-1.5 min-h-[48px] py-2.5 px-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 text-slate-300 text-xs font-bold active:scale-95 transition-all focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none"
              >
                <Shield className="w-3.5 h-3.5 text-amber-400" />
                <span>Admin (9999)</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
