/**
 * Splits bill evenly across participants including tip percentage.
 * Needs unit tests for zero participants and negative amounts.
 */
function splitBill(totalAmount, participantCount, tipPercent = 15) {
  if (participantCount <= 0) {
    throw new Error("Participant count must be greater than zero.");
  }
  const totalWithTip = totalAmount * (1 + tipPercent / 100);
  return Number((totalWithTip / participantCount).toFixed(2));
}

module.exports = { splitBill };

