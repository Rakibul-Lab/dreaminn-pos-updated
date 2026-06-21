import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireHotelAccess, requireRole } from '@/lib/auth';
import { successResponse, paginatedResponse, errorResponse, logActivity } from '@/lib/api-utils';
import { findCustomerByPhone } from '@/lib/customer-phone';
import { normalizePhone, isValidPhone } from '@/lib/phone';
import {
  buildGuestStayOverlapWhere,
  parseStayDateRange,
  pickGuestStayBooking,
} from '@/lib/guest-stay-date-filter';
import { Prisma, RoleType } from '@prisma/client';
import { getEmailValidationError } from '@/lib/email-validation';
import {
  ensureCustomerRegistrationNumber,
  generateGuestRegistrationNumber,
} from '@/lib/guest-registration-number';

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireHotelAccess(request);
    if (authResult instanceof Response) return authResult;

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search');
    const name = searchParams.get('name');
    const phone = searchParams.get('phone');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    const skip = (page - 1) * limit;

    const where: Prisma.CustomerWhereInput = {};

    const orConditions: Record<string, unknown>[] = [];
    if (search) {
      orConditions.push(
        { name: { contains: search } },
        { phone: { contains: search } },
        { email: { contains: search } },
        { address: { contains: search } },
        { idNumber: { contains: search } },
        { nationality: { contains: search } },
        { registrationNumber: { contains: search } },
        {
          bookings: {
            some: {
              OR: [
                { registrationNumber: { contains: search } },
                { sourceReservationEntry: { registrationNumber: { contains: search } } },
                { companyLedgerGuest: { registrationNumber: { contains: search } } },
              ],
            },
          },
        }
      );
      const searchDigits = search.replace(/\D/g, '');
      if (searchDigits.length >= 6) {
        orConditions.push({ phone: { contains: searchDigits.slice(-10) } });
      }
    }
    if (name) {
      orConditions.push({ name: { contains: name } });
    }
    if (phone) {
      orConditions.push({ phone: { contains: phone } });
      const phoneDigits = phone.replace(/\D/g, '');
      if (phoneDigits.length >= 6) {
        orConditions.push({ phone: { contains: phoneDigits.slice(-10) } });
      }
    }

    if (orConditions.length > 0) {
      where.OR = orConditions;
    }

    const stayOverlapFilter = buildGuestStayOverlapWhere(dateFrom, dateTo);
    if (stayOverlapFilter && !search) {
      where.bookings = { some: stayOverlapFilter };
    }

    const [customers, total] = await Promise.all([
      db.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      db.customer.count({ where }),
    ]);

    const customerIds = customers.map((c) => c.id);
    const bookings =
      customerIds.length > 0
        ? await db.booking.findMany({
            where: { customerId: { in: customerIds } },
            select: {
              customerId: true,
              checkIn: true,
              checkOut: true,
              actualCheckIn: true,
              actualCheckOut: true,
              status: true,
              room: { select: { roomNumber: true } },
            },
            orderBy: { checkIn: 'desc' },
          })
        : [];

    const bookingsByCustomer = new Map<string, typeof bookings>();
    for (const booking of bookings) {
      const list = bookingsByCustomer.get(booking.customerId) ?? [];
      list.push(booking);
      bookingsByCustomer.set(booking.customerId, list);
    }

    const hasStayDateFilter = !!parseStayDateRange(dateFrom, dateTo);

    const enriched = customers.map((customer) => {
      const list = bookingsByCustomer.get(customer.id) ?? [];
      const stay = pickGuestStayBooking(list, dateFrom, dateTo, hasStayDateFilter);
      return {
        ...customer,
        stay: stay
          ? {
              checkIn: stay.checkIn,
              checkOut: stay.checkOut,
              actualCheckIn: stay.actualCheckIn,
              actualCheckOut: stay.actualCheckOut,
              status: stay.status,
              roomNumber: stay.room?.roomNumber ?? null,
            }
          : null,
      };
    });

    return paginatedResponse(enriched, total, page, limit);
  } catch (error) {
    console.error('Customers list error:', error);
    return errorResponse('Failed to fetch customers', 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType);
    if (authResult instanceof Response) return authResult;

    const body = await request.json();
    const {
      name,
      company,
      email,
      phone,
      address,
      idType,
      idNumber,
      visaExpiryDate,
      registrationNumber,
      nationality,
      dateOfBirth,
      idDocPath,
      notes,
      designation,
    } = body;

    if (!name?.trim() || !phone?.trim()) {
      return errorResponse('Name and phone are required');
    }

    if (!isValidPhone(phone)) {
      return errorResponse('Please enter a valid phone number (at least 10 digits)');
    }

    const emailError = getEmailValidationError(email, true);
    if (emailError) return errorResponse(emailError);

    const normalizedPhone = normalizePhone(phone);

    const existing = await findCustomerByPhone(phone);
    if (existing) {
      const registrationNumberValue =
        registrationNumber?.trim() ||
        existing.registrationNumber ||
        (await generateGuestRegistrationNumber());

      const customer = await db.customer.update({
        where: { id: existing.id },
        data: {
          name: name.trim(),
          company: company?.trim() || existing.company,
          email: email?.trim() || existing.email,
          address: address?.trim() || existing.address,
          idType: idType ?? existing.idType,
          idNumber: idNumber ?? existing.idNumber,
          visaExpiryDate:
            visaExpiryDate !== undefined
              ? visaExpiryDate?.trim() || null
              : existing.visaExpiryDate,
          registrationNumber: registrationNumberValue,
          nationality: nationality?.trim() || existing.nationality,
          designation: designation?.trim() || existing.designation,
          idDocPath: idDocPath ?? existing.idDocPath,
        },
      });

      return successResponse(
        customer,
        'Guest profile already exists for this phone — using existing record.',
        200
      );
    }

    const customer = await db.customer.create({
      data: {
        name: name.trim(),
        company: company?.trim() || null,
        email: email?.trim() || null,
        phone: normalizedPhone,
        address: address?.trim() || null,
        idType,
        idNumber,
        visaExpiryDate: visaExpiryDate?.trim() || null,
        registrationNumber:
          registrationNumber?.trim() || (await generateGuestRegistrationNumber()),
        nationality: nationality?.trim() || null,
        designation: designation?.trim() || null,
        dateOfBirth,
        idDocPath,
        notes,
      },
    });

    await logActivity(
      authResult.id,
      'CREATE_CUSTOMER',
      'hotel',
      JSON.stringify({ customerId: customer.id, name: customer.name, phone: customer.phone })
    );

    return successResponse(customer, 'Customer created successfully', 201);
  } catch (error) {
    console.error('Customer creation error:', error);
    return errorResponse('Failed to create customer', 500);
  }
}
