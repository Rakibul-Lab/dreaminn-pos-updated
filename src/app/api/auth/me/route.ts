import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/password';
import { logActivity } from '@/lib/api-utils';

const profileSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  phone: true,
  avatar: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const user = await db.user.findUnique({
      where: { id: authResult.id },
      select: profileSelect,
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: user });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to fetch user' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { name, phone, avatar, currentPassword, newPassword } = body;

    const existing = await db.user.findUnique({
      where: { id: authResult.id },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    if (!existing.active) {
      return NextResponse.json(
        { success: false, error: 'Account is deactivated' },
        { status: 403 }
      );
    }

    const updateData: Record<string, unknown> = {};

    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) {
        return NextResponse.json(
          { success: false, error: 'Name cannot be empty' },
          { status: 400 }
        );
      }
      updateData.name = trimmed;
    }

    if (phone !== undefined) {
      updateData.phone = phone ? String(phone).trim() : null;
    }

    if (avatar !== undefined) {
      updateData.avatar = avatar || null;
    }

    if (newPassword !== undefined && String(newPassword).trim() !== '') {
      if (authResult.role !== 'ADMIN') {
        return NextResponse.json(
          { success: false, error: 'Only administrators can change their password here' },
          { status: 403 }
        );
      }
      const next = String(newPassword);
      if (next.length < 6) {
        return NextResponse.json(
          { success: false, error: 'New password must be at least 6 characters' },
          { status: 400 }
        );
      }
      if (!currentPassword) {
        return NextResponse.json(
          { success: false, error: 'Current password is required to set a new password' },
          { status: 400 }
        );
      }
      const valid = await verifyPassword(String(currentPassword), existing.password);
      if (!valid) {
        return NextResponse.json(
          { success: false, error: 'Current password is incorrect' },
          { status: 400 }
        );
      }
      updateData.password = await hashPassword(next);
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No changes provided' },
        { status: 400 }
      );
    }

    const user = await db.user.update({
      where: { id: authResult.id },
      data: updateData,
      select: profileSelect,
    });

    await logActivity(
      authResult.id,
      'UPDATE_PROFILE',
      'auth',
      JSON.stringify({ fields: Object.keys(updateData).filter((k) => k !== 'password') })
    );

    return NextResponse.json({
      success: true,
      data: user,
      message: 'Profile updated successfully',
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to update profile' },
      { status: 500 }
    );
  }
}
