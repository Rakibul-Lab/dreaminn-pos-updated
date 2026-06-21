import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { ensureCloudViewRestaurantLedger } from '@/lib/cloudview-ledger';
import { ensureDefaultUsers } from '@/lib/ensure-default-users';
import { requireRole } from '@/lib/auth';

async function assertSeedAccess(request: NextRequest): Promise<NextResponse | null> {
  const userCount = await db.user.count();
  if (userCount === 0) {
    if (process.env.NODE_ENV === 'production') {
      const secret = request.headers.get('x-seed-secret');
      if (!process.env.SEED_SECRET || secret !== process.env.SEED_SECRET) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
    }
    return null;
  }

  const authResult = await requireRole(request, 'ADMIN');
  if (authResult instanceof NextResponse) return authResult;
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const seedError = await assertSeedAccess(request);
    if (seedError) return seedError;

    // Check if already seeded
    const userCount = await db.user.count();
    if (userCount > 0) {
      const ensured = await ensureDefaultUsers(db);
      if (ensured.length > 0) {
        return NextResponse.json({
          success: true,
          message: `Added missing default user(s): ${ensured.join(', ')}`,
          data: { ensured },
        });
      }
      return NextResponse.json({
        success: false,
        error: 'Database already seeded. Use reset first.',
      }, { status: 400 });
    }

    // Create Admin User
    const adminPassword = await hashPassword('admin123');
    const admin = await db.user.create({
      data: {
        email: 'admin@erp.com',
        name: 'System Admin',
        password: adminPassword,
        role: 'ADMIN',
        phone: '+8801700000000',
      },
    });

    // Create Hotel Manager
    const hotelPassword = await hashPassword('hotel123');
    const hotelStaff = await db.user.create({
      data: {
        email: 'hotel@erp.com',
        name: 'Hotel Manager',
        password: hotelPassword,
        role: 'HOTEL_STAFF',
        phone: '+8801711111111',
      },
    });

    // Create Restaurant Staff
    const restPassword = await hashPassword('rest123');
    const restStaff = await db.user.create({
      data: {
        email: 'restaurant@erp.com',
        name: 'Restaurant Manager',
        password: restPassword,
        role: 'RESTAURANT_STAFF',
        phone: '+8801722222222',
      },
    });

    // Create Hotel F.D. (front desk)
    const fdPassword = await hashPassword('fd123');
    await db.user.create({
      data: {
        email: 'fd@erp.com',
        name: 'Hotel Front Desk',
        password: fdPassword,
        role: 'HOTEL_FD',
        phone: '+8801733333333',
      },
    });

    // Create additional restaurant staff
    const restStaff2Password = await hashPassword('rest123');
    await db.user.create({
      data: {
        email: 'waiter@erp.com',
        name: 'CloudView Waiter',
        password: restStaff2Password,
        role: 'RESTAURANT_STAFF',
        phone: '+8801744444444',
      },
    });

    // Create Room Types
    const standard = await db.roomType.create({
      data: {
        name: 'Standard',
        description: 'Comfortable room with basic amenities',
        capacity: 2,
        amenities: JSON.stringify(['WiFi', 'AC', 'TV', 'Hot Water']),
      },
    });

    const deluxe = await db.roomType.create({
      data: {
        name: 'Deluxe',
        description: 'Spacious room with premium amenities',
        capacity: 3,
        amenities: JSON.stringify(['WiFi', 'AC', 'TV', 'Mini Bar', 'Hot Water', 'Room Service']),
      },
    });

    const suite = await db.roomType.create({
      data: {
        name: 'Suite',
        description: 'Luxury suite with separate living area',
        capacity: 4,
        amenities: JSON.stringify(['WiFi', 'AC', 'TV', 'Mini Bar', 'Hot Water', 'Room Service', 'Jacuzzi', 'Balcony']),
      },
    });

    const familyRoom = await db.roomType.create({
      data: {
        name: 'Family Room',
        description: 'Perfect for families with extra beds',
        capacity: 5,
        amenities: JSON.stringify(['WiFi', 'AC', 'TV', 'Hot Water', 'Extra Beds', 'Play Area']),
      },
    });

    const typePricing: Record<string, number> = {
      [standard.id]: 3163,
      [deluxe.id]: 5693,
      [suite.id]: 10120,
      [familyRoom.id]: 6958,
    };

    // Create Rooms (Floors 8-10): 801-815, 901-915, 1001-1015
    const roomData = [];
    for (let floor = 8; floor <= 10; floor++) {
      for (let room = 1; room <= 15; room++) {
        const roomNumber = `${floor}${room.toString().padStart(2, '0')}`;
        let typeId = standard.id;
        if (room <= 2) typeId = suite.id;
        else if (room <= 4) typeId = deluxe.id;
        else if (room <= 6) typeId = familyRoom.id;
        else typeId = standard.id;

        roomData.push({
          roomNumber,
          floor,
          typeId,
          status: 'AVAILABLE' as const,
          totalPrice: typePricing[typeId],
        });
      }
    }
    await db.room.createMany({ data: roomData });

    // Create Restaurant Tables
    const tableData = [];
    for (let i = 1; i <= 20; i++) {
      let location = 'indoor';
      if (i > 15) location = 'outdoor';
      if (i > 18) location = 'vip';
      tableData.push({
        tableNumber: `T${i.toString().padStart(2, '0')}`,
        capacity: i > 18 ? 8 : i > 15 ? 6 : 4,
        status: 'available',
        location,
      });
    }
    await db.restaurantTable.createMany({ data: tableData });

    // Create Menu Categories
    const appetizers = await db.menuCategory.create({
      data: { name: 'Appetizers', description: 'Start your meal right', sortOrder: 1 },
    });
    const mainCourse = await db.menuCategory.create({
      data: { name: 'Main Course', description: 'Signature dishes', sortOrder: 2 },
    });
    const rice = await db.menuCategory.create({
      data: { name: 'Rice & Biryani', description: 'Aromatic rice dishes', sortOrder: 3 },
    });
    const desserts = await db.menuCategory.create({
      data: { name: 'Desserts', description: 'Sweet endings', sortOrder: 4 },
    });
    const beverages = await db.menuCategory.create({
      data: { name: 'Beverages', description: 'Refreshments', sortOrder: 5 },
    });
    const soup = await db.menuCategory.create({
      data: { name: 'Soups', description: 'Warm and comforting', sortOrder: 6 },
    });

    // Create Menu Items
    const menuItems = [
      // Appetizers
      { categoryId: appetizers.id, name: 'Chicken Tikka', price: 350, isVeg: false, preparationTime: 15 },
      { categoryId: appetizers.id, name: 'Paneer Tikka', price: 300, isVeg: true, preparationTime: 15 },
      { categoryId: appetizers.id, name: 'Fish Fry', price: 400, isVeg: false, preparationTime: 20 },
      { categoryId: appetizers.id, name: 'Spring Rolls', price: 250, isVeg: true, preparationTime: 10 },
      { categoryId: appetizers.id, name: 'Seekh Kebab', price: 380, isVeg: false, preparationTime: 18 },

      // Main Course
      { categoryId: mainCourse.id, name: 'Butter Chicken', price: 550, isVeg: false, preparationTime: 25 },
      { categoryId: mainCourse.id, name: 'Chicken Curry', price: 480, isVeg: false, preparationTime: 25 },
      { categoryId: mainCourse.id, name: 'Paneer Butter Masala', price: 420, isVeg: true, preparationTime: 20 },
      { categoryId: mainCourse.id, name: 'Lamb Rogan Josh', price: 650, isVeg: false, preparationTime: 30 },
      { categoryId: mainCourse.id, name: 'Dal Makhani', price: 300, isVeg: true, preparationTime: 20 },
      { categoryId: mainCourse.id, name: 'Fish Curry', price: 520, isVeg: false, preparationTime: 25 },
      { categoryId: mainCourse.id, name: 'Mix Veg Curry', price: 280, isVeg: true, preparationTime: 15 },
      { categoryId: mainCourse.id, name: 'Chili Chicken', price: 450, isVeg: false, preparationTime: 20 },
      { categoryId: mainCourse.id, name: 'Chicken Masala', price: 500, isVeg: false, preparationTime: 22 },

      // Rice & Biryani
      { categoryId: rice.id, name: 'Chicken Biryani', price: 450, isVeg: false, preparationTime: 30 },
      { categoryId: rice.id, name: 'Mutton Biryani', price: 550, isVeg: false, preparationTime: 35 },
      { categoryId: rice.id, name: 'Veg Biryani', price: 300, isVeg: true, preparationTime: 25 },
      { categoryId: rice.id, name: 'Plain Rice', price: 120, isVeg: true, preparationTime: 15 },
      { categoryId: rice.id, name: 'Naan', price: 60, isVeg: true, preparationTime: 8 },
      { categoryId: rice.id, name: 'Garlic Naan', price: 80, isVeg: true, preparationTime: 10 },

      // Soups
      { categoryId: soup.id, name: 'Tomato Soup', price: 180, isVeg: true, preparationTime: 10 },
      { categoryId: soup.id, name: 'Chicken Sweet Corn Soup', price: 220, isVeg: false, preparationTime: 12 },
      { categoryId: soup.id, name: 'Hot & Sour Soup', price: 200, isVeg: true, preparationTime: 10 },
      { categoryId: soup.id, name: 'Mushroom Soup', price: 220, isVeg: true, preparationTime: 12 },

      // Desserts
      { categoryId: desserts.id, name: 'Gulab Jamun', price: 150, isVeg: true, preparationTime: 5 },
      { categoryId: desserts.id, name: 'Rasmalai', price: 180, isVeg: true, preparationTime: 5 },
      { categoryId: desserts.id, name: 'Ice Cream', price: 200, isVeg: true, preparationTime: 2 },
      { categoryId: desserts.id, name: 'Firni', price: 160, isVeg: true, preparationTime: 5 },

      // Beverages
      { categoryId: beverages.id, name: 'Mango Lassi', price: 150, isVeg: true, preparationTime: 3 },
      { categoryId: beverages.id, name: 'Masala Chai', price: 80, isVeg: true, preparationTime: 5 },
      { categoryId: beverages.id, name: 'Fresh Lime Soda', price: 100, isVeg: true, preparationTime: 3 },
      { categoryId: beverages.id, name: 'Cold Coffee', price: 180, isVeg: true, preparationTime: 5 },
      { categoryId: beverages.id, name: 'Mineral Water', price: 50, isVeg: true, preparationTime: 1 },
      { categoryId: beverages.id, name: 'Fresh Juice', price: 200, isVeg: true, preparationTime: 5 },
    ];

    await db.menuItem.createMany({
      data: menuItems.map(item => ({
        ...item,
        description: '',
        available: true,
      })),
    });

    // Create sample customers
    const customers = [
      { name: 'Rahim Uddin', phone: '+8801712345678', email: 'rahim@email.com', address: 'Gulshan, Dhaka' },
      { name: 'Fatima Begum', phone: '+8801723456789', email: 'fatima@email.com', address: 'Dhanmondi, Dhaka' },
      { name: 'Kamal Hossain', phone: '+8801734567890', email: 'kamal@email.com', address: 'Banani, Dhaka' },
      { name: 'Nasreen Akter', phone: '+8801745678901', email: 'nasreen@email.com', address: 'Uttara, Dhaka' },
      { name: 'Imran Khan', phone: '+8801756789012', email: 'imran@email.com', address: 'Mirpur, Dhaka' },
    ];
    await db.customer.createMany({ data: customers });

    // Create Settings
    const settings = [
      { key: 'hotel_name', value: 'RRP Dream Inn', group: 'hotel' },
      { key: 'vat_percent', value: '15', group: 'hotel' },
      { key: 'late_checkout_charge', value: '500', group: 'hotel' },
      { key: 'late_checkout_hours', value: '12', group: 'hotel' },
      { key: 'restaurant_name', value: 'CloudView', group: 'restaurant' },
      { key: 'restaurant_vat_percent', value: '15', group: 'restaurant' },
      { key: 'currency', value: 'BDT', group: 'general' },
    ];
    await db.setting.createMany({ data: settings });

    // Create Inventory Items
    const inventoryItems = [
      { name: 'Chicken Breast', category: 'Meat', unit: 'kg', quantity: 50, minQuantity: 10, costPerUnit: 350 },
      { name: 'Basmati Rice', category: 'Grains', unit: 'kg', quantity: 100, minQuantity: 20, costPerUnit: 120 },
      { name: 'Cooking Oil', category: 'Oils', unit: 'liter', quantity: 30, minQuantity: 5, costPerUnit: 180 },
      { name: 'Paneer', category: 'Dairy', unit: 'kg', quantity: 20, minQuantity: 5, costPerUnit: 500 },
      { name: 'Fresh Vegetables', category: 'Vegetables', unit: 'kg', quantity: 80, minQuantity: 15, costPerUnit: 80 },
      { name: 'Spices Mix', category: 'Spices', unit: 'kg', quantity: 15, minQuantity: 3, costPerUnit: 600 },
      { name: 'Flour', category: 'Grains', unit: 'kg', quantity: 40, minQuantity: 8, costPerUnit: 60 },
      { name: 'Sugar', category: 'Grains', unit: 'kg', quantity: 25, minQuantity: 5, costPerUnit: 100 },
      { name: 'Milk', category: 'Dairy', unit: 'liter', quantity: 50, minQuantity: 10, costPerUnit: 80 },
      { name: 'Lamb Meat', category: 'Meat', unit: 'kg', quantity: 30, minQuantity: 8, costPerUnit: 700 },
      { name: 'Fish (Rui)', category: 'Seafood', unit: 'kg', quantity: 25, minQuantity: 5, costPerUnit: 350 },
      { name: 'Toilet Paper', category: 'Housekeeping', unit: 'piece', quantity: 200, minQuantity: 50, costPerUnit: 30 },
      { name: 'Bed Sheets', category: 'Housekeeping', unit: 'piece', quantity: 60, minQuantity: 10, costPerUnit: 500 },
      { name: 'Towels', category: 'Housekeeping', unit: 'piece', quantity: 80, minQuantity: 15, costPerUnit: 300 },
      { name: 'Detergent', category: 'Housekeeping', unit: 'liter', quantity: 20, minQuantity: 5, costPerUnit: 250 },
    ];
    await db.inventoryItem.createMany({ data: inventoryItems });

    await ensureCloudViewRestaurantLedger(db);

    return NextResponse.json({
      success: true,
      message: 'Database seeded successfully',
      data: {
        users: { admin: admin.email, hotel: hotelStaff.email, restaurant: restStaff.email },
        rooms: roomData.length,
        tables: tableData.length,
        menuItems: menuItems.length,
        customers: customers.length,
      },
    });
  } catch (error) {
    console.error('Seed error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to seed database' },
      { status: 500 }
    );
  }
}

// Reset endpoint
export async function DELETE(request: NextRequest) {
  try {
    const seedError = await assertSeedAccess(request);
    if (seedError) return seedError;

    // Delete all data in reverse dependency order
    await db.invoiceItem.deleteMany();
    await db.payment.deleteMany();
    await db.invoice.deleteMany();
    await db.orderItem.deleteMany();
    await db.restaurantOrder.deleteMany();
    await db.roomCharge.deleteMany();
    await db.booking.deleteMany();
    await db.housekeepingTask.deleteMany();
    await db.notification.deleteMany();
    await db.activityLog.deleteMany();
    await db.inventoryTransaction.deleteMany();
    await db.inventoryItem.deleteMany();
    await db.menuItem.deleteMany();
    await db.menuCategory.deleteMany();
    await db.restaurantTable.deleteMany();
    await db.customer.deleteMany();
    await db.room.deleteMany();
    await db.roomType.deleteMany();
    await db.setting.deleteMany();
    await db.user.deleteMany();

    return NextResponse.json({ success: true, message: 'Database reset successfully' });
  } catch (error) {
    console.error('Reset error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to reset database' },
      { status: 500 }
    );
  }
}
