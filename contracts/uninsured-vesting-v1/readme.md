## Vesting (VestingV1)

1. Owner deploys
2. Owner can set a starting time (lockup) from which vesting will start
3. Owner transfers vested token to contract
4. Owner sets token allowance per investor
5. Upon activate() functionality being called, start time is finalised. Funds can no longer be added
6. Tokens vest on a per second basis. Investors can claim their proportional PROJECT_TOKEN allocation
