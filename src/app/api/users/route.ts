import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse, paginatedResponse, logActivity } from '@/lib/api-utils';
import { hashPassword } from '@/lib/password';
import { getEmailValidationError } from '@/lib/email-validation';

// GET /api/users - List users (ADMIN only)
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN');
    if (authResult instanceof Response) return authResult;

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const role = searchParams.get('role');
    const active = searchParams.get('active');
    const search = searchParams.get('search');

    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (role) where.role = role;
    if (active !== null && active !== undefined) where.active = active === 'true';
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } },
      ];
    }

    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          phone: true,
          active: true,
          avatar: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.user.count({ where }),
    ]);

    return paginatedResponse(users, total, page, limit);
  } catch (error) {
    console.error('Error listing users:', error);
    return errorResponse('Failed to fetch users', 500);
  }
}

// POST /api/users - Create user (ADMIN only)
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN');
    if (authResult instanceof Response) return authResult;

    const body = await request.json();
    const { name, email, password, role, phone, avatar } = body;

    if (!name || !email || !password || !role) {
      return errorResponse('Name, email, password, and role are required');
    }

    const emailError = getEmailValidationError(email, false);
    if (emailError) return errorResponse(emailError);

    const validRoles = ['ADMIN', 'HOTEL_STAFF', 'HOTEL_FD', 'RESTAURANT_STAFF', 'HOUSEKEEPER'];
    if (!validRoles.includes(role)) {
      return errorResponse('Invalid role. Must be ADMIN, HOTEL_STAFF, HOTEL_FD, RESTAURANT_STAFF, or HOUSEKEEPER');
    }

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return errorResponse('Email already exists');
    }

    const hashedPassword = await hashPassword(password);

    const user = await db.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role,
        phone: phone || null,
        avatar: avatar || null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        avatar: true,
        active: true,
        createdAt: true,
      },
    });

    await logActivity(
      authResult.id,
      'CREATE_USER',
      'admin',
      JSON.stringify({ userId: user.id, email, role })
    );

    return successResponse(user, 'User created successfully', 201);
  } catch (error) {
    console.error('Error creating user:', error);
    return errorResponse('Failed to create user', 500);
  }
}

// PUT /api/users - Update user (ADMIN only)
export async function PUT(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN');
    if (authResult instanceof Response) return authResult;

    const body = await request.json();
    const { id, name, email, role, phone, active, avatar } = body;

    if (!id) {
      return errorResponse('User ID is required');
    }

    const existing = await db.user.findUnique({ where: { id } });
    if (!existing) {
      return errorResponse('User not found', 404);
    }

    if (email !== undefined) {
      const emailError = getEmailValidationError(email, false);
      if (emailError) return errorResponse(emailError);
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (role !== undefined) {
      const validRoles = ['ADMIN', 'HOTEL_STAFF', 'HOTEL_FD', 'RESTAURANT_STAFF', 'HOUSEKEEPER'];
      if (!validRoles.includes(role)) {
        return errorResponse('Invalid role. Must be ADMIN, HOTEL_STAFF, HOTEL_FD, RESTAURANT_STAFF, or HOUSEKEEPER');
      }
      updateData.role = role;
    }
    if (phone !== undefined) updateData.phone = phone;
    if (avatar !== undefined) updateData.avatar = avatar;
    if (active !== undefined) updateData.active = active;

    // Handle password update separately (needs hashing)
    const passwordToUpdate = body.password;
    if (passwordToUpdate && typeof passwordToUpdate === 'string' && passwordToUpdate.trim() !== '') {
      updateData.password = await hashPassword(passwordToUpdate);
    }

    const user = await db.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        avatar: true,
        active: true,
        createdAt: true,
      },
    });

    await logActivity(
      authResult.id,
      'UPDATE_USER',
      'admin',
      JSON.stringify({ userId: id, updates: Object.keys(updateData) })
    );

    return successResponse(user, 'User updated successfully');
  } catch (error) {
    console.error('Error updating user:', error);
    return errorResponse('Failed to update user', 500);
  }
}
