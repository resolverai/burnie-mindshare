const { ethers } = require('ethers');

console.log('\n📊 ROAST Token Unit Calculations:\n');

// What the wallet has
const actualBalance = BigInt('50000');
const decimals = 18;
const formatted = ethers.formatUnits(actualBalance, decimals);

console.log('What the wallet ACTUALLY has:');
console.log('  Raw units:', actualBalance.toString());
console.log('  Formatted:', formatted, 'ROAST');
console.log('  In scientific notation:', Number(formatted).toExponential(2));
console.log('');

// What 50k ROAST should be
const fiftyThousandRoast = ethers.parseUnits('50000', decimals);
console.log('What 50,000 ROAST should be:');
console.log('  Raw units:', fiftyThousandRoast.toString());
console.log('  Formatted:', ethers.formatUnits(fiftyThousandRoast, decimals), 'ROAST');
console.log('');

// Difference
const difference = fiftyThousandRoast - actualBalance;
console.log('Difference:');
console.log('  The wallet needs', difference.toString(), 'more raw units');
console.log('  Which equals:', ethers.formatUnits(difference, decimals), 'ROAST');
console.log('');

console.log('❌ The wallet does NOT have 50k ROAST');
console.log('✅ It has 0.00000000000005 ROAST (essentially zero)\n');

