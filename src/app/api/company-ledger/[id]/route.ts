import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse, logActivity } from '@/lib/api-utils';
import { RoleType } from '@prisma/client';
import { getEmailValidationError } from '@/lib/email-validation';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType);
    if (authResult instanceof Response) return authResult;

    const { id } = await params;
    const company = await db.companyLedger.findUnique({
      where: { id },
      include: {
        guests: {
          orderBy: { guestName: 'asc' },
          include: {
            bookings: {
              select: {
                companyLedgerBill: {
                  select: {
                    id: true,
                    dueAmount: true,
                    paidAmount: true,
                    totalAmount: true,
                  },
                },
              },
            },
          },
        },
        bills: { orderBy: { billedAt: 'desc' } },
        _count: { select: { guests: true, bills: true } },
      },
    });

    if (!company) return notFoundResponse('Company ledger');

    const guests = company.guests.map(({ bookings, ...guest }) => ({
      ...guest,
      totalDue: bookings.reduce(
        (sum, booking) => sum + (booking.companyLedgerBill?.dueAmount ?? 0),
        0
      ),
    }));

    return successResponse({ ...company, guests });
  } catch (error) {
    console.error('Company ledger get error:', error);
    return errorResponse('Failed to fetch company', 500);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await db.companyLedger.findUnique({ where: { id } });
    if (!existing) return notFoundResponse('Company ledger');

    const authResult = existing.isSystem
      ? await requireRole(request, 'ADMIN' as RoleType)
      : await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType);
    if (authResult instanceof Response) return authResult;

    const body = await request.json();
    const name = body?.name !== undefined ? String(body.name).trim() : existing.name;
    if (!name) return errorResponse('Company name is required');

    if (body?.email !== undefined) {
      const emailError = getEmailValidationError(body.email, true);
      if (emailError) return errorResponse(emailError);
    }

    const company = await db.companyLedger.update({
      where: { id },
      data: {
        name,
        contactPerson:
          body?.contactPerson !== undefined
            ? body.contactPerson?.trim() || null
            : existing.contactPerson,
        phone: body?.phone !== undefined ? body.phone?.trim() || null : existing.phone,
        email: body?.email !== undefined ? body.email?.trim() || null : existing.email,
        address: body?.address !== undefined ? body.address?.trim() || null : existing.address,
        notes: body?.notes !== undefined ? body.notes?.trim() || null : existing.notes,
        active: body?.active !== undefined ? body.active !== false : existing.active,
      },
      include: {
        guests: { orderBy: { guestName: 'asc' } },
        bills: { orderBy: { billedAt: 'desc' }, take: 50 },
        _count: { select: { guests: true, bills: true } },
      },
    });

    await logActivity(
      authResult.id,
      'UPDATE',
      'company-ledger',
      JSON.stringify({ companyLedgerId: id, name: company.name })
    );

    return successResponse(company, 'Company updated');
  } catch (error) {
    console.error('Company ledger update error:', error);
    return errorResponse('Failed to update company', 500);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType);
    if (authResult instanceof Response) return authResult;

    const { id } = await params;
    const existing = await db.companyLedger.findUnique({ where: { id } });
    if (!existing) return notFoundResponse('Company ledger');
    if (existing.isSystem) {
      return errorResponse('System ledgers cannot be deleted', 403);
    }

    if ((existing.dueAmount ?? 0) > 0.009) {
      return errorResponse(
        `Cannot delete company with outstanding balance (৳${existing.dueAmount.toFixed(2)} due). Settle all bills first.`,
        400
      );
    }

    const openBills = await db.companyLedgerBill.count({
      where: { companyLedgerId: id, dueAmount: { gt: 0.009 } },
    });
    if (openBills > 0) {
      return errorResponse(
        'Cannot delete company while open bills exist. Settle or clear all dues first.',
        400
      );
    }

    await db.companyLedger.delete({ where: { id } });

    await logActivity(
      authResult.id,
      'DELETE',
      'company-ledger',
      JSON.stringify({ companyLedgerId: id, name: existing.name })
    );

    return successResponse(null, 'Company removed from ledger');
  } catch (error) {
    console.error('Company ledger delete error:', error);
    return errorResponse('Failed to delete company', 500);
  }
}
