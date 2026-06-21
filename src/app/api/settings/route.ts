import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse, logActivity } from '@/lib/api-utils';
import {
  getSettingDefinition,
  groupSettings,
  mergeSettingsWithDefaults,
} from '@/lib/app-settings';
import {
  checkoutHourFromTime,
  normalizeTimeHHmm,
  parseTimeHHmm,
} from '@/lib/hotel-times';

// GET /api/settings - List all settings (ADMIN only)
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN');
    if (authResult instanceof Response) return authResult;

    const dbSettings = await db.setting.findMany({
      orderBy: [{ group: 'asc' }, { key: 'asc' }],
    });

    const settings = mergeSettingsWithDefaults(dbSettings);
    const grouped = groupSettings(settings);

    return successResponse({
      settings,
      grouped,
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    return errorResponse('Failed to fetch settings', 500);
  }
}

// PUT /api/settings - Update settings (ADMIN only)
export async function PUT(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN');
    if (authResult instanceof Response) return authResult;

    const user = authResult;
    const body = await request.json();

    // Accept single { key, value } or array of updates
    const updates: Array<{ key: string; value: string }> = Array.isArray(body) ? body : [body];

    if (updates.length === 0) {
      return errorResponse('No updates provided');
    }

    // Validate each update
    for (const update of updates) {
      if (!update.key || update.value === undefined || update.value === null) {
        return errorResponse('Each update must have key and value');
      }
      const def = getSettingDefinition(update.key);
      const isTimeKey = def?.inputType === 'time' || update.key.endsWith('_time');
      if (isTimeKey) {
        const raw = String(update.value).trim();
        if (!raw) {
          return errorResponse(`${def?.label ?? update.key} is required`);
        }
        if (!parseTimeHHmm(raw)) {
          return errorResponse(
            `${def?.label ?? update.key} must be a valid time (HH:mm)`
          );
        }
        update.value = normalizeTimeHHmm(raw, def?.value ?? '12:00');
      }
      if (def?.inputType === 'number') {
        const parsed = parseFloat(String(update.value));
        if (Number.isNaN(parsed) || parsed < 0) {
          return errorResponse(`${def.label} must be a valid non-negative number`);
        }
        if (update.key.includes('percent') && parsed > 100) {
          return errorResponse(`${def.label} cannot exceed 100%`);
        }
        if (update.key === 'late_checkout_hours' && parsed > 23) {
          return errorResponse('Standard checkout hour must be between 0 and 23');
        }
      }
    }

    const checkOutUpdate = updates.find((u) => u.key === 'check_out_time');
    if (checkOutUpdate) {
      const hour = checkoutHourFromTime(checkOutUpdate.value);
      const legacy = updates.find((u) => u.key === 'late_checkout_hours');
      if (legacy) {
        legacy.value = String(hour);
      } else {
        updates.push({ key: 'late_checkout_hours', value: String(hour) });
      }
    }

    const results = [];

    for (const update of updates) {
      const def = getSettingDefinition(update.key);
      const trimmed = String(update.value).trim();
      const saved = await db.setting.upsert({
        where: { key: update.key },
        update: { value: trimmed },
        create: {
          key: update.key,
          value: trimmed,
          group: def?.group || guessGroup(update.key),
        },
      });
      results.push(saved);
    }

    // Log activity
    await logActivity(
      user.id,
      'SETTINGS_UPDATED',
      'admin',
      JSON.stringify({
        updatedKeys: updates.map((u) => u.key),
        count: updates.length,
      })
    );

    return successResponse(results, 'Settings updated successfully');
  } catch (error) {
    console.error('Error updating settings:', error);
    return errorResponse('Failed to update settings', 500);
  }
}

// Helper to guess the group from a setting key
function guessGroup(key: string): string {
  const def = getSettingDefinition(key);
  if (def) return def.group;
  if (
    key.startsWith('hotel_') ||
    key.startsWith('room_') ||
    key === 'vat_percent' ||
    key.startsWith('late_checkout') ||
    key.startsWith('early_checkout') ||
    key === 'check_in_time' ||
    key === 'check_out_time'
  ) {
    return 'hotel';
  }
  if (key.startsWith('restaurant_') || key.startsWith('menu_')) return 'restaurant';
  if (key.startsWith('vat_') || key.startsWith('tax_') || key.startsWith('invoice_')) return 'billing';
  if (key.startsWith('payment_')) return 'payment';
  return 'general';
}
