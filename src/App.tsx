/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from "react";
import { 
  Plus, 
  Trash2, 
  Edit2, 
  Save, 
  X, 
  ChevronRight, 
  TrendingUp, 
  DollarSign, 
  Search,
  ShoppingCart,
  MoreVertical,
  Check,
  Calendar,
  RotateCcw
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import { 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  onSnapshot, 
  query, 
  orderBy, 
  serverTimestamp,
  Timestamp
} from "firebase/firestore";
import { db } from "./lib/firebase";
import { cn } from "./lib/utils";

// --- Types ---

interface GarmentItem {
  id: string;
  garmentType: string;
  quantity: number;
  size: string;
  priceUSD: number;
  totalUSD: number;
}

interface PurchaseOrder {
  id: string;
  orderNumber: string;
  createdAt: Timestamp;
  deliveryDate: string; // YYYY-MM-DD
  description: string;
  exchangeRate: number;
  totalUSD: number;
  totalVES: number;
  advancePaymentUSD: number;
  status: 'active' | 'completed' | 'draft';
  clientName: string;
  clientPhone: string;
  items: GarmentItem[];
}

interface Toast {
  message: string;
  type: 'success' | 'error';
}

// --- Constants ---

const SIZES = [
  "2", "4", "6", "8", "10", "12", "14", "16",
  "XS/C", "S/C", "M/C", "L/C", "XL/C", "XXL/C", "XXXL/C", "XXXXL/C",
  "XS/D", "S/D", "M/D", "L/D", "XL/D", "XXL/D", "XXXL/D", "XXXXL/D"
];

const PRESET_GARMENTS = [
  "Franela", "Sudadera", "Chaleco", "Chaqueta", "Polo"
];

// --- Components ---

interface FirestoreErrorInfo {
  error: string;
  operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write', path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    authInfo: {
      user: "Checking status..." // We don't have auth exported in the same way here but we could
    }
  };
  console.error('Firestore Error Detailed: ', JSON.stringify(errInfo));
  
  if (error instanceof Error && error.message.includes('permission-denied')) {
    return "Error de permisos: La base de datos denegó la operación. Revisa los datos ingresados.";
  }
  return "Error al guardar: " + (error instanceof Error ? error.message : String(error));
}

