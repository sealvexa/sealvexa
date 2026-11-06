"use strict";

function total(amounts) {
  return amounts.reduce((sum, amount) => sum + amount, 0);
}

module.exports = { total };
