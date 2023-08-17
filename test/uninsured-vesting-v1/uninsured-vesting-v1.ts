import { expect } from "chai";
import BN from "bignumber.js";
import { expectRevert, setBalance } from "@defi.org/web3-candies/dist/hardhat";
import {
  LOCKUP_MONTHS,
  VESTING_PERIODS,
  advanceMonths,
  anyUser,
  user1,
  uninsuredVesting,
  withFixture,
  xctd,
  TOKENS_PER_USER,
  deployer,
  getCurrentTimestamp,
  someOtherToken,
  user2,
} from "./fixture";
import { web3 } from "@defi.org/web3-candies";

describe("UninsuredVestingV1", () => {
  beforeEach(async () => withFixture());

  it("can claim tokens for vesting period 1", async () => {
    await uninsuredVesting.methods.addAmount(user1, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer });
    await advanceMonths(LOCKUP_MONTHS + 1);
    await uninsuredVesting.methods.claim(user1).send({ from: anyUser });
    expect(await xctd.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
      (await xctd.amount(TOKENS_PER_USER)).dividedBy(VESTING_PERIODS),
      await xctd.amount(0.1)
    );
  });

  it("cannot claim tokens for vesting period 1 twice", async () => {
    await uninsuredVesting.methods.addAmount(user1, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer });
    await advanceMonths(LOCKUP_MONTHS + 1);
    await uninsuredVesting.methods.claim(user1).send({ from: anyUser });
    await expectRevert(() => uninsuredVesting.methods.claim(user1).send({ from: anyUser }), "already claimed until vesting period");
  });

  it("cannot claim tokens before starting period", async () => {
    await uninsuredVesting.methods.addAmount(user1, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer });
    await expectRevert(() => uninsuredVesting.methods.claim(user1).send({ from: anyUser }), "vesting has not started");
  });

  it("can claim tokens for entire vesting period", async () => {
    await uninsuredVesting.methods.addAmount(user1, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer });
    await advanceMonths(LOCKUP_MONTHS + VESTING_PERIODS);
    await uninsuredVesting.methods.claim(user1).send({ from: anyUser });
    expect(await xctd.methods.balanceOf(user1).call()).to.be.bignumber.eq(await xctd.amount(TOKENS_PER_USER));
  });

  it("cannot claim if there's no eligibility", async () => {
    await advanceMonths(LOCKUP_MONTHS + 1);
    await uninsuredVesting.methods.claim(user1).send({ from: anyUser });
    expect(await xctd.methods.balanceOf(user1).call()).to.be.bignumber.zero;
  });

  it("cannot set amounts after period started", async () => {
    await advanceMonths(LOCKUP_MONTHS);
    await expectRevert(
      async () => uninsuredVesting.methods.addAmount(user1, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer }),
      "vesting already started"
    );
  });

  it("cannot set start time after period started", async () => {
    await advanceMonths(LOCKUP_MONTHS);
    await expectRevert(async () => uninsuredVesting.methods.setStartTime(await getCurrentTimestamp()).send({ from: deployer }), "vesting already started");
  });

  it("cannot set start time after period started", async () => {
    await expectRevert(
      async () => uninsuredVesting.methods.setStartTime(BN(await getCurrentTimestamp()).minus(100)).send({ from: deployer }),
      "cannot set start time in the past"
    );
  });

  describe("recovery", () => {
    it("recovers ether", async () => {
      const startingBalance = await web3().eth.getBalance(deployer);
      expect(await web3().eth.getBalance(uninsuredVesting.options.address)).to.bignumber.eq(0);
      await setBalance(uninsuredVesting.options.address, BN(12345 * 1e18));
      await uninsuredVesting.methods.recover(xctd.options.address).send({ from: deployer });
      expect(await web3().eth.getBalance(uninsuredVesting.options.address)).to.be.bignumber.zero;
      expect(await web3().eth.getBalance(deployer)).to.bignumber.closeTo(BN(12345 * 1e18).plus(startingBalance), BN(0.1e18));
    });

    it("recovers other tokens", async () => {
      await someOtherToken.methods.transfer(uninsuredVesting.options.address, BN(12345 * 1e18)).send({ from: deployer });
      await uninsuredVesting.methods.recover(someOtherToken.options.address).send({ from: deployer });
      expect(await someOtherToken.methods.balanceOf(uninsuredVesting.options.address).call()).to.be.bignumber.zero;
    });

    it("recovers unallocated xctd", async () => {
      await uninsuredVesting.methods.addAmount(user1, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer });
      await uninsuredVesting.methods.addAmount(user2, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer });
      await uninsuredVesting.methods.recover(xctd.options.address).send({ from: deployer });
      // Recover all but the tokens allocated to users
      expect(await xctd.methods.balanceOf(uninsuredVesting.options.address).call()).to.be.bignumber.eq(await xctd.amount(TOKENS_PER_USER * 2));
    });
  });

  describe("access control", () => {
    it("cannot set start time if not owner", async () => {
      await expectRevert(
        async () => uninsuredVesting.methods.setStartTime(await getCurrentTimestamp()).send({ from: anyUser }),
        "Ownable: caller is not the owner"
      );
    });

    it("cannot set amounts if not owner", async () => {
      await expectRevert(async () => uninsuredVesting.methods.addAmount(user1, 1).send({ from: anyUser }), "Ownable: caller is not the owner");
    });

    it("cannot recover if not owner", async () => {
      await expectRevert(async () => uninsuredVesting.methods.recover(xctd.options.address).send({ from: anyUser }), "Ownable: caller is not the owner");
    });
  });
});
