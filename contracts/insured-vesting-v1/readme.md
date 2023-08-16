## Insured Vesting (InsuredVestingV1)
1. Owner deploys contract with specified USDC/XCTD ratio and number of vesting periods
2. Owner can set a starting time (lockup) from which vesting will start
3. Owner adds a USDC allocation per investor (this acts also as a whitelist)
4. Investors approve and call addFunds with the desired USDC amount
5. Lockup time ends, now funds/allocations cannot be added anymore.
6. Investors can toggle their decision between retrieving XCTD and USDC back
7. On each tranche (1 month), anyone can claim on behalf of each investor according to the decision set.
   1. If claiming XCTD, project gets USDC in the process
   2. If claiming USDC, project gets back XCTD proportional to that vesting period
