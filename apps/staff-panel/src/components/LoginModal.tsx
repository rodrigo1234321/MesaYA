import React, { useState, useEffect, useCallback } from 'react';
import { StaffApi, API_BASE } from '../lib/api';
import { StaffUserDTO } from '@mesaya/shared';
import { unlockAudio } from '../lib/audio';
import { Lock, ArrowRight } from 'lucide-react';

const PIN_PATTERN = /^\d{4,6}$/;

interface LoginModalProps {
  onSuccess: (user: StaffUserDTO) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ onSuccess }) => {
  const [slug, setSlug] = useState('trattoria-del-puerto');
  const [restaurantsList, setRestaurantsList] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/restaurants`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setRestaurantsList(data);
          const saved = StaffApi.getSavedUser();
          if (saved && data.some(r => r.slug === saved.restaurantId || r.id === saved.restaurantId)) {
            const found = data.find(r => r.slug === saved.restaurantId || r.id === saved.restaurantId);
            if (found) setSlug(found.slug);
          }
        }
      })
      .catch(() => {});
  }, []);

  const doLogin = useCallback(async (pinToUse: string) => {
    if (!pinToUse || loading) return;
    if (!PIN_PATTERN.test(pinToUse)) {
      setError('El PIN debe tener entre 4 y 6 dígitos.');
      return;
    }
    setLoading(true);
    setError(null);
    unlockAudio();

    try {
      const data = await StaffApi.login({
        restaurantSlug: slug,
        pin: pinToUse
      });
      onSuccess(data.staffUser);
    } catch (err: any) {
      setError(err.message || 'PIN o restaurante incorrecto');
      setPin('');
    } finally {
      setLoading(false);
    }
  }, [slug, loading, onSuccess]);

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

  useEffect(() => {
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
        if (pin.length >= 4) {
          doLogin(pin);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pin, loading, doLogin]);

  return (
    <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5 my-auto">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 text-indigo-400 flex items-center justify-center mx-auto shadow-inner shadow-indigo-500/20">
            <Lock className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-black text-white tracking-tight">Panel Mozo / Staff</h2>
          <p className="text-xs text-slate-400">
            Ingresá tu PIN de 4 a 6 dígitos (teclado en pantalla o físico). Se envía con Enter/botón o al sexto dígito.
          </p>
        </div>

        {/* Restaurant selector for multi-tenancy */}
        {restaurantsList.length > 0 && (
          <div className="space-y-1">
            <label className="block text-[11px] font-semibold text-slate-400">Restaurante / Local</label>
            <select
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              {restaurantsList.map((r) => (
                <option key={r.id} value={r.slug}>
                  {r.name} ({r.slug})
                </option>
              ))}
            </select>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-red-950/70 border border-red-800 text-xs font-bold text-red-300 text-center animate-shake">
            {error}
          </div>
        )}

        {/* PIN display dots (4–6) */}
        <div className="flex justify-center items-center space-x-2.5 py-1">
          {[0, 1, 2, 3, 4, 5].map(idx => (
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

        {/* Numeric Keypad */}
        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(n => (
            <button
              key={n}
              type="button"
              disabled={loading}
              onClick={() => handleKeyPress(n)}
              className="py-3 rounded-2xl bg-slate-800/90 hover:bg-slate-700/80 active:bg-indigo-600 border border-slate-700/60 text-xl font-bold text-white active:scale-95 transition-all shadow-sm"
            >
              {n}
            </button>
          ))}
          <button
            type="button"
            disabled={loading}
            onClick={handleBackspace}
            className="py-3 rounded-2xl bg-slate-800/50 hover:bg-slate-800 text-sm font-bold text-slate-400 active:scale-95 transition-all border border-slate-800"
          >
            ⌫
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => handleKeyPress('0')}
            className="py-3 rounded-2xl bg-slate-800/90 hover:bg-slate-700/80 active:bg-indigo-600 border border-slate-700/60 text-xl font-bold text-white active:scale-95 transition-all shadow-sm"
          >
            0
          </button>
          <button
            type="button"
            disabled={loading || pin.length < 4}
            onClick={() => doLogin(pin)}
            className="py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold flex items-center justify-center shadow-lg shadow-indigo-600/40 active:scale-95 transition-all"
          >
            {loading ? (
              <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
            ) : (
              <ArrowRight className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
