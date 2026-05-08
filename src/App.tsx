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
  Check
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
  createdAt: Timestamp;
  deliveryDate: string; // YYYY-MM-DD
  description: string;
  exchangeRate: number;
  totalUSD: number;
  totalVES: number;
  status: 'active' | 'completed' | 'draft';
  clientName: string;
  items: GarmentItem[];
}

interface Toast {
  message: string;
  type: 'success' | 'error';
}

// --- Constants ---

const SIZES = [
  "2", "4", "6", "8", "10", "12", "14", "16",
  "XS/C", "S/C", "M/C", "L/C", "XL/C", "XXL/C", "XXXL/C", 
  "XS/D", "S/D", "M/D", "L/D", "XL/D", "XXL/D", "XXXL/D"
];

const PRESET_GARMENTS = [
  "Franela", "Sudadera", "Chaleco", "Chaqueta", "Polo"
];

// --- Components ---

function handleFirestoreError(error: any) {
  console.error("Firestore Error:", error);
  if (error?.code === 'permission-denied') {
    return "Error de permisos: Verifica los datos o tu conexión.";
  }
  return error?.message || "Ocurrió un error inesperado";
}

export default function App() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<Partial<PurchaseOrder> | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [globalExchangeRate, setGlobalExchangeRate] = useState<number>(36.5);
  const [toast, setToast] = useState<Toast | null>(null);

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

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Firestore Listener
  useEffect(() => {
    const q = query(collection(db, "orders"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ordersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as PurchaseOrder[];
      setOrders(ordersData);
    }, (error) => {
      console.error("Snapshot error:", error);
    });
    return unsubscribe;
  }, []);

  const openNewOrder = () => {
    setCurrentOrder({
      clientName: "",
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

    try {
      const items = currentOrder.items || [];
      const totalUSD = items.reduce((sum, item) => sum + item.totalUSD, 0);
      const exchangeRate = currentOrder.exchangeRate || globalExchangeRate;
      const totalVES = totalUSD * exchangeRate;

      const data = {
        clientName: currentOrder.clientName || "Cliente sin nombre",
        description: currentOrder.description || "",
        items: items,
        deliveryDate: currentOrder.deliveryDate || new Date().toISOString().split('T')[0],
        status: currentOrder.status || 'active',
        exchangeRate: exchangeRate,
        totalUSD: totalUSD,
        totalVES: totalVES,
      };

      if (currentOrder.id) {
        // Update: do NOT overwrite createdAt
        const { id, createdAt, ...updateData } = { ...data, createdAt: currentOrder.createdAt } as any;
        await updateDoc(doc(db, "orders", currentOrder.id), updateData);
        showToast("Operación actualizada correctamente");
      } else {
        // Create
        await addDoc(collection(db, "orders"), {
          ...data,
          createdAt: serverTimestamp()
        });
        showToast("Operación guardada con éxito");
      }
      setIsModalOpen(false);
      setCurrentOrder(null);
    } catch (error) {
      const msg = handleFirestoreError(error);
      showToast(msg, "error");
    }
  };

  const deleteOrder = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("¿Estás seguro de eliminar esta operación?")) {
      await deleteDoc(doc(db, "orders", id));
    }
  };

  const filteredOrders = orders.filter(o => 
    o.clientName?.toLowerCase().includes(searchTerm.toLowerCase())
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
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 -mt-6 relative z-20">
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
            {filteredOrders.length === 0 ? (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-white/50 border-2 border-dashed border-slate-200 rounded-[2rem] py-20 text-center"
              >
                <div className="bg-slate-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Plus className="text-slate-400" />
                </div>
                <p className="text-slate-400 font-medium">No hay operaciones que coincidan.</p>
              </motion.div>
            ) : (
              filteredOrders.map((order) => (
                <OrderCard 
                  key={order.id} 
                  order={order} 
                  onEdit={() => openEditOrder(order)}
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
          />
        )}
      </AnimatePresence>
    </div>
  );
}

interface OrderCardProps {
  order: PurchaseOrder;
  onEdit: () => void;
  onDelete: (e: React.MouseEvent) => void | Promise<void>;
}

const OrderCard: React.FC<OrderCardProps> = ({ order, onEdit, onDelete }) => {
  const totalItems = order.items?.reduce((sum, item) => sum + item.quantity, 0) || 0;
  const advanceUSD = order.totalUSD * 0.5;

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -6 }}
      onClick={onEdit}
      className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 cursor-pointer group hover:shadow-2xl hover:shadow-sublicraft-blue/5 transition-all"
    >
      <div className="flex justify-between items-start mb-6">
        <div className="flex gap-6">
          <div className="w-16 h-16 bg-sublicraft-blue rounded-[1.5rem] flex items-center justify-center text-white shadow-xl shadow-sublicraft-blue/20 group-hover:scale-110 transition-transform">
            <ShoppingCart size={32} />
          </div>
          <div>
            <h3 className="font-black text-2xl text-slate-800 tracking-tight group-hover:text-sublicraft-blue transition-colors">
              {order.clientName || 'Cliente sin nombre'}
            </h3>
            <p className="text-slate-400 font-bold text-xs uppercase tracking-widest mt-1">
               Ref: {order.id.slice(0, 8).toUpperCase()}
            </p>
          </div>
        </div>
        <button 
          onClick={onDelete}
          className="p-3 text-slate-200 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all"
        >
          <Trash2 size={24} />
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-6 border-y border-slate-50">
        <div className="space-y-1">
          <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Prendas</p>
          <p className="text-xl font-black text-slate-700">{totalItems} Total</p>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-black text-sublicraft-blue/30 uppercase tracking-widest">Precio Total</p>
          <p className="text-xl font-black text-sublicraft-blue">${order.totalUSD.toLocaleString()}</p>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-black text-amber-500/40 uppercase tracking-widest">Abono 50%</p>
          <p className="text-xl font-black text-amber-600">${advanceUSD.toLocaleString()}</p>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Entrega</p>
          <p className="text-sm font-bold text-slate-600">
             {order.deliveryDate ? new Date(order.deliveryDate + 'T12:00:00').toLocaleDateString('es-VE', { day: 'numeric', month: 'short' }) : 'N/A'}
          </p>
        </div>
      </div>
      
      <div className="mt-6 flex justify-between items-center text-slate-400">
         <p className="text-xs font-medium italic truncate max-w-[200px]">
           {order.description || "Sin descripción adicional"}
         </p>
         <div className="flex items-center gap-2 font-black text-xs text-sublicraft-blue uppercase tracking-widest group-hover:gap-3 transition-all">
           Ver Detalles <ChevronRight size={16} />
         </div>
      </div>
    </motion.div>
  );
}

