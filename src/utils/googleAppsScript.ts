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
