import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';

export async function readMaintenancePurpose(roomId: string): Promise<string | null> {
  const rows = await db.$queryRaw<Array<{ maintenance_purpose: string | null }>>`
    SELECT maintenance_purpose FROM rooms WHERE id = ${roomId} LIMIT 1
  `;
  return rows[0]?.maintenance_purpose?.trim() || null;
}

export type MaintenancePurposePatch =
  | { action: 'none' }
  | { action: 'set'; value: string }
  | { action: 'clear' };

export async function applyMaintenancePurposePatch(
  roomId: string,
  patch: MaintenancePurposePatch
): Promise<void> {
  if (patch.action === 'none') return;
  if (patch.action === 'clear') {
    await db.$executeRaw`UPDATE rooms SET maintenance_purpose = NULL WHERE id = ${roomId}`;
    return;
  }
  await db.$executeRaw`UPDATE rooms SET maintenance_purpose = ${patch.value} WHERE id = ${roomId}`;
}

export async function attachMaintenancePurposes<T extends { id: string; status: string }>(
  rooms: T[]
): Promise<Array<T & { maintenancePurpose: string | null }>> {
  const maintenanceRoomIds = rooms.filter((room) => room.status === 'MAINTENANCE').map((room) => room.id);
  if (maintenanceRoomIds.length === 0) {
    return rooms.map((room) => ({ ...room, maintenancePurpose: null }));
  }

  const rows = await db.$queryRaw<Array<{ id: string; maintenance_purpose: string | null }>>(
    Prisma.sql`
      SELECT id, maintenance_purpose
      FROM rooms
      WHERE id IN (${Prisma.join(maintenanceRoomIds)})
    `
  );
  const purposeByRoomId = new Map(
    rows.map((row) => [row.id, row.maintenance_purpose?.trim() || null] as const)
  );

  return rooms.map((room) => ({
    ...room,
    maintenancePurpose:
      room.status === 'MAINTENANCE' ? purposeByRoomId.get(room.id) ?? null : null,
  }));
}
