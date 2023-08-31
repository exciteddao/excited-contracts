## Insured Vesting (InsuredVestingV1)

1. Owner deploys contract with specified USDC/XCTD ratio
2. Owner can set a starting time (lockup) from which vesting will start
3. Owner sets a USDC allocation per investor (this acts also as a whitelist)
4. Investors approve and call addFunds with the desired USDC amount
5. Upon activate() functionality being called, start time is finalised. Funds can no longer be added
6. Investors can toggle their decision between retrieving XCTD and USDC back
7. Tokens vest on a per second basis. Only investor or owner can claim according to the decision set.
   1. If claiming XCTD, project gets USDC in the process
   2. If claiming USDC, project gets back XCTD proportional to that vesting period
