import React, { useEffect, useState } from 'react';
import { AdminApi } from '../lib/api';
import { Sector, SECTOR_LABELS } from '@mesaya/shared';
import { Plus, UserCheck, Shield } from 'lucide-react';

interface StaffManagerProps {
  restaurantId: string;
}

export const StaffManager: React.FC<StaffManagerProps> = ({ restaurantId }) => {
  const [staff, setStaff] = useState<any[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState('WAITER');
  const [sector, setSector] = useState<Sector>(Sector.SALON_PRINCIPAL);
  const [error, setError] = useState<string | null>(null);

  const loadStaff = async () => {
    try {
      setError(null);
      setStaff(await AdminApi.getStaff(restaurantId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el personal.');
    }
  };

  useEffect(() => {
    loadStaff();
  }, [restaurantId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (!/^\d{4,6}$/.test(pin)) {
      setError('El PIN debe tener entre 4 y 6 dígitos numéricos, sin espacios.');
      return;
    }

    try {
      setError(null);
      await AdminApi.createStaff(restaurantId, name, pin, role, role === 'WAITER' ? sector : undefined);
      setShowAddModal(false);
      setName('');
      setPin('');
      loadStaff();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el personal.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-white">Equipo de Atención y Mozos</h3>
          <p className="text-xs text-slate-400">Administra los accesos por PIN numérico para el personal</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md shadow-indigo-600/30 active:scale-95 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Nuevo Mozo / Staff</span>
        </button>
      </div>

      {error && <p role="alert" className="rounded-xl border border-rose-800 bg-rose-950/50 px-3 py-2 text-xs text-rose-200">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {staff.map(user => (
          <div key={user.id} className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-indigo-400">
                  {user.role === 'MANAGER' ? <Shield className="w-5 h-5" /> : <UserCheck className="w-5 h-5" />}
                </div>
                <div>
                  <h4 className="font-bold text-sm text-white">{user.name}</h4>
                  <span className="text-[11px] text-slate-400 font-mono">
                    Rol: {user.role}
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-indigo-300 border border-slate-700">
                PIN Configurado
              </span>
            </div>

            {user.assignedSector && (
              <div className="text-xs text-slate-300 bg-slate-950/60 p-2 rounded-xl border border-slate-800">
                Sector preferido: <strong className="text-white">{SECTOR_LABELS[user.assignedSector as Sector] || user.assignedSector}</strong>
              </div>
            )}
          </div>
        ))}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleCreate} className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4">
            <h3 className="text-base font-bold text-white">Alta de Personal</h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Nombre Completo</label>
                <input
                  type="text"
                  placeholder="Ej: Joaquín, Sofía, Matías"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">PIN Numérico (4 a 6 dígitos)</label>
                <input
                  type="password"
                  maxLength={6}
                  minLength={4}
                  inputMode="numeric"
                  pattern="\d{4,6}"
                  placeholder="4–6 dígitos"
                  value={pin}
                  onChange={e => setPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white text-center tracking-widest text-base font-mono focus:outline-none focus:border-indigo-500"
                  required
                />
                <p className="mt-1 text-[11px] text-slate-500">Sólo dígitos, 4 a 6, sin espacios. Duplicados por local rechazados.</p>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Rol</label>
                <select
                  value={role}
                  onChange={e => setRole(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="WAITER">Mozo de Salón</option>
                  <option value="MANAGER">Encargado / Administrador</option>
                </select>
              </div>

              {role === 'WAITER' && (
                <div>
                  <label className="block text-slate-400 mb-1">Sector Preferido</label>
                  <select
                    value={sector}
                    onChange={e => setSector(e.target.value as Sector)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value={Sector.SALON_PRINCIPAL}>Salón Principal</option>
                    <option value={Sector.TERRAZA}>Terraza</option>
                    <option value={Sector.VEREDA}>Vereda</option>
                    <option value={Sector.PLANTA_ALTA}>Planta Alta</option>
                    <option value={Sector.BARRA}>Barra</option>
                  </select>
                </div>
              )}
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="w-1/2 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-semibold text-xs"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="w-1/2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs"
              >
                Guardar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
