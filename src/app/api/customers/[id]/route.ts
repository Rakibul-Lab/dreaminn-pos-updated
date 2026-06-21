import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireHotelAccess, requireRole } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse, logActivity } from '@/lib/api-utils';
import { findCustomerByPhone } from '@/lib/customer-phone';
import { isValidPhone, normalizePhone, phonesMatch } from '@/lib/phone';
import { RoleType } from '@prisma/client';
import { getEmailValidationError } from '@/lib/email-validation';
import { ensureCustomerRegistrationNumber } from '@/lib/guest-registration-number';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireHotelAccess(request);
    if (authResult instanceof Response) return authResult;

    const { id } = await params;

    const customer = await db.customer.findUnique({
      where: { id },
      include: {
        bookings: {
          include: {
            room: { include: { type: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!customer) {
      return notFoundResponse('Customer');
    }

    return successResponse(customer);
  } catch (error) {
    console.error('Customer fetch error:', error);
    return errorResponse('Failed to fetch customer', 500);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType);
    if (authResult instanceof Response) return authResult;

    const { id } = await params;
    const body = await request.json();

    const existing = await db.customer.findUnique({ where: { id } });
    if (!existing) {
      return notFoundResponse('Customer');
    }

    if (body.email !== undefined) {
      const emailError = getEmailValidationError(body.email, true);
      if (emailError) return errorResponse(emailError);
    }

    if (body.phone !== undefined) {
      if (!isValidPhone(body.phone)) {
        return errorResponse('Please enter a valid phone number (at least 10 digits)');
      }
      if (!phonesMatch(body.phone, existing.phone)) {
        const duplicate = await findCustomerByPhone(body.phone);
        if (duplicate && duplicate.id !== id) {
          return errorResponse('Customer with this phone number already exists');
        }
      }
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.company !== undefined) updateData.company = body.company?.trim() || null;
    if (body.email !== undefined) updateData.email = body.email;
    if (body.phone !== undefined) updateData.phone = normalizePhone(body.phone);
    if (body.address !== undefined) updateData.address = body.address;
    if (body.idType !== undefined) updateData.idType = body.idType;
    if (body.idNumber !== undefined) updateData.idNumber = body.idNumber;
    if (body.visaExpiryDate !== undefined) {
      updateData.visaExpiryDate = body.visaExpiryDate?.trim() || null;
    }
    if (body.registrationNumber !== undefined) {
      updateData.registrationNumber = body.registrationNumber?.trim() || null;
    }
    if (body.nationality !== undefined) updateData.nationality = body.nationality?.trim() || null;
    if (body.designation !== undefined) {
      updateData.designation = body.designation?.trim() || null;
    }
    if (body.dateOfBirth !== undefined) updateData.dateOfBirth = body.dateOfBirth;
    if (body.idDocPath !== undefined) updateData.idDocPath = body.idDocPath;
    if (body.notes !== undefined) updateData.notes = body.notes;

    const customer = await db.customer.update({
      where: { id },
      data: updateData,
    });

    if (!customer.registrationNumber?.trim()) {
      await ensureCustomerRegistrationNumber(id);
    }

    await logActivity(
      authResult.id,
      'UPDATE_CUSTOMER',
      'hotel',
      JSON.stringify({ customerId: id, changes: updateData })
    );

    const refreshed = await db.customer.findUnique({ where: { id } });
    return successResponse(refreshed ?? customer, 'Customer updated successfully');
  } catch (error) {
    console.error('Customer update error:', error);
    return errorResponse('Failed to update customer', 500);
  }
}