function OrderModal({ order, onClose, onSave, onChange, ordersPerDate }: { 
  order: Partial<PurchaseOrder>, 
  onClose: () => void, 
  onSave: () => void, 
  onChange: (o: Partial<PurchaseOrder>) => void,
  ordersPerDate: Record<string, number>
}) {
  const [newItem, setNewItem] = useState<Partial<GarmentItem>>({
    garmentType: "",
    quantity: 1,
    size: "M",
    priceUSD: 0
  });

  const totals = useMemo(() => {
    const usd = order.items?.reduce((sum, i) => sum + i.totalUSD, 0) || 0;
    const ves = usd * (order.exchangeRate || 1);
    return { usd, ves, advanceUSD: usd * 0.5, advanceVES: ves * 0.5 };
  }, [order.items, order.exchangeRate]);

  const addItem = () => {
    if (!newItem.garmentType || !newItem.priceUSD) return;
    const item: GarmentItem = {
      id: Math.random().toString(36).substr(2, 9),
      garmentType: newItem.garmentType,
      quantity: newItem.quantity || 1,
      size: newItem.size || "M",
      priceUSD: newItem.priceUSD,
      totalUSD: (newItem.quantity || 1) * newItem.priceUSD
    };
    onChange({ ...order, items: [...(order.items || []), item] });
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
            <h2 className="text-2xl font-black text-sublicraft-blue">{order.id ? 'Editar Operación' : 'Nueva Operación'}</h2>
            <p className="text-slate-400 font-medium">Completa los detalles de la compra</p>
          </div>
          <button onClick={onClose} className="w-12 h-12 bg-slate-100 text-slate-500 rounded-2xl flex items-center justify-center">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Cliente / Empresa</label>
                <input 
                  autoFocus
                  type="text" 
                  placeholder="Nombre del cliente..."
                  value={order.clientName}
                  onChange={(e) => onChange({ ...order, clientName: e.target.value })}
                  className="w-full bg-slate-50 p-4 rounded-2xl border border-slate-100 focus:border-sublicraft-blue focus:ring-4 focus:ring-sublicraft-blue/5 outline-none font-bold"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Descripción de la Compra</label>
                <textarea 
                  placeholder="Detalles adicionales, tela, color..."
                  value={order.description}
                  onChange={(e) => onChange({ ...order, description: e.target.value })}
                  className="w-full bg-slate-50 p-4 rounded-2xl border border-slate-100 focus:border-sublicraft-blue focus:ring-4 focus:ring-sublicraft-blue/5 outline-none font-bold min-h-[100px] resize-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Tasa de Cambio (VES)</label>
                <div className="relative">
                  <input 
                    type="number" 
                    value={order.exchangeRate}
                    onChange={(e) => onChange({ ...order, exchangeRate: Number(e.target.value) })}
                    className="w-full bg-slate-50 p-4 pr-12 rounded-2xl border border-slate-100 focus:border-sublicraft-blue focus:ring-4 focus:ring-sublicraft-blue/5 outline-none font-bold"
                  />
                  <DollarSign className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                </div>
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
                  onChange={(e) => onChange({ ...order, deliveryDate: e.target.value })}
                  className="w-full bg-transparent outline-none font-bold text-slate-700 text-lg"
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
                        onClick={() => onChange({ ...order, deliveryDate: iso })}
                        className={cn(
                          "p-2 rounded-xl text-[10px] font-bold flex flex-col items-center gap-0.5 transition-all",
                          isSelected ? "bg-sublicraft-blue text-white shadow-lg" : "hover:bg-white text-slate-400",
                          hasOrders && !isSelected && "bg-amber-100 text-amber-700"
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
                      <button 
                        onClick={() => removeItem(item.id)}
                        className="p-2 text-slate-300 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Totals - Moved here per request */}
          <div className="space-y-4 border-t border-slate-100 pt-8">
            <div className="grid grid-cols-2 gap-4">
              <motion.div 
                animate={{ scale: [1, 1.02, 1] }}
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

            {/* Advance Payment Info (50%) */}
            <div className="bg-amber-50 border-2 border-dashed border-amber-200 p-6 rounded-[2.5rem]">
              <div className="flex justify-between items-center mb-4">
                <h4 className="font-black text-amber-800 text-sm tracking-widest uppercase">Abono del 50%</h4>
                <div className="bg-amber-200 text-amber-900 px-3 py-1 rounded-full text-[10px] font-black">REQUERIDO</div>
              </div>
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <p className="text-[10px] font-bold text-amber-600 uppercase">En Dólares</p>
                  <p className="text-xl font-black text-amber-900">${totals.advanceUSD.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-amber-600 uppercase">En Bolívares</p>
                  <p className="text-xl font-black text-amber-900">{Math.round(totals.advanceVES).toLocaleString()} VES</p>
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
            Cancelar
          </button>
          <button 
            onClick={onSave}
            className="flex-[2] bg-sublicraft-blue text-white py-5 rounded-2xl font-black text-xl hover:bg-sublicraft-accent shadow-xl shadow-sublicraft-blue/30 active:scale-95 transition-all flex items-center justify-center gap-3"
          >
            <Check size={24} /> Guardar Operación
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// --- Utils ---
// Removed local definition, using import from ./lib/utils

