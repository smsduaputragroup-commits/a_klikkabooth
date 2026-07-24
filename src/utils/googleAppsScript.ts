import { Booth, Ticket, ActivityLog, AppsScriptConfig } from '../types';

export async function syncToGoogleAppsScript(
  config: AppsScriptConfig,
  booths: Booth[],
  tickets: Ticket[],
  logs: ActivityLog[]
): Promise<{ success: boolean; message: string }> {
  if (!config.enabled || !config.webAppUrl) {
    return { success: false, message: 'Google Apps Script belum diaktifkan atau URL belum diisi' };
  }

  try {
    const payload = {
      action: 'syncAll',
      booths,
      tickets,
      logs: logs.slice(0, 50), // sync latest 50 logs
    };

    // Google Apps Script requires no-cors or standard redirect handling
    const response = await fetch(config.webAppUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP Error status: ${response.status}`);
    }

    const data = await response.json().catch(() => ({ status: 'success' }));
    return {
      success: true,
      message: data.message || 'Berhasil sinkronisasi dengan Google Sheets',
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Gagal menghubungi Apps Script';
    console.error('Apps Script Sync error:', err);
    return {
      success: false,
      message: `Error: ${errorMessage}. Pastikan Web App diset ke 'Anyone'.`,
    };
  }
}

export async function fetchFromGoogleAppsScript(
  config: AppsScriptConfig
): Promise<{ success: boolean; booths?: Booth[]; tickets?: Ticket[]; logs?: ActivityLog[]; message?: string }> {
  if (!config.enabled || !config.webAppUrl) {
    return { success: false, message: 'Google Apps Script belum aktif' };
  }

  try {
    const url = `${config.webAppUrl}?action=getQueue&t=${Date.now()}`;
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`HTTP Error status: ${response.status}`);
    }
    const data = await response.json();
    if (data && data.status === 'success') {
      const parsedBooths = Array.isArray(data.booths)
        ? data.booths.map((b: Record<string, unknown>) => ({
            ...b,
            currentNumber: Number(b.currentNumber || 0),
            totalTickets: Number(b.totalTickets || 0),
            avgTimePerSession: Number(b.avgTimePerSession || 5),
          }))
        : [];

      const parsedTickets = Array.isArray(data.tickets)
        ? data.tickets.map((t: Record<string, unknown>) => ({
            ...t,
            sequence: Number(t.sequence || 0),
          }))
        : [];

      const parsedLogs = Array.isArray(data.logs)
        ? data.logs.map((l: Record<string, unknown>) => ({
            id: String(l.id || `log-${Date.now()}`),
            timestamp: String(l.timestamp || ''),
            date: String(l.date || ''),
            action: String(l.action || 'UPDATE_SETTINGS') as any,
            details: String(l.details || ''),
            boothName: l.boothName ? String(l.boothName) : undefined,
            ticketNumber: l.ticketNumber ? String(l.ticketNumber) : undefined,
          }))
        : [];

      return {
        success: true,
        booths: parsedBooths as Booth[],
        tickets: parsedTickets as Ticket[],
        logs: parsedLogs as ActivityLog[],
      };
    }
    return { success: false, message: 'Data tidak valid dari Google Sheets' };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Gagal mengambil data dari Apps Script';
    console.error('Fetch Google Apps Script Error:', err);
    return { success: false, message: errorMessage };
  }
}

