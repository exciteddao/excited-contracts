import { Token } from "@defi.org/web3-candies";
import { ERC20 } from "@defi.org/web3-candies/dist/abi";
import { InsuredVestingV1 } from "../../typechain-hardhat/contracts/insured-vesting-v1/InsuredVestingV1";

export class InsuredVestingV1Lib {
  constructor(public context: InsuredVestingV1Context) {}

  async contractStatus() {
    const date = parseInt(await this.context.insuredVesting.methods.vestingStartTime().call()) * 1000;
    const vestingDuration = parseInt(await this.context.insuredVesting.methods.VESTING_DURATION_SECONDS().call()) * 1000;

    return {
      vestingStartTime: date > 0 ? new Date(date) : null,
      vestingEndTime: date ? new Date(date + vestingDuration) : null,
      totalClaimed: await this.context.insuredVesting.methods.fundingTokenTotalClaimed().call(),
      totalFunded: await this.context.insuredVesting.methods.fundingTokenTotalAmount().call(),
      projectTokensPerFundingToken: await this.context.insuredVesting.methods.fundingTokenToProjectToken(await this.context.fundingToken.amount(1)).call(),
      fundingTokenBalance: await this.context.fundingToken.methods.balanceOf(this.context.insuredVesting.options.address).call(),
      projectTokenBalance: await this.context.projectToken.methods.balanceOf(this.context.insuredVesting.options.address).call(),
    };
  }

  async projectStatus() {
    const wallet = await this.context.insuredVesting.methods.projectWallet().call();
    return {
      wallet: wallet,
      fundingTokenBalance: await this.context.fundingToken.methods.balanceOf(wallet).call(),
      projectTokenBalance: await this.context.projectToken.methods.balanceOf(wallet).call(),
    };
  }

  async usersStatus(...users: string[]) {
    return Promise.all(users.map(async (user) => this.userStatus(user)));
  }

  async userStatus(user: string) {
    const userVesting = await this.context.insuredVesting.methods.userVestings(user).call();
    return {
      user,
      fundingTokenBalance: await this.context.fundingToken.methods.balanceOf(user).call(),
      projectTokenBalance: await this.context.projectToken.methods.balanceOf(user).call(),
      projectTokenClaimable: this.context.insuredVesting.methods.projectTokenClaimableFor(user).call(),
      projectTokenVested: this.context.insuredVesting.methods.projectTokenVestedFor(user).call(),
      fundingTokenAllocation: userVesting.fundingTokenAllocation,
      fundingTokenAmount: userVesting.fundingTokenAmount,
      fundingTokenClaimed: userVesting.fundingTokenClaimed,
      fundingTokenClaimable: this.context.insuredVesting.methods.fundingTokenClaimableFor(user).call(),
      fundingTokenVested: this.context.insuredVesting.methods.fundingTokenVestedFor(user).call(),
      shouldRefund: userVesting.shouldRefund,
    };
  }
}

export type InsuredVestingV1Context = {
  fundingToken: ERC20 & Token;
  projectToken: ERC20 & Token;
  insuredVesting: InsuredVestingV1;
};
