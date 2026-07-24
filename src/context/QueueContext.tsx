import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Booth, Ticket, PrintSettings, AppsScriptConfig, ActivityLog, ActiveTab, ActivityAction } from '../types';
import { DEFAULT_BOOTHS, DEFAULT_PRINT_SETTINGS, DEFAULT_APPS_SCRIPT_CONFIG, INITIAL_TICKETS, INITIAL_LOGS } from '../data/defaultData';
import { announceQueueVoice } from '../utils/audio';
import { syncToGoogleAppsScript } from '../utils/googleAppsScript';

interface QueueContextType {
  booths: Booth[];
  tickets: Ticket[];
  printSettings: PrintSettings;
  appsScriptConfig: AppsScriptConfig;
  logs: ActivityLog[];
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  selectedTicketForCustomer: Ticket | null;
  setSelectedTicketForCustomer: (ticket: Ticket | null) => void;
  lastCalledTicket: Ticket | null;
  activeTicketToPrint: Ticket | null;
  setActiveTicketToPrint: (ticket: Ticket | null) => void;
  isPrintModalOpen: boolean;
  setIsPrintModalOpen: (open: boolean) => void;

  // Admin Authentication State
  isAdminLoggedIn: boolean;
  loginAdmin: (pin: string) => boolean;
  logoutAdmin: () => void;
  adminPin: string;
  changeAdminPin: (newPin: string) => void;

  // Actions
  callNext: (boothId: string) => Ticket | null;
  printTicket: (boothId: string) => Ticket;
  recallTicket: (ticketId: string) => void;
  completeTicket: (ticketId: string) => void;
  cancelTicket: (ticketId: string) => void;
  deleteTicket: (ticketId: string) => void;
  addBooth: (boothData: { name: string; code: string; avgTimePerSession?: number; themeColor?: string }) => void;
  editBooth: (boothId: string, updated: Partial<Booth>) => void;
  deleteBooth: (boothId: string) => void;
  updatePrintSettings: (settings: Partial<PrintSettings>) => void;
  updateAppsScriptConfig: (config: Partial<AppsScriptConfig>) => void;
  clearTodayLogs: () => void;
  resetQueue: () => void;
  triggerSyncToGoogleSheets: () => Promise<void>;
  
  // Audio state
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
}

const QueueContext = createContext<QueueContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY_BOOTHS = 'photobooth_queue_booths_v1';
const LOCAL_STORAGE_KEY_TICKETS = 'photobooth_queue_tickets_v1';
const LOCAL_STORAGE_KEY_PRINT = 'photobooth_queue_print_v1';
const LOCAL_STORAGE_KEY_SCRIPT = 'photobooth_queue_script_v1';
const LOCAL_STORAGE_KEY_LOGS = 'photobooth_queue_logs_v1';

