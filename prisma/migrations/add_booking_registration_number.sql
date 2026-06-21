-- Per-stay registration number on bookings
ALTER TABLE bookings ADD COLUMN registration_number VARCHAR(191) NULL;
CREATE INDEX bookings_registration_number_idx ON bookings (registration_number);
