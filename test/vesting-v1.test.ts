import { expect } from "chai";
import BN from "bignumber.js";
import { expectRevert } from "@defi.org/web3-candies/dist/hardhat";
import {
  FUNDING_PER_USER,
  LOCKUP_MONTHS,
  USDC_TO_XCTD_RATIO,
  VESTING_PERIODS,
  advanceMonths,
  anyUser,
  mockUsdc,
  project,
  user1,
  vesting,
  withFixture,
  xctd,
} from "./fixture";

describe("VestingV1", () => {
  beforeEach(async () => withFixture());

  it("can add funds", async () => {
    const startingBalance = BN(await mockUsdc.methods.balanceOf(user1).call());
    await vesting.methods.addFunds(await mockUsdc.amount(FUNDING_PER_USER)).send({ from: user1 });
    expect(await mockUsdc.methods.balanceOf(user1).call()).to.be.bignumber.eq(startingBalance.minus(await mockUsdc.amount(FUNDING_PER_USER)));
  });

  it("can claim tokens for vesting period 1", async () => {
    await vesting.methods.addFunds(await mockUsdc.amount(FUNDING_PER_USER)).send({ from: user1 });
    await advanceMonths(LOCKUP_MONTHS + 1);
    await vesting.methods.claim(user1, 1).send({ from: anyUser });
    expect(await xctd.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
      (await xctd.amount(FUNDING_PER_USER)).multipliedBy(USDC_TO_XCTD_RATIO).dividedBy(VESTING_PERIODS),
      await xctd.amount(0.1)
    );
  });

  it("cannot claim tokens for vesting period 1 twice", async () => {
    await vesting.methods.addFunds(await mockUsdc.amount(FUNDING_PER_USER)).send({ from: user1 });
    await advanceMonths(LOCKUP_MONTHS + 1);
    await vesting.methods.claim(user1, 1).send({ from: anyUser });
    await expectRevert(() => vesting.methods.claim(user1, 1).send({ from: anyUser }), "already claimed");
  });

  it("cannot claim tokens before starting period", async () => {
    await vesting.methods.addFunds(await mockUsdc.amount(FUNDING_PER_USER)).send({ from: user1 });
    await expectRevert(() => vesting.methods.claim(user1, 1).send({ from: anyUser }), "period not reached");
  });

  it("cannot claim tokens before vesting period has been reached", async () => {
    await vesting.methods.addFunds(await mockUsdc.amount(FUNDING_PER_USER)).send({ from: user1 });
    await advanceMonths(LOCKUP_MONTHS + 1);
    await expectRevert(() => vesting.methods.claim(user1, 2).send({ from: anyUser }), "period not reached");
  });

  it("can claim tokens for entire vesting period", async () => {
    await vesting.methods.addFunds(await mockUsdc.amount(FUNDING_PER_USER)).send({ from: user1 });
    await advanceMonths(LOCKUP_MONTHS + VESTING_PERIODS);
    for (let i = 1; i <= VESTING_PERIODS; i++) {
      await vesting.methods.claim(user1, i).send({ from: anyUser });
    }
    expect(await xctd.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
      (await xctd.amount(FUNDING_PER_USER)).multipliedBy(USDC_TO_XCTD_RATIO),
      await xctd.amount(0.1)
    );
  });

  it("project receives funding when claim is made", async () => {
    const startingBalance = await mockUsdc.methods.balanceOf(project).call();
    await vesting.methods.addFunds(await mockUsdc.amount(FUNDING_PER_USER)).send({ from: user1 });
    await advanceMonths(LOCKUP_MONTHS + 1);
    await vesting.methods.claim(user1, 1).send({ from: anyUser });
    const currentBalance = await mockUsdc.methods.balanceOf(project).call();
    expect(currentBalance).to.be.bignumber.closeTo(
      BN(startingBalance).plus((await mockUsdc.amount(FUNDING_PER_USER)).dividedBy(VESTING_PERIODS)),
      await mockUsdc.amount(0.1)
    );
  });

  // TODOs
  /*
    claim for all periods
    change decision
    try to claim for user who hasn't funded
    try to claim for user funded less than requested amount claimed?
    try to claim twice for same period
    eject tokens
    add funds without being in whitelist
    add more funds than allocation
    insurance
   */
});