export const QueueProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [booths, setBooths] = useState<Booth[]>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY_BOOTHS);
    return saved ? JSON.parse(saved) : DEFAULT_BOOTHS;
  });

  const [tickets, setTickets] = useState<Ticket[]>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY_TICKETS);
    return saved ? JSON.parse(saved) : INITIAL_TICKETS;
  });

  const [printSettings, setPrintSettings] = useState<PrintSettings>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY_PRINT);
    return saved ? JSON.parse(saved) : DEFAULT_PRINT_SETTINGS;
  });

  const [appsScriptConfig, setAppsScriptConfig] = useState<AppsScriptConfig>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY_SCRIPT);
    return saved ? JSON.parse(saved) : DEFAULT_APPS_SCRIPT_CONFIG;
  });

  const [logs, setLogs] = useState<ActivityLog[]>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY_LOGS);
    return saved ? JSON.parse(saved) : INITIAL_LOGS;
  });

  // Admin Authentication & PIN state
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState<boolean>(() => {
    return sessionStorage.getItem('photobooth_admin_logged_in') === 'true';
  });

  const [adminPin, setAdminPin] = useState<string>(() => {
    return localStorage.getItem('photobooth_admin_pin') || '1234';
  });

  const loginAdmin = useCallback((inputPin: string): boolean => {
    if (inputPin === adminPin) {
      setIsAdminLoggedIn(true);
      sessionStorage.setItem('photobooth_admin_logged_in', 'true');
      return true;
    }
    return false;
  }, [adminPin]);

  const logoutAdmin = useCallback(() => {
    setIsAdminLoggedIn(false);
    sessionStorage.removeItem('photobooth_admin_logged_in');
  }, []);

  const changeAdminPin = useCallback((newPin: string) => {
    setAdminPin(newPin);
    localStorage.setItem('photobooth_admin_pin', newPin);
  }, []);

  // UI state
  const [activeTab, setActiveTabState] = useState<ActiveTab>('admin');
  const [selectedTicketForCustomer, setSelectedTicketForCustomer] = useState<Ticket | null>(null);
  const [lastCalledTicket, setLastCalledTicket] = useState<Ticket | null>(null);
  const [activeTicketToPrint, setActiveTicketToPrint] = useState<Ticket | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Broadcast Channel for multi-tab sync
  const [broadcastChannel, setBroadcastChannel] = useState<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      const channel = new BroadcastChannel('photobooth_queue_channel');
      setBroadcastChannel(channel);

      channel.onmessage = (event) => {
        const { type, data } = event.data;
        if (type === 'STATE_UPDATE') {
          if (data.booths) setBooths(data.booths);
          if (data.tickets) setTickets(data.tickets);
          if (data.printSettings) setPrintSettings(data.printSettings);
          if (data.appsScriptConfig) setAppsScriptConfig(data.appsScriptConfig);
          if (data.logs) setLogs(data.logs);
          if (data.lastCalledTicket) setLastCalledTicket(data.lastCalledTicket);
        } else if (type === 'CALL_ANNOUNCEMENT') {
          if (soundEnabled && data.ticket && data.boothName) {
            announceQueueVoice(data.ticket.ticketNumber, data.boothName);
          }
        }
      };

      return () => {
        channel.close();
      };
    }
  }, [soundEnabled]);

  // Read URL params on load to detect customer direct link e.g. ?ticket=VIN001 or ?view=customer or #admin
  useEffect(() => {
    const handleUrlChange = () => {
      if (typeof window === 'undefined') return;
      
      const searchParams = new URLSearchParams(window.location.search);
      const rawHash = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase();
      const hashParams = new URLSearchParams(rawHash);

      let viewParam = (searchParams.get('view') || hashParams.get('view')) as ActiveTab | null;
      if (!viewParam && ['admin', 'monitor', 'customer', 'script-guide'].includes(rawHash)) {
        viewParam = rawHash as ActiveTab;
      }

      const ticketParam =
        searchParams.get('ticket') ||
        searchParams.get('t') ||
        searchParams.get('ticketNumber') ||
        searchParams.get('no') ||
        hashParams.get('ticket') ||
        hashParams.get('t');

      if (viewParam && ['admin', 'monitor', 'customer', 'script-guide'].includes(viewParam)) {
        setActiveTabState(viewParam);
      }

      if (ticketParam) {
        const cleanNo = ticketParam.trim().toUpperCase();
        const found = tickets.find((t) => t.ticketNumber.trim().toUpperCase() === cleanNo);
        if (found) {
          setSelectedTicketForCustomer(found);
          setActiveTabState('customer');
          try {
            localStorage.setItem('photobooth_customer_last_ticket_num', found.ticketNumber);
          } catch (e) {
            console.error(e);
          }
        }
      } else if (!selectedTicketForCustomer) {
        // Auto-restore last searched ticket if active
        try {
          const savedNo = localStorage.getItem('photobooth_customer_last_ticket_num');
          if (savedNo) {
            const found = tickets.find((t) => t.ticketNumber.trim().toUpperCase() === savedNo.trim().toUpperCase());
            if (found) {
              setSelectedTicketForCustomer(found);
            }
          }
        } catch (e) {
          console.error(e);
        }
      }
    };

    handleUrlChange();
    window.addEventListener('popstate', handleUrlChange);
    return () => {
      window.removeEventListener('popstate', handleUrlChange);
    };
  }, [tickets, selectedTicketForCustomer]);

  // Save to LocalStorage & broadcast
  const saveAndBroadcast = useCallback(
    (
      newBooths: Booth[],
      newTickets: Ticket[],
      newPrint: PrintSettings,
      newScript: AppsScriptConfig,
      newLogs: ActivityLog[],
      calledTicket?: Ticket | null
    ) => {
      localStorage.setItem(LOCAL_STORAGE_KEY_BOOTHS, JSON.stringify(newBooths));
      localStorage.setItem(LOCAL_STORAGE_KEY_TICKETS, JSON.stringify(newTickets));
      localStorage.setItem(LOCAL_STORAGE_KEY_PRINT, JSON.stringify(newPrint));
      localStorage.setItem(LOCAL_STORAGE_KEY_SCRIPT, JSON.stringify(newScript));
      localStorage.setItem(LOCAL_STORAGE_KEY_LOGS, JSON.stringify(newLogs));

      if (broadcastChannel) {
        broadcastChannel.postMessage({
          type: 'STATE_UPDATE',
          data: {
            booths: newBooths,
            tickets: newTickets,
            printSettings: newPrint,
            appsScriptConfig: newScript,
            logs: newLogs,
            lastCalledTicket: calledTicket ?? lastCalledTicket,
          },
        });
      }
    },
    [broadcastChannel, lastCalledTicket]
  );

  const addLog = useCallback(
    (action: ActivityAction, details: string, boothName?: string, ticketNumber?: string): ActivityLog[] => {
      const newLog: ActivityLog = {
        id: `log-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        date: new Date().toLocaleDateString('id-ID'),
        action,
        details,
        boothName,
        ticketNumber,
      };
      const updatedLogs = [newLog, ...logs];
      setLogs(updatedLogs);
      return updatedLogs;
    },
    [logs]
  );

  // Background Google Apps Script sync
  const triggerSyncToGoogleSheets = useCallback(async () => {
    if (!appsScriptConfig.enabled || !appsScriptConfig.webAppUrl) return;

    setAppsScriptConfig((prev) => ({ ...prev, syncStatus: 'syncing', errorMessage: undefined }));
    const result = await syncToGoogleAppsScript(appsScriptConfig, booths, tickets, logs);

    const nowStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    if (result.success) {
      setAppsScriptConfig((prev) => ({
        ...prev,
        syncStatus: 'success',
        lastSyncTime: nowStr,
      }));
    } else {
      setAppsScriptConfig((prev) => ({
        ...prev,
        syncStatus: 'error',
        errorMessage: result.message,
      }));
    }
  }, [appsScriptConfig, booths, tickets, logs]);

  // Actions implementation
  const callNext = useCallback(
    (boothId: string): Ticket | null => {
      const booth = booths.find((b) => b.id === boothId);
      if (!booth) return null;

      // Find waiting tickets for this booth sorted by sequence
      const waiting = tickets
        .filter((t) => t.boothId === boothId && t.status === 'waiting')
        .sort((a, b) => a.sequence - b.sequence);

      if (waiting.length === 0) return null;

      const ticketToCall = waiting[0];
      const updatedTickets = tickets.map((t) =>
        t.id === ticketToCall.id
          ? {
              ...t,
              status: 'called' as const,
              calledAt: new Date().toISOString(),
            }
          : t
      );

      const updatedBooths = booths.map((b) =>
        b.id === boothId ? { ...b, currentNumber: ticketToCall.sequence } : b
      );

      const calledTicket: Ticket = {
        ...ticketToCall,
        status: 'called',
        calledAt: new Date().toISOString(),
      };

      const updatedLogs = addLog(
        'CALL_NEXT',
        `Memanggil antrian ${ticketToCall.ticketNumber}`,
        booth.name,
        ticketToCall.ticketNumber
      );

      setBooths(updatedBooths);
      setTickets(updatedTickets);
      setLastCalledTicket(calledTicket);

      saveAndBroadcast(updatedBooths, updatedTickets, printSettings, appsScriptConfig, updatedLogs, calledTicket);

      // Play sound
      if (soundEnabled) {
        announceQueueVoice(ticketToCall.ticketNumber, booth.name);
      }

      if (broadcastChannel) {
        broadcastChannel.postMessage({
          type: 'CALL_ANNOUNCEMENT',
          data: {
            ticket: calledTicket,
            boothName: booth.name,
          },
        });
      }

      return calledTicket;
    },
    [booths, tickets, addLog, saveAndBroadcast, printSettings, appsScriptConfig, soundEnabled, broadcastChannel]
  );

  const printTicket = useCallback(
    (boothId: string): Ticket => {
      const booth = booths.find((b) => b.id === boothId);
      if (!booth) throw new Error('Booth not found');

      const nextSeq = booth.totalTickets + 1;
      const formattedSeq = String(nextSeq).padStart(3, '0');
      const ticketNumber = `${booth.code}${formattedSeq}`;

      const newTicket: Ticket = {
        id: `t-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        boothId: booth.id,
        boothName: booth.name,
        boothCode: booth.code,
        ticketNumber,
        sequence: nextSeq,
        status: 'waiting',
        createdAt: new Date().toISOString(),
      };

      const updatedBooths = booths.map((b) =>
        b.id === boothId ? { ...b, totalTickets: nextSeq } : b
      );

      const updatedTickets = [...tickets, newTicket];
      const updatedLogs = addLog(
        'PRINT_TICKET',
        `Mencetak tiket baru ${ticketNumber}`,
        booth.name,
        ticketNumber
      );

      setBooths(updatedBooths);
      setTickets(updatedTickets);
      setActiveTicketToPrint(newTicket);
      setIsPrintModalOpen(true);

      saveAndBroadcast(updatedBooths, updatedTickets, printSettings, appsScriptConfig, updatedLogs);

      return newTicket;
    },
    [booths, tickets, addLog, saveAndBroadcast, printSettings, appsScriptConfig]
  );

  const recallTicket = useCallback(
    (ticketId: string) => {
      const ticket = tickets.find((t) => t.id === ticketId);
      if (!ticket) return;

      if (soundEnabled) {
        announceQueueVoice(ticket.ticketNumber, ticket.boothName);
      }

      const updatedLogs = addLog(
        'RECALL',
        `Memanggil ulang antrian ${ticket.ticketNumber}`,
        ticket.boothName,
        ticket.ticketNumber
      );

      setLastCalledTicket({ ...ticket, calledAt: new Date().toISOString() });
      saveAndBroadcast(booths, tickets, printSettings, appsScriptConfig, updatedLogs, ticket);
    },
    [tickets, soundEnabled, addLog, saveAndBroadcast, booths, printSettings, appsScriptConfig]
  );

  const completeTicket = useCallback(
    (ticketId: string) => {
      const ticket = tickets.find((t) => t.id === ticketId);
      if (!ticket) return;

      const updatedTickets = tickets.map((t) =>
        t.id === ticketId
          ? {
              ...t,
              status: 'completed' as const,
              completedAt: new Date().toISOString(),
            }
          : t
      );

      const updatedLogs = addLog(
        'COMPLETE',
        `Selesai sesi fotobooth ${ticket.ticketNumber}`,
        ticket.boothName,
        ticket.ticketNumber
      );

      setTickets(updatedTickets);
      saveAndBroadcast(booths, updatedTickets, printSettings, appsScriptConfig, updatedLogs);
    },
    [tickets, addLog, saveAndBroadcast, booths, printSettings, appsScriptConfig]
  );

  const cancelTicket = useCallback(
    (ticketId: string) => {
      const ticket = tickets.find((t) => t.id === ticketId);
      if (!ticket) return;

      const updatedTickets = tickets.map((t) =>
        t.id === ticketId ? { ...t, status: 'cancelled' as const } : t
      );

      const updatedLogs = addLog(
        'CANCEL',
        `Membatalkan tiket ${ticket.ticketNumber}`,
        ticket.boothName,
        ticket.ticketNumber
      );

      setTickets(updatedTickets);
      saveAndBroadcast(booths, updatedTickets, printSettings, appsScriptConfig, updatedLogs);
    },
    [tickets, addLog, saveAndBroadcast, booths, printSettings, appsScriptConfig]
  );

  const deleteTicket = useCallback(
    (ticketId: string) => {
      const ticket = tickets.find((t) => t.id === ticketId);
      if (!ticket) return;

      const updatedTickets = tickets.filter((t) => t.id !== ticketId);

      const updatedLogs = addLog(
        'CANCEL',
        `Menghapus antrian ${ticket.ticketNumber}`,
        ticket.boothName,
        ticket.ticketNumber
      );

      setTickets(updatedTickets);
      if (lastCalledTicket?.id === ticketId) {
        setLastCalledTicket(null);
      }
      if (selectedTicketForCustomer?.id === ticketId) {
        setSelectedTicketForCustomer(null);
      }
      saveAndBroadcast(booths, updatedTickets, printSettings, appsScriptConfig, updatedLogs);
    },
    [tickets, addLog, saveAndBroadcast, booths, printSettings, appsScriptConfig, lastCalledTicket, selectedTicketForCustomer]
  );

  const addBooth = useCallback(
    (boothData: { name: string; code: string; avgTimePerSession?: number; themeColor?: string }) => {
      const codeClean = boothData.code.trim().toUpperCase() || 'BTH';
      const colors = ['#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#3B82F6', '#6366F1'];
      const randomColor = colors[booths.length % colors.length];

      const newBooth: Booth = {
        id: `booth-${Date.now()}`,
        name: boothData.name.trim(),
        code: codeClean,
        currentNumber: 0,
        totalTickets: 0,
        status: 'active',
        avgTimePerSession: boothData.avgTimePerSession || 5,
        themeColor: boothData.themeColor || randomColor,
      };

      const updatedBooths = [...booths, newBooth];
      const updatedLogs = addLog('ADD_BOOTH', `Menambah booth baru "${newBooth.name}" (${newBooth.code})`, newBooth.name);

      setBooths(updatedBooths);
      saveAndBroadcast(updatedBooths, tickets, printSettings, appsScriptConfig, updatedLogs);
    },
    [booths, addLog, saveAndBroadcast, tickets, printSettings, appsScriptConfig]
  );

  const editBooth = useCallback(
    (boothId: string, updated: Partial<Booth>) => {
      const updatedBooths = booths.map((b) => (b.id === boothId ? { ...b, ...updated } : b));
      const targetBooth = updatedBooths.find((b) => b.id === boothId);

      const updatedLogs = addLog(
        'EDIT_BOOTH',
        `Mengubah pengaturan booth "${targetBooth?.name || boothId}"`,
        targetBooth?.name
      );

      setBooths(updatedBooths);
      saveAndBroadcast(updatedBooths, tickets, printSettings, appsScriptConfig, updatedLogs);
    },
    [booths, addLog, saveAndBroadcast, tickets, printSettings, appsScriptConfig]
  );

  const deleteBooth = useCallback(
    (boothId: string) => {
      const target = booths.find((b) => b.id === boothId);
      const updatedBooths = booths.filter((b) => b.id !== boothId);
      const updatedLogs = addLog('CANCEL', `Menghapus booth "${target?.name || boothId}"`);

      setBooths(updatedBooths);
      saveAndBroadcast(updatedBooths, tickets, printSettings, appsScriptConfig, updatedLogs);
    },
    [booths, addLog, saveAndBroadcast, tickets, printSettings, appsScriptConfig]
  );

  const updatePrintSettings = useCallback(
    (settings: Partial<PrintSettings>) => {
      const updated = { ...printSettings, ...settings };
      const updatedLogs = addLog('UPDATE_SETTINGS', 'Mengubah pengaturan label cetak tiket');

      setPrintSettings(updated);
      saveAndBroadcast(booths, tickets, updated, appsScriptConfig, updatedLogs);
    },
    [printSettings, addLog, saveAndBroadcast, booths, tickets, appsScriptConfig]
  );

  const updateAppsScriptConfig = useCallback(
    (config: Partial<AppsScriptConfig>) => {
      const updated = { ...appsScriptConfig, ...config };
      const updatedLogs = addLog('UPDATE_SETTINGS', 'Mengubah konfigurasi Google Apps Script');

      setAppsScriptConfig(updated);
      saveAndBroadcast(booths, tickets, printSettings, updated, updatedLogs);
    },
    [appsScriptConfig, addLog, saveAndBroadcast, booths, tickets, printSettings]
  );

  const clearTodayLogs = useCallback(() => {
    setLogs([]);
    saveAndBroadcast(booths, tickets, printSettings, appsScriptConfig, []);
  }, [booths, tickets, printSettings, appsScriptConfig, saveAndBroadcast]);

  const resetQueue = useCallback(() => {
    const resetBooths = booths.map((b) => ({ ...b, currentNumber: 0, totalTickets: 0 }));
    const updatedLogs = addLog('RESET_QUEUE', 'Mereset ulang antrian hari ini ke 0');

    setBooths(resetBooths);
    setTickets([]);
    setLastCalledTicket(null);
    setSelectedTicketForCustomer(null);
    saveAndBroadcast(resetBooths, [], printSettings, appsScriptConfig, updatedLogs, null);
  }, [booths, addLog, saveAndBroadcast, printSettings, appsScriptConfig]);

  const setActiveTab = useCallback((tab: ActiveTab) => {
    setActiveTabState(tab);
    // Update URL query string with pushState so history works
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('view', tab);
      window.history.pushState({}, '', url.toString());
    }
  }, []);

  return (
    <QueueContext.Provider
      value={{
        booths,
        tickets,
        printSettings,
        appsScriptConfig,
        logs,
        activeTab,
        setActiveTab,
        selectedTicketForCustomer,
        setSelectedTicketForCustomer,
        lastCalledTicket,
        activeTicketToPrint,
        setActiveTicketToPrint,
        isPrintModalOpen,
        setIsPrintModalOpen,

        isAdminLoggedIn,
        loginAdmin,
        logoutAdmin,
        adminPin,
        changeAdminPin,

        callNext,
        printTicket,
        recallTicket,
        completeTicket,
        cancelTicket,
        deleteTicket,
        addBooth,
        editBooth,
        deleteBooth,
        updatePrintSettings,
        updateAppsScriptConfig,
        clearTodayLogs,
        resetQueue,
        triggerSyncToGoogleSheets,

        soundEnabled,
        setSoundEnabled,
      }}
    >
      {children}
    </QueueContext.Provider>
  );
};

export const useQueue = () => {
  const context = useContext(QueueContext);
  if (!context) {
    throw new Error('useQueue must be used within a QueueProvider');
  }
  return context;
};
