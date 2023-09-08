## Insured Vesting (InsuredVestingV1)

1. Contract is deployed with specified FUNDING_TOKEN/PROJECT_TOKEN ratio
2. Project can set a starting time (lockup) from which vesting will start
3. Project sets a FUNDING_TOKEN allocation per investor (this acts also as a whitelist)
4. Investors approve and call addFunds with the desired FUNDING_TOKEN amount
5. Upon activate() functionality being called, start time is finalised. Funds can no longer be added
6. Investors can toggle their decision between retrieving PROJECT_TOKEN and FUNDING_TOKEN back
7. Tokens vest on a per second basis. Only investor or project can claim according to the decision set.
   1. If claiming PROJECT_TOKEN, project gets FUNDING_TOKEN in the process
   2. If claiming FUNDING_TOKEN, project gets back PROJECT_TOKEN proportional to that vesting period
