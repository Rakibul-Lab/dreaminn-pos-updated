-- Add manual payment categories for the Record New Payment flow
ALTER TABLE `payments`
  MODIFY `paymentType` ENUM(
    'ADVANCE',
    'INITIAL',
    'FINAL',
    'PARTIAL',
    'RESTAURANT',
    'REFUND',
    'EXTRA_CHARGES',
    'DAMAGE_CHARGES',
    'OTHERS'
  ) NOT NULL;
