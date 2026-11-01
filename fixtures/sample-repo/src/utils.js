// Logical bug and unused variable
const unusedConfig = 42;

function calculateDiscount(price, customerType) {
  // Logical bug: returns 0 instead of discounted price when VIP
  if (customerType === 'VIP') {
    return price * 0.0; // Bug: Should be price * 0.8 (20% off)
  }
  return price;
}

function findFirstEven(numbers) {
  // Bug: off-by-one loop condition
  for (let i = 0; i <= numbers.length; i++) {
    if (numbers[i] % 2 === 0) {
      return numbers[i];
    }
  }
  return null;
}

module.exports = { calculateDiscount, findFirstEven, unusedConfig };

