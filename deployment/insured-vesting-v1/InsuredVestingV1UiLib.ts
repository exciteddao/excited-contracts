import { InsuredVestingV1Lib } from "./InsuredVestingV1Lib";

export class InsuredVestingV1UiLib {
  constructor(private lib: InsuredVestingV1Lib) {}

  async contractStatus() {
    const status = await this.lib.contractStatus();
    return {
      vestingStartTime: status.vestingStartTime?.toISOString() ?? "N/A",
      vestingEndTime: status.vestingEndTime?.toISOString() ?? "N/A",
      totalClaimed: (await this.lib.context.fundingToken.mantissa(status.totalClaimed)).toString(),
      totalFunded: (await this.lib.context.fundingToken.mantissa(status.totalFunded)).toString(),
      projectTokensPerFundingToken: (await this.lib.context.projectToken.mantissa(status.projectTokensPerFundingToken)).toString(),
      fundingTokenBalance: (await this.lib.context.fundingToken.mantissa(status.fundingTokenBalance)).toString(),
      projectTokenBalance: (await this.lib.context.projectToken.mantissa(status.projectTokenBalance)).toString(),
    };
  }

  async projectStatus() {
    const status = await this.lib.projectStatus();
    return {
      wallet: status.wallet,
      fundingTokenBalance: (await this.lib.context.fundingToken.mantissa(status.fundingTokenBalance)).toString(),
      projectTokenBalance: (await this.lib.context.projectToken.mantissa(status.projectTokenBalance)).toString(),
    };
  }

  async usersStatus(...users: string[]) {
    return Promise.all(
      (await this.lib.usersStatus(...users)).map(async (status) => {
        return {
          user: status.user,
          fundingTokenBalance: (await this.lib.context.fundingToken.mantissa(status.fundingTokenBalance)).toString(),
          projectTokenBalance: (await this.lib.context.projectToken.mantissa(status.projectTokenBalance)).toString(),
          fundingTokenAllocation: (await this.lib.context.fundingToken.mantissa(status.fundingTokenAllocation)).toString(),
          fundingTokenAmount: (await this.lib.context.fundingToken.mantissa(status.fundingTokenAmount)).toString(),
          fundingTokenClaimed: (await this.lib.context.fundingToken.mantissa(status.fundingTokenClaimed)).toString(),
          fundingTokenClaimable: (await this.lib.context.fundingToken.mantissa(await status.fundingTokenClaimable)).toString(),
          fundingTokenVested: (await this.lib.context.fundingToken.mantissa(await status.fundingTokenVested)).toString(),
          projectTokenClaimable: (await this.lib.context.projectToken.mantissa(await status.projectTokenClaimable)).toString(),
          projectTokenVested: (await this.lib.context.projectToken.mantissa(await status.projectTokenVested)).toString(),
          shouldRefund: status.shouldRefund ? "yes" : "no",
        };
      })
    );
  }
}