export default function App() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'active' | 'completed'>('active');
  const [currentOrder, setCurrentOrder] = useState<Partial<PurchaseOrder> | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [globalExchangeRate, setGlobalExchangeRate] = useState<number>(() => {
    const saved = localStorage.getItem('sublicraft_global_rate');
    const lastDate = localStorage.getItem('sublicraft_last_rate_date');
    const today = new Date().toISOString().split('T')[0];
    
    // If it's a different day, reset the rate to 0 as per user request
    if (lastDate !== today) {
      return 0;
    }
    return saved ? Number(saved) : 0;
  });

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    localStorage.setItem('sublicraft_global_rate', globalExchangeRate.toString());
    localStorage.setItem('sublicraft_last_rate_date', today);
  }, [globalExchangeRate]);
  const [toast, setToast] = useState<Toast | null>(null);

  const isReadOnly = currentOrder?.status === 'completed';

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Group and sort orders for the calendar by week
  const groupedWeeks = useMemo(() => {
    const weeks: Record<string, Record<string, PurchaseOrder[]>> = {};
    
    // Sort all active orders by delivery date then by creation time
    const activeOrders = orders
      .filter(o => o.status === 'active' && o.deliveryDate)
      .sort((a, b) => {
        const dateA = a.deliveryDate;
        const dateB = b.deliveryDate;
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        return (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0);
      });
    
    activeOrders.forEach(order => {
      const d = new Date(order.deliveryDate + 'T12:00:00');
      const startOfWeek = new Date(d);
      startOfWeek.setDate(d.getDate() - d.getDay()); // Start on Sunday
      const weekKey = startOfWeek.toISOString().split('T')[0];

      if (!weeks[weekKey]) weeks[weekKey] = {};
      if (!weeks[weekKey][order.deliveryDate]) weeks[weekKey][order.deliveryDate] = [];
      weeks[weekKey][order.deliveryDate].push(order);
    });

    // Within each date, sort by createdAt
    Object.keys(weeks).forEach(weekKey => {
      Object.keys(weeks[weekKey]).forEach(dateKey => {
        weeks[weekKey][dateKey].sort((a, b) => {
          const timeA = a.createdAt?.toMillis() || 0;
          const timeB = b.createdAt?.toMillis() || 0;
          return timeA - timeB;
        });
      });
    });

    return weeks;
  }, [orders]);

  // Derive counts per delivery date
  const ordersPerDate = useMemo(() => {
    const counts: Record<string, number> = {};
    orders.forEach(o => {
      if (o.deliveryDate) {
        counts[o.deliveryDate] = (counts[o.deliveryDate] || 0) + 1;
      }
    });
    return counts;
  }, [orders]);

  // Firestore Listener
  useEffect(() => {
    // Safety timeout to disable loading if connection takes too long
    const timeout = setTimeout(() => {
      setLoading(p => {
        if (p) console.warn("Firestore connection timing out, disabling loading screen forced.");
        return false;
      });
    }, 8000);

    const q = query(collection(db, "orders"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      clearTimeout(timeout);
      const ordersData = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          status: 'active', // Default fallback
          ...data
        };
      }) as PurchaseOrder[];
      setOrders(ordersData);
      setLoading(false);
    }, (error) => {
      clearTimeout(timeout);
      console.error("Snapshot error:", error);
      setLoading(false);
      showToast("Error de conexión con la base de datos", "error");
    });
    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, []);

  const openNewOrder = () => {
    setCurrentOrder({
      clientName: "",
      clientPhone: "",
      advancePaymentUSD: 0,
      description: "",
      exchangeRate: globalExchangeRate,
      deliveryDate: new Date().toISOString().split('T')[0],
      status: 'active',
      items: [],
      totalUSD: 0,
      totalVES: 0
    });
    setIsModalOpen(true);
  };

  const openEditOrder = (order: PurchaseOrder) => {
    setCurrentOrder({ ...order });
    setIsModalOpen(true);
  };

  const saveOrder = async () => {
    if (!currentOrder) return;

    // Validations
    if (!currentOrder.clientName?.trim()) {
      showToast("El nombre del cliente es obligatorio", "error");
      return;
    }

    if (!currentOrder.exchangeRate || currentOrder.exchangeRate <= 0) {
      showToast("La tasa de cambio debe ser mayor a 0", "error");
      return;
    }

    if (!currentOrder.deliveryDate) {
      showToast("La fecha de entrega es obligatoria", "error");
      return;
    }

    if (!currentOrder.items || currentOrder.items.length === 0) {
      showToast("Debes agregar al menos una prenda", "error");
      return;
    }

    try {
      const items = (currentOrder.items || []).map(item => ({
        id: item.id || Math.random().toString(36).substr(2, 9),
        garmentType: item.garmentType || "Sin tipo",
        quantity: typeof item.quantity === 'number' ? item.quantity : 1,
        size: item.size || "M",
        priceUSD: typeof item.priceUSD === 'number' ? item.priceUSD : 0,
        totalUSD: (typeof item.quantity === 'number' ? item.quantity : 1) * (typeof item.priceUSD === 'number' ? item.priceUSD : 0)
      }));

      const totalUSD = items.reduce((sum, item) => sum + item.totalUSD, 0);
      const exchangeRate = currentOrder.exchangeRate;
      const totalVES = totalUSD * exchangeRate;

      const data = {
        clientName: currentOrder.clientName.trim(),
        clientPhone: currentOrder.clientPhone?.trim() || "",
        advancePaymentUSD: currentOrder.advancePaymentUSD || 0,
        description: currentOrder.description?.trim() || "",
        items: items,
        deliveryDate: currentOrder.deliveryDate,
        status: currentOrder.status || 'active',
        exchangeRate: exchangeRate,
        totalUSD: totalUSD,
        totalVES: totalVES,
      };

      if (currentOrder.id) {
        // Update: only send the fields to update
        await updateDoc(doc(db, "orders", currentOrder.id), data);
        showToast("Operación actualizada correctamente");
      } else {
        // Create
        const lastNum = orders.reduce((max, o) => {
          const num = parseInt(o.orderNumber);
          return isNaN(num) ? max : Math.max(max, num);
        }, 0);
        const orderNumber = (lastNum + 1).toString();
        await addDoc(collection(db, "orders"), {
          ...data,
          orderNumber,
          createdAt: serverTimestamp()
        });
        showToast("Operación guardada con éxito");
      }
      setIsModalOpen(false);
      setCurrentOrder(null);
    } catch (error: any) {
      const msg = handleFirestoreError(error, currentOrder.id ? 'update' : 'create', `orders/${currentOrder.id || 'new'}`);
      showToast(msg, "error");
    }
  };

  const deleteOrder = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm("¿Estás seguro de ELIMINAR esta operación?")) {
      try {
        await deleteDoc(doc(db, "orders", id));
        showToast("Operación eliminada");
      } catch (error) {
        console.error("Delete error:", error);
        showToast("Error al eliminar", "error");
      }
    }
  };

  const toggleOrderStatus = async (id: string, currentStatus: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newStatus = currentStatus === 'active' ? 'completed' : 'active';

    try {
      await updateDoc(doc(db, "orders", id), { status: newStatus });
      showToast(newStatus === 'completed' ? "Pedido archivado" : "Pedido restaurado");
    } catch (error) {
      console.error("Toggle status error:", error);
      showToast("Error al actualizar estado", "error");
    }
  };

  const filteredOrders = orders.filter(o => 
    o.status === viewMode &&
    (o.clientName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
     o.clientPhone?.replace(/\D/g, '').includes(searchTerm.replace(/\D/g, '')))
  );

  return (
    <div className="min-h-screen bg-[#F0F4F8] pb-24 font-sans text-slate-900">
      {/* Header */}
      <header className="bg-sublicraft-blue text-white pt-12 pb-8 px-6 rounded-b-[2rem] shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="max-w-5xl mx-auto flex justify-between items-center relative z-10">
          <div>
            <h1 className="text-3xl font-black tracking-tight">SUBLICRAFT</h1>
            <p className="text-white/60 font-medium">Gestor de Operaciones</p>
          </div>
          <div className="flex items-center gap-6">
            <div className="hidden md:flex flex-col items-end">
              <p className="text-[10px] font-black text-white/50 uppercase tracking-widest">Tasa del Día</p>
              <div className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-xl border border-white/10 mt-1">
                <span className="text-xs font-black">BS</span>
                <input 
                  type="number"
                  value={globalExchangeRate || ''}
                  onChange={(e) => setGlobalExchangeRate(Number(e.target.value))}
                  placeholder="0.00"
                  className="bg-transparent text-white font-bold w-16 outline-none text-right"
                />
              </div>
            </div>
            <button 
              onClick={() => setIsCalendarOpen(true)}
              className="bg-white/10 hover:bg-white/20 active:scale-95 transition-all px-6 py-3 rounded-2xl flex items-center gap-2 font-bold tracking-tight border border-white/10"
            >
              <Calendar size={20} />
              <span className="hidden sm:inline">Calendario de Pedidos</span>
            </button>
          </div>
        </div>
      </header>

      {/* Calendar Modal */}
      <AnimatePresence>
        {isCalendarOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCalendarOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-[#F8FAFC] w-full max-w-6xl max-h-[90vh] rounded-[3rem] shadow-2xl relative overflow-hidden flex flex-col"
            >
              <div className="bg-white p-8 border-b border-slate-100 flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
                    <Calendar size={28} />
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-slate-800 tracking-tight">Calendario Semanal</h2>
                    <p className="text-slate-400 font-bold text-xs uppercase tracking-widest">Entregas "En Proceso"</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsCalendarOpen(false)}
                  className="w-12 h-12 bg-slate-50 text-slate-400 rounded-2xl flex items-center justify-center hover:bg-slate-100 transition-colors"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-16 custom-scrollbar">
                {Object.keys(groupedWeeks).length === 0 ? (
                  <div className="text-center py-20">
                    <Calendar className="mx-auto text-slate-200 mb-4" size={64} />
                    <p className="text-slate-400 font-bold italic">No hay pedidos programados.</p>
                  </div>
                ) : (
                  Object.entries(groupedWeeks).sort().map(([weekKey, weekDates]) => {
                    const startOfWeek = new Date(weekKey + 'T12:00:00');
                    const endDate = new Date(startOfWeek);
                    endDate.setDate(startOfWeek.getDate() + 6);
                    
                    const weekTitle = `${startOfWeek.toLocaleDateString('es-VE', { day: 'numeric', month: 'short' })} al ${endDate.toLocaleDateString('es-VE', { day: 'numeric', month: 'short' })}`;

                    return (
                      <div key={weekKey} className="space-y-6">
                        <div className="flex items-center gap-4">
                          <h3 className="text-xl font-black text-slate-800 uppercase tracking-tighter bg-white px-6 py-2 rounded-2xl border border-slate-100 shadow-sm">
                            {weekTitle}
                          </h3>
                        </div>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-7 gap-4">
                          {[0,1,2,3,4,5,6].map(dayOffset => {
                            const currentDay = new Date(startOfWeek);
                            currentDay.setDate(startOfWeek.getDate() + dayOffset);
                            const dateStr = currentDay.toISOString().split('T')[0];
                            const dayOrders = weekDates[dateStr] || [];
                            const isToday = new Date().toISOString().split('T')[0] === dateStr;

                            return (
                              <div key={dateStr} className={cn(
                                "min-h-[200px] rounded-[2rem] p-4 flex flex-col gap-3 transition-all border",
                                isToday ? "bg-blue-50/50 border-blue-200 ring-2 ring-blue-500/10" : "bg-white border-slate-100"
                              )}>
                                <div className="text-center border-b border-slate-50 pb-2">
                                  <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">
                                    {currentDay.toLocaleDateString('es-VE', { weekday: 'short' })}
                                  </p>
                                  <p className={cn("text-lg font-black", isToday ? "text-blue-600" : "text-slate-800")}>
                                    {currentDay.getDate()}
                                  </p>
                                </div>

                                <div className="flex-1 space-y-2 overflow-y-auto max-h-[300px] custom-scrollbar pr-1">
                                  {dayOrders.map(order => (
                                    <button
                                      key={order.id}
                                      onClick={() => {
                                        setIsCalendarOpen(false);
                                        openEditOrder(order);
                                      }}
                                      className="w-full text-left bg-slate-50 hover:bg-white hover:shadow-md hover:border-blue-100 border border-transparent p-3 rounded-xl transition-all group"
                                    >
                                      <p className="text-[10px] font-black text-slate-700 uppercase leading-none truncate group-hover:text-blue-600 transition-colors">
                                        {order.clientName}
                                      </p>
                                      <div className="flex items-center justify-between mt-1.3">
                                        <p className="text-[9px] font-bold text-slate-400">
                                          {order.items.reduce((s, i) => s + i.quantity, 0)} Pzas
                                        </p>
                                        <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                                      </div>
                                    </button>
                                  ))}
                                  {dayOrders.length === 0 && (
                                    <div className="flex-1 flex items-center justify-center opacity-20">
                                      <div className="w-1 h-1 rounded-full bg-slate-200" />
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <main className="max-w-5xl mx-auto px-4 -mt-6 relative z-20">
        {/* View Selection Tabs */}
        <div className="flex gap-2 mb-6 bg-white/50 backdrop-blur-md p-1.5 rounded-[2rem] border border-white/20 w-fit">
          <button 
            onClick={() => setViewMode('active')}
            className={cn(
              "px-8 py-3 rounded-full font-black text-sm uppercase tracking-widest transition-all",
              viewMode === 'active' 
                ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" 
                : "text-slate-400 hover:text-slate-600"
            )}
          >
            En Proceso
          </button>
          <button 
            onClick={() => setViewMode('completed')}
            className={cn(
              "px-8 py-3 rounded-full font-black text-sm uppercase tracking-widest transition-all",
              viewMode === 'completed' 
                ? "bg-green-600 text-white shadow-lg shadow-green-600/20" 
                : "text-slate-400 hover:text-slate-600"
            )}
          >
            Listos
          </button>
        </div>

        {/* Search and Quick Stats */}
        <div className="flex flex-col md:flex-row gap-4 mb-8">
          <div className="flex-1 relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-sublicraft-blue transition-colors" size={20} />
            <input 
              type="text" 
              placeholder="Buscar cliente..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white py-4 pl-12 pr-4 rounded-2xl shadow-sm border border-transparent focus:border-sublicraft-blue focus:ring-4 focus:ring-sublicraft-blue/10 outline-none transition-all font-medium"
            />
          </div>
        </div>

        {/* Order List */}
        <div className="space-y-4">
          <div className="flex justify-between items-center px-2">
            <h2 className="text-lg font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <ShoppingCart size={18} />
              Operaciones Recientes
            </h2>
          </div>

          <AnimatePresence mode="popLayout">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <div className="w-12 h-12 border-4 border-sublicraft-blue border-t-transparent rounded-full animate-spin"></div>
                <p className="text-slate-400 font-bold animate-pulse">Sincronizando base de datos...</p>
              </div>
            ) : filteredOrders.length === 0 ? (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-white/50 border-2 border-dashed border-slate-200 rounded-[2rem] py-20 text-center"
              >
                <div className="bg-slate-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                  <ShoppingCart className="text-slate-400" />
                </div>
                <p className="text-slate-400 font-medium">
                  {searchTerm ? "No se encontraron resultados" : `No hay operaciones ${viewMode === 'active' ? 'en proceso' : 'listas'}`}
                </p>
              </motion.div>
            ) : (
              filteredOrders.map((order) => (
                <OrderCard 
                  key={order.id} 
                  order={order} 
                  onEdit={() => openEditOrder(order)}
                  onStatusToggle={(e) => toggleOrderStatus(order.id, order.status, e)}
                  onDelete={(e) => deleteOrder(order.id, e)}
                />
              ))
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Floating Action Button */}
      <button 
        onClick={openNewOrder}
        className="fixed bottom-8 right-8 w-16 h-16 bg-sublicraft-blue text-white rounded-2xl shadow-2xl shadow-sublicraft-blue/40 flex items-center justify-center active:scale-95 transition-transform z-50 ring-4 ring-white"
      >
        <Plus size={32} />
      </button>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className={cn(
              "fixed bottom-24 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 font-bold text-white",
              toast.type === 'success' ? "bg-green-600" : "bg-red-600"
            )}
          >
            {toast.type === 'success' ? <Check size={20} /> : <X size={20} />}
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isModalOpen && currentOrder && (
          <OrderModal 
            order={currentOrder} 
            onClose={() => setIsModalOpen(false)}
            onSave={saveOrder}
            onChange={setCurrentOrder}
            ordersPerDate={ordersPerDate}
            globalRate={globalExchangeRate}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

interface OrderCardProps {
  order: PurchaseOrder;
  onEdit: () => void;
  onStatusToggle: (e: React.MouseEvent) => void | Promise<void>;
  onDelete: (e: React.MouseEvent) => void | Promise<void>;
}

const OrderCard: React.FC<OrderCardProps> = ({ order, onEdit, onStatusToggle, onDelete }) => {
  const totalItems = order.items?.reduce((sum, item) => sum + item.quantity, 0) || 0;
  const isCompleted = order.status === 'completed';
  const advanceUSD = order.advancePaymentUSD || 0;
  const balanceUSD = order.totalUSD - advanceUSD;

  // Color logic for Balance
  const balanceColor = balanceUSD > 0 
    ? "text-blue-600 bg-blue-50" 
    : balanceUSD === 0 
      ? "text-green-600 bg-green-50" 
      : "text-red-600 bg-red-50";

  const balanceLabel = balanceUSD > 0 
    ? "Deuda" 
    : balanceUSD === 0 
      ? "Saldado" 
      : "Excedente";

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -6 }}
      onClick={onEdit}
      className={cn(
        "bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 cursor-pointer group hover:shadow-2xl hover:shadow-sublicraft-blue/5 transition-all",
        isCompleted && "opacity-80 grayscale-[0.3]"
      )}
    >
      <div className="flex justify-between items-start mb-6">
        <div className="flex gap-6">
          <div className={cn(
            "w-16 h-16 rounded-[1.5rem] flex items-center justify-center text-white shadow-xl transition-transform group-hover:scale-110",
            isCompleted ? "bg-slate-400 shadow-slate-400/20" : "bg-sublicraft-blue shadow-sublicraft-blue/20"
          )}>
            <ShoppingCart size={32} />
          </div>
          <div>
            <h3 className="font-black text-2xl text-slate-800 tracking-tight group-hover:text-sublicraft-blue transition-colors">
              {order.clientName || 'Cliente sin nombre'}
            </h3>
            <p className="text-slate-400 font-bold text-xs uppercase tracking-widest mt-1">
               {order.clientPhone || 'Sin teléfono'} • Orden #{order.orderNumber || order.id.slice(0, 4)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            type="button"
            onClick={(e) => onDelete(e)}
            title="Eliminar Pedido"
            className="p-3 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all flex flex-col items-center gap-1 group/btn"
          >
            <div className="w-12 h-12 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center transition-colors group-hover/btn:border-red-200">
              <Trash2 size={24} />
            </div>
            <span className="text-[10px] font-black uppercase opacity-0 group-hover/btn:opacity-100 transition-opacity">Borrar</span>
          </button>
          <button 
            type="button"
            onClick={(e) => onStatusToggle(e)}
            title={isCompleted ? "Restaurar Pedido" : "Marcar como LISTO"}
            className={cn(
              "p-3 rounded-2xl transition-all flex flex-col items-center gap-1 group/btn",
              isCompleted ? "text-amber-500 hover:bg-amber-50" : "text-slate-300 hover:text-green-600 hover:bg-green-50"
            )}
          >
            <div className={cn(
              "w-12 h-12 rounded-xl border-2 border-dashed flex items-center justify-center transition-colors",
              isCompleted ? "border-amber-200 group-hover/btn:border-amber-300" : "border-slate-200 group-hover/btn:border-green-300"
            )}>
              {isCompleted ? <RotateCcw size={24} /> : <Check size={24} />}
            </div>
            <span className="text-[10px] font-black uppercase opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {isCompleted ? 'Restaurar' : 'Listo'}
            </span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-6 border-y border-slate-50">
        <div className="space-y-1">
          <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Total</p>
          <p className="text-xl font-black text-slate-800">${order.totalUSD.toLocaleString()}</p>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Abonado</p>
          <p className="text-xl font-black text-slate-500">${advanceUSD.toLocaleString()}</p>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">{balanceLabel}</p>
          <p className={cn("text-xl font-black px-3 py-1 rounded-xl w-fit", balanceColor)}>
            ${Math.abs(balanceUSD).toFixed(2)}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Prendas</p>
          <p className="text-xl font-black text-slate-800">{totalItems} Pzas</p>
        </div>
      </div>

      <div className="mt-6 flex justify-between items-center">
        <div className="flex flex-col gap-1">
          <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Fecha de Entrega</p>
          <p className="text-sm font-bold text-slate-600">
            {order.deliveryDate ? new Date(order.deliveryDate + 'T12:00:00').toLocaleDateString('es-VE', { day: 'numeric', month: 'short', weekday: 'long' }) : 'N/A'}
          </p>
        </div>
        <div className="flex items-center gap-2 font-black text-xs text-sublicraft-blue uppercase tracking-widest group-hover:gap-3 transition-all">
          Ver Detalles <ChevronRight size={16} />
        </div>
      </div>
      
      <div className="mt-4 pt-4 border-t border-slate-50">
         <p className="text-xs font-medium italic text-slate-400 truncate">
           {order.description || "Sin descripción adicional"}
         </p>
      </div>
    </motion.div>
  );
}

function OrderModal({ order, onClose, onSave, onChange, ordersPerDate, globalRate }: { 
  order: Partial<PurchaseOrder>, 
  onClose: () => void, 
  onSave: () => void, 
  onChange: (o: Partial<PurchaseOrder>) => void,
  ordersPerDate: Record<string, number>,
  globalRate: number
}) {
  const isReadOnly = order.status === 'completed';
  const [newItem, setNewItem] = useState<Partial<GarmentItem>>({
    garmentType: "",
    quantity: 1,
    size: "M",
    priceUSD: 0
  });

  const totals = useMemo(() => {
    const usd = order.items?.reduce((sum, i) => sum + i.totalUSD, 0) || 0;
    const ves = usd * (order.exchangeRate || 0);
    const totalPaidUSD = order.advancePaymentUSD || 0;
    const totalPaidVES = totalPaidUSD * (order.exchangeRate || 0);
    const debtUSD = usd - totalPaidUSD;
    const debtVES = ves - totalPaidVES;
    return { usd, ves, totalPaidUSD, totalPaidVES, debtUSD, debtVES };
  }, [order.items, order.exchangeRate, order.advancePaymentUSD]);

  const [newPaymentAmount, setNewPaymentAmount] = useState<number>(0);

  const applyNewPayment = () => {
    if (newPaymentAmount === 0) return;
    const currentTotal = order.advancePaymentUSD || 0;
    onChange({ ...order, advancePaymentUSD: currentTotal + newPaymentAmount });
    setNewPaymentAmount(0);
    showToast(`$${newPaymentAmount} agregados al abono`);
  };

  const addItem = () => {
    if (!newItem.garmentType || (!newItem.priceUSD && newItem.priceUSD !== 0)) return;
    
    // Surcharge logic for XL, XXL, XXXL, XXXXL
    const specialSizes = ["XL", "XXL", "XXXL", "XXXXL"];
    const hasSurcharge = specialSizes.some(s => newItem.size?.startsWith(s));
    const basePrice = newItem.priceUSD || 0;
    const finalPrice = hasSurcharge ? basePrice + 1 : basePrice;
    
    const item: GarmentItem = {
      id: Math.random().toString(36).substr(2, 9),
      garmentType: newItem.garmentType,
      quantity: newItem.quantity || 1,
      size: newItem.size || "M",
      priceUSD: finalPrice,
      totalUSD: (newItem.quantity || 1) * finalPrice
    };
    onChange({ ...order, items: [...(order.items || []), item] });
    
    if (hasSurcharge) {
      showToast("Se agregó $1 por talla especial");
    }
    
    setNewItem({ garmentType: "", quantity: 1, size: "M", priceUSD: 0 });
  };

  const removeItem = (id: string) => {
    onChange({ ...order, items: order.items?.filter(i => i.id !== id) });
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-end md:items-center justify-center bg-sublicraft-blue/40 backdrop-blur-md p-4"
    >
      <motion.div 
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        className="bg-white w-full max-w-2xl h-[90vh] md:h-auto md:max-h-[85vh] rounded-t-[3rem] md:rounded-[3rem] shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="p-8 pb-4 flex justify-between items-center border-b border-slate-100">
            <div>
              <h2 className="text-2xl font-black text-sublicraft-blue">
                {isReadOnly ? 'Ver Detalles' : (order.id ? 'Editar Operación' : 'Nueva Operación')}
              </h2>
              <p className="text-slate-400 font-medium">
                {isReadOnly ? 'Pedido finalizado (Lectura)' : 'Completa los detalles de la compra'}
              </p>
            </div>
          <button onClick={onClose} className="w-12 h-12 bg-slate-100 text-slate-500 rounded-2xl flex items-center justify-center">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Cliente / Empresa</label>
                  <input 
                    autoFocus
                    type="text" 
                    placeholder="Nombre..."
                    value={order.clientName}
                    disabled={isReadOnly}
                    onChange={(e) => onChange({ ...order, clientName: e.target.value })}
                    className="w-full bg-slate-50 p-4 rounded-2xl border border-slate-100 focus:border-sublicraft-blue focus:ring-4 focus:ring-sublicraft-blue/5 outline-none font-bold disabled:opacity-60"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Teléfono</label>
                  <input 
                    type="text" 
                    placeholder="0412..."
                    value={order.clientPhone}
                    disabled={isReadOnly}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, ''); // Fix: restrict to numbers
                      onChange({ ...order, clientPhone: val });
                    }}
                    className="w-full bg-slate-50 p-4 rounded-2xl border border-slate-100 focus:border-sublicraft-blue focus:ring-4 focus:ring-sublicraft-blue/5 outline-none font-bold disabled:opacity-60"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex justify-between items-center ml-1">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Tasa de Cambio</label>
                    {!isReadOnly && order.exchangeRate !== globalRate && globalRate > 0 && (
                      <button 
                        onClick={() => onChange({ ...order, exchangeRate: globalRate })}
                        className="text-[10px] font-black text-blue-600 uppercase hover:underline"
                      >
                        Usar Tasa Actual: {globalRate}
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <input 
                      type="number" 
                      placeholder="Eje: 36.5"
                      value={order.exchangeRate || ''}
                      disabled={isReadOnly}
                      onChange={(e) => onChange({ ...order, exchangeRate: e.target.value === '' ? undefined : Number(e.target.value) })}
                      className="w-full bg-slate-50 p-4 pr-12 rounded-2xl border border-slate-100 focus:border-sublicraft-blue focus:ring-4 focus:ring-sublicraft-blue/5 outline-none font-bold disabled:opacity-60"
                    />
                    <DollarSign className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Observaciones / Detalles</label>
                <textarea 
                  placeholder="Detalles adicionales, tela, color..."
                  value={order.description}
                  disabled={isReadOnly}
                  onChange={(e) => onChange({ ...order, description: e.target.value })}
                  className="w-full bg-slate-50 p-4 rounded-2xl border border-slate-100 focus:border-sublicraft-blue focus:ring-4 focus:ring-sublicraft-blue/5 outline-none font-bold min-h-[100px] resize-none disabled:opacity-60"
                />
              </div>
            </div>

            {/* Delivery Date Calendar / Picker */}
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1 flex justify-between items-center">
                <span>Fecha de Entrega</span>
                {order.deliveryDate && ordersPerDate[order.deliveryDate] > 0 && (
                  <span className="text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full text-[10px]">
                    {ordersPerDate[order.deliveryDate]} pedidos ese día
                  </span>
                )}
              </label>
              <div className="p-4 bg-slate-50 border border-slate-100 rounded-[2rem]">
                <input 
                  type="date"
                  value={order.deliveryDate}
                  disabled={isReadOnly}
                  onChange={(e) => onChange({ ...order, deliveryDate: e.target.value })}
                  className="w-full bg-transparent outline-none font-bold text-slate-700 text-lg disabled:opacity-60"
                />
                <div className="mt-4 grid grid-cols-7 gap-1 text-center">
                  {/* Simplified Calendar View for Visual Feedback */}
                  {Array.from({ length: 7 }).map((_, i) => {
                    const today = new Date();
                    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
                    const iso = d.toISOString().split('T')[0];
                    const hasOrders = ordersPerDate[iso];
                    const isSelected = order.deliveryDate === iso;

                    return (
                      <button 
                        key={iso}
                        disabled={isReadOnly}
                        onClick={() => onChange({ ...order, deliveryDate: iso })}
                        className={cn(
                          "p-2 rounded-xl text-[10px] font-bold flex flex-col items-center gap-0.5 transition-all",
                          isSelected ? "bg-sublicraft-blue text-white shadow-lg" : "hover:bg-white text-slate-400",
                          hasOrders && !isSelected && "bg-amber-100 text-amber-700",
                          isReadOnly && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        {d.toLocaleDateString('es', { weekday: 'short' })}
                        <span className="text-sm">{d.getDate()}</span>
                        {hasOrders > 0 && <span className="w-1 h-1 bg-current rounded-full" />}
                      </button>
                    )
                  })}
                  <div className="col-span-7 pt-2 text-[9px] text-slate-400 text-center font-bold uppercase tracking-widest">
                    Próximos 7 días
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Add Item Form - Restored and placed before item list */}
          {!isReadOnly && (
            <div className="bg-slate-50 p-6 rounded-[2.5rem] border border-slate-100 space-y-6">
              <h4 className="font-black text-slate-800 flex items-center gap-2">
                <Plus className="text-sublicraft-blue" size={18} />
                Agregar Prenda
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 {/* Garment Type with Presets */}
                 <div className="space-y-2">
                    <input 
                      list="garments"
                      placeholder="Tipo de prenda..."
                      value={newItem.garmentType}
                      onChange={(e) => setNewItem({ ...newItem, garmentType: e.target.value })}
                      className="w-full bg-white p-4 rounded-xl border border-slate-200 outline-none focus:border-sublicraft-blue font-bold"
                    />
                    <datalist id="garments">
                      {PRESET_GARMENTS.map(g => <option key={g} value={g} />)}
                    </datalist>
                 </div>
                 
                 {/* Size Selector */}
                 <div className="space-y-2">
                    <select 
                      value={newItem.size}
                      onChange={(e) => setNewItem({ ...newItem, size: e.target.value })}
                      className="w-full bg-white p-4 rounded-xl border border-slate-200 outline-none focus:border-sublicraft-blue font-bold appearance-none"
                    >
                      {SIZES.map(s => <option key={s} value={s}>Talla: {s}</option>)}
                    </select>
                 </div>
  
                 <div className="grid grid-cols-2 gap-4 md:col-span-2">
                    <div className="relative">
                      <input 
                        type="number" 
                        placeholder="Precio USD"
                        value={newItem.priceUSD || ''}
                        onChange={(e) => setNewItem({ ...newItem, priceUSD: Number(e.target.value) })}
                        className="w-full bg-white p-4 pl-10 rounded-xl border border-slate-200 outline-none focus:border-sublicraft-blue font-bold"
                      />
                      <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                    </div>
                    <input 
                      type="number" 
                      placeholder="Cant."
                      value={newItem.quantity || ''}
                      onChange={(e) => setNewItem({ ...newItem, quantity: Number(e.target.value) })}
                      className="w-full bg-white p-4 rounded-xl border border-slate-200 outline-none focus:border-sublicraft-blue font-bold"
                    />
                 </div>
              </div>
              <button 
                onClick={addItem}
                disabled={!newItem.garmentType || !newItem.priceUSD}
                className="w-full bg-sublicraft-blue text-white py-4 rounded-2xl font-bold hover:bg-sublicraft-accent disabled:opacity-50 transition-all flex items-center justify-center gap-2"
              >
                <Plus size={20} /> Añadir a la lista
              </button>
            </div>
          )}

          {/* Item List */}
          <div className="space-y-4">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Prendas Agregadas</h4>
            {order.items?.length === 0 ? (
              <p className="text-slate-300 italic text-center py-4">No hay prendas en este pedido.</p>
            ) : (
              <div className="grid gap-3">
                {order.items?.map((item) => (
                  <div key={item.id} className="bg-white border-2 border-slate-50 p-4 rounded-2xl flex justify-between items-center shadow-sm">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center font-black text-slate-500">
                        {item.quantity}
                      </div>
                      <div>
                        <p className="font-bold text-slate-800">{item.garmentType}</p>
                        <p className="text-xs text-slate-400 font-bold">Talla {item.size} • ${item.priceUSD}/ud</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <p className="font-black text-lg text-slate-700">${item.totalUSD}</p>
                      {!isReadOnly && (
                        <button 
                          onClick={() => removeItem(item.id)}
                          className="p-2 text-slate-300 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Totals - Moved here per request */}
          <div className="space-y-6 border-t border-slate-100 pt-8">
            <div className="grid grid-cols-2 gap-4">
              <motion.div 
                animate={{ scale: [1, 1.01, 1] }}
                transition={{ repeat: Infinity, duration: 4 }}
                className="bg-sublicraft-blue p-6 rounded-[2rem] text-white shadow-xl shadow-sublicraft-blue/20"
              >
                <p className="text-[10px] font-black opacity-50 uppercase tracking-widest mb-1">Total Dólares</p>
                <h3 className="text-3xl font-black">${totals.usd.toLocaleString()}</h3>
              </motion.div>
              <div className="bg-white border-4 border-sublicraft-blue/10 p-6 rounded-[2rem] shadow-sm">
                <p className="text-[10px] font-black text-sublicraft-blue/50 uppercase tracking-widest mb-1">Total Bolívares</p>
                <h3 className="text-2xl font-black text-sublicraft-blue">{Math.round(totals.ves).toLocaleString()}</h3>
              </div>
            </div>

              {/* Payment Entry & Balance */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 p-8 rounded-[3rem] border border-slate-100">
                <div className="space-y-4">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="font-black text-slate-800 text-sm tracking-widest uppercase">Gestionar Pagos</h4>
                    <span className="text-[10px] font-black text-slate-400 bg-white px-2 py-0.5 rounded-md border border-slate-100">
                      Pagado: ${totals.totalPaidUSD.toLocaleString()}
                    </span>
                  </div>
                  
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input 
                        type="number" 
                        placeholder="Monto a abonar ahora..."
                        value={newPaymentAmount || ''}
                        disabled={isReadOnly}
                        onChange={(e) => setNewPaymentAmount(Number(e.target.value))}
                        className="w-full bg-white p-4 pl-10 rounded-2xl border border-slate-200 focus:border-blue-500 outline-none font-bold"
                      />
                      <Plus className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500" size={18} />
                    </div>
                    <button
                      onClick={applyNewPayment}
                      disabled={isReadOnly || newPaymentAmount === 0}
                      className="bg-blue-600 text-white px-6 rounded-2xl font-black text-xs uppercase hover:bg-blue-700 disabled:opacity-50 transition-all shadow-lg shadow-blue-600/20"
                    >
                      Añadir
                    </button>
                  </div>
                  
                  {!isReadOnly && totals.debtUSD > 0 && (
                    <button 
                      onClick={() => setNewPaymentAmount(totals.debtUSD)}
                      className="text-[10px] font-black text-blue-600 uppercase tracking-widest hover:underline ml-2"
                    >
                      Pagar deuda total: ${totals.debtUSD.toLocaleString()}
                    </button>
                  )}
                  
                  <div className="pt-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Total Abono Acumulado (Editable)</label>
                    <input 
                      type="number" 
                      value={order.advancePaymentUSD || 0}
                      disabled={isReadOnly}
                      onChange={(e) => onChange({ ...order, advancePaymentUSD: Number(e.target.value) })}
                      className="w-full bg-transparent text-slate-400 p-2 font-bold focus:text-slate-600 outline-none border-b border-transparent focus:border-slate-200 text-xs text-center"
                    />
                  </div>
                </div>

                <div className={cn(
                  "p-6 rounded-[2rem] flex flex-col justify-center",
                  totals.debtUSD > 0 ? "bg-blue-50 border-2 border-blue-100" : 
                  totals.debtUSD === 0 ? "bg-green-50 border-2 border-green-100" :
                  "bg-red-50 border-2 border-red-100"
                )}>
                  <p className={cn(
                    "text-[10px] font-black uppercase tracking-widest mb-2",
                    totals.debtUSD > 0 ? "text-blue-600" : totals.debtUSD === 0 ? "text-green-600" : "text-red-600"
                  )}>
                    {totals.debtUSD > 0 ? 'Monto Restante' : totals.debtUSD === 0 ? 'Completamente Pagado' : 'Saldo a Favor Cliente'}
                  </p>
                  <div className="space-y-1">
                    <p className={cn(
                      "text-3xl font-black",
                      totals.debtUSD > 0 ? "text-blue-800" : totals.debtUSD === 0 ? "text-green-800" : "text-red-800"
                    )}>
                      ${Math.abs(totals.debtUSD).toLocaleString()}
                    </p>
                    <p className={cn(
                      "text-sm font-bold opacity-60",
                      totals.debtUSD > 0 ? "text-blue-800" : totals.debtUSD === 0 ? "text-green-800" : "text-red-800"
                    )}>
                      {Math.round(Math.abs(totals.debtVES)).toLocaleString()} VES
                    </p>
                  </div>
                </div>
              </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-8 bg-slate-50 flex gap-4">
          <button 
            onClick={onClose}
            className="flex-1 bg-white text-slate-500 py-5 rounded-2xl font-bold border border-slate-200 hover:bg-slate-100 transition-colors"
          >
            {isReadOnly ? 'Cerrar' : 'Cancelar'}
          </button>
          {!isReadOnly && (
            <button 
              onClick={onSave}
              className="flex-[2] bg-sublicraft-blue text-white py-5 rounded-2xl font-black text-xl hover:bg-sublicraft-accent shadow-xl shadow-sublicraft-blue/30 active:scale-95 transition-all flex items-center justify-center gap-3"
            >
              <Check size={24} /> Guardar Operación
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// --- Utils ---
// Removed local definition, using import from ./lib/utils

