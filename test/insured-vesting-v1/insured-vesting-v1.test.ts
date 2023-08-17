import { expect } from "chai";
import BN from "bignumber.js";
import { expectRevert, setBalance } from "@defi.org/web3-candies/dist/hardhat";
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
  insuredVesting,
  withFixture,
  xctd,
  deployer,
  someOtherToken,
  getCurrentTimestamp,
} from "./fixture";
import { web3 } from "@defi.org/web3-candies";

describe("InsuredVestingV1", () => {
  beforeEach(async () => withFixture());

  it("can add funds", async () => {
    await insuredVesting.methods.addAllocation(user1, await mockUsdc.amount(FUNDING_PER_USER)).send({ from: deployer });
    const startingBalance = BN(await mockUsdc.methods.balanceOf(user1).call());
    await insuredVesting.methods.addFunds(await mockUsdc.amount(FUNDING_PER_USER)).send({ from: user1 });
    expect(await mockUsdc.methods.balanceOf(user1).call()).to.be.bignumber.eq(startingBalance.minus(await mockUsdc.amount(FUNDING_PER_USER)));
  });

  it("can claim tokens for vesting period 1", async () => {
    await insuredVesting.methods.addAllocation(user1, await mockUsdc.amount(FUNDING_PER_USER)).send({ from: deployer });
    await insuredVesting.methods.addFunds(await mockUsdc.amount(FUNDING_PER_USER)).send({ from: user1 });
    await advanceMonths(LOCKUP_MONTHS);
    await insuredVesting.methods.claim(user1).send({ from: anyUser });
    expect(await xctd.methods.balanceOf(user1).call()).to.be.bignumber.eq(
      await xctd.amount(BN(FUNDING_PER_USER).multipliedBy(USDC_TO_XCTD_RATIO).dividedBy(VESTING_PERIODS))
    );
  });

  it("cannot claim tokens for vesting period 1 twice", async () => {
    await insuredVesting.methods.addAllocation(user1, await mockUsdc.amount(FUNDING_PER_USER)).send({ from: deployer });
    await insuredVesting.methods.addFunds(await mockUsdc.amount(FUNDING_PER_USER)).send({ from: user1 });
    await advanceMonths(LOCKUP_MONTHS);
    await insuredVesting.methods.claim(user1).send({ from: anyUser });
    await expectRevert(() => insuredVesting.methods.claim(user1).send({ from: anyUser }), "already claimed");
  });

  it("cannot claim tokens before starting period", async () => {
    await insuredVesting.methods.addAllocation(user1, await mockUsdc.amount(FUNDING_PER_USER)).send({ from: deployer });
    await insuredVesting.methods.addFunds(await mockUsdc.amount(FUNDING_PER_USER)).send({ from: user1 });
    await expectRevert(() => insuredVesting.methods.claim(user1).send({ from: anyUser }), "vesting has not started");
  });

  it("cannot claim tokens before starting period, some time has passed", async () => {
    await advanceMonths(LOCKUP_MONTHS / 2);
    await insuredVesting.methods.addAllocation(user1, await mockUsdc.amount(FUNDING_PER_USER)).send({ from: deployer });
    await insuredVesting.methods.addFunds(await mockUsdc.amount(FUNDING_PER_USER)).send({ from: user1 });
    await expectRevert(() => insuredVesting.methods.claim(user1).send({ from: anyUser }), "vesting has not started");
  });

  it("cannot claim if not funded", async () => {
    await advanceMonths(LOCKUP_MONTHS);
    await expectRevert(async () => insuredVesting.methods.claim(user1).send({ from: anyUser }), "no funds added");
  });

  it("can claim tokens for entire vesting period, exact months passed", async () => {
    await insuredVesting.methods.addAllocation(user1, await mockUsdc.amount(FUNDING_PER_USER)).send({ from: deployer });
    await insuredVesting.methods.addFunds(await mockUsdc.amount(FUNDING_PER_USER)).send({ from: user1 });
    await advanceMonths(LOCKUP_MONTHS + VESTING_PERIODS - 1);
    await insuredVesting.methods.claim(user1).send({ from: anyUser });
    expect(await xctd.methods.balanceOf(user1).call()).to.be.bignumber.eq(await xctd.amount(BN(FUNDING_PER_USER).multipliedBy(USDC_TO_XCTD_RATIO)));
  });

  it("can claim tokens for entire vesting period, many months passed", async () => {
    await insuredVesting.methods.addAllocation(user1, await mockUsdc.amount(FUNDING_PER_USER)).send({ from: deployer });
    await insuredVesting.methods.addFunds(await mockUsdc.amount(FUNDING_PER_USER)).send({ from: user1 });
    await advanceMonths(LOCKUP_MONTHS + VESTING_PERIODS * 8);
    await insuredVesting.methods.claim(user1).send({ from: anyUser });
    expect(await xctd.methods.balanceOf(user1).call()).to.be.bignumber.eq(await xctd.amount(BN(FUNDING_PER_USER).multipliedBy(USDC_TO_XCTD_RATIO)));
  });

  it("can claim some tokens, some usdc for entire vesting period", async () => {
    await insuredVesting.methods.addAllocation(user1, await mockUsdc.amount(FUNDING_PER_USER)).send({ from: deployer });
    await insuredVesting.methods.addFunds(await mockUsdc.amount(FUNDING_PER_USER)).send({ from: user1 });

    const userStartingUsdcBalance = BN(await mockUsdc.methods.balanceOf(user1).call());
    const projectStartingUsdcBalance = BN(await mockUsdc.methods.balanceOf(project).call());
    const projectStartingXctdBalance = BN(await xctd.methods.balanceOf(project).call());

    // Claim for 14 months (remember that when LOCKUP_MONTHS has arrived, we're already in vesting period 1)
    await advanceMonths(LOCKUP_MONTHS + 13);
    await insuredVesting.methods.claim(user1).send({ from: anyUser });

    // Toggle to USDC decision
    await insuredVesting.methods.toggleDecision().send({ from: user1 });

    // Claim USDC for remaining periods
    await advanceMonths(10);
    await insuredVesting.methods.claim(user1).send({ from: anyUser });

    const deltaUsdcProject = BN(await mockUsdc.methods.balanceOf(project).call()).minus(projectStartingUsdcBalance);
    const deltaXctdProject = BN(await xctd.methods.balanceOf(project).call()).minus(projectStartingXctdBalance);
    const deltaUsdcUser = BN(await mockUsdc.methods.balanceOf(user1).call()).minus(userStartingUsdcBalance);
    const deltaXctdUser = BN(await xctd.methods.balanceOf(user1).call());

    expect(deltaXctdUser).to.be.bignumber.closeTo(
      await xctd.amount(BN(FUNDING_PER_USER).multipliedBy(USDC_TO_XCTD_RATIO).dividedBy(VESTING_PERIODS).multipliedBy(14)),
      30
    );

    expect(deltaXctdProject).to.be.bignumber.closeTo(
      await xctd.amount(BN(FUNDING_PER_USER).multipliedBy(USDC_TO_XCTD_RATIO).dividedBy(VESTING_PERIODS).multipliedBy(10)),
      30
    );

    expect(deltaUsdcUser).to.be.bignumber.closeTo(await mockUsdc.amount(BN(FUNDING_PER_USER).dividedBy(VESTING_PERIODS).multipliedBy(10)), 30);
    expect(deltaUsdcProject).to.be.bignumber.closeTo(await mockUsdc.amount(BN(FUNDING_PER_USER).dividedBy(VESTING_PERIODS).multipliedBy(14)), 30);

    // Ensure no remainders
    expect(deltaUsdcProject.plus(deltaUsdcUser)).to.be.bignumber.eq(await mockUsdc.amount(FUNDING_PER_USER));
    expect(deltaXctdProject.plus(deltaXctdUser)).to.be.bignumber.eq((await xctd.amount(FUNDING_PER_USER)).multipliedBy(USDC_TO_XCTD_RATIO));
  });

  it("project receives funding when claim is made", async () => {
    const startingBalance = await mockUsdc.methods.balanceOf(project).call();
    await insuredVesting.methods.addAllocation(user1, await mockUsdc.amount(FUNDING_PER_USER)).send({ from: deployer });
    await insuredVesting.methods.addFunds(await mockUsdc.amount(FUNDING_PER_USER)).send({ from: user1 });
    await advanceMonths(LOCKUP_MONTHS);
    await insuredVesting.methods.claim(user1).send({ from: anyUser });
    const currentBalance = await mockUsdc.methods.balanceOf(project).call();
    expect(currentBalance).to.be.bignumber.eq(BN(startingBalance).plus(await mockUsdc.amount(BN(FUNDING_PER_USER).dividedBy(VESTING_PERIODS))));
  });

  it("can claim usdc back for vesting period 1", async () => {
    const projectXctdStartBalance = BN(await xctd.methods.balanceOf(project).call());
    const userUsdcStartBalance = BN(await xctd.methods.balanceOf(project).call());

    await insuredVesting.methods.addAllocation(user1, await mockUsdc.amount(FUNDING_PER_USER)).send({ from: deployer });
    await insuredVesting.methods.addFunds(await mockUsdc.amount(FUNDING_PER_USER)).send({ from: user1 });
    await advanceMonths(LOCKUP_MONTHS);

    await insuredVesting.methods.toggleDecision().send({ from: user1 });
    await insuredVesting.methods.claim(user1).send({ from: anyUser });

    expect(await xctd.methods.balanceOf(project).call()).to.be.bignumber.closeTo(
      projectXctdStartBalance
        .plus(await xctd.amount(FUNDING_PER_USER))
        .multipliedBy(USDC_TO_XCTD_RATIO)
        .dividedBy(VESTING_PERIODS),
      await xctd.amount(0.1)
    );
    expect(await mockUsdc.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
      userUsdcStartBalance.plus(BN(await mockUsdc.amount(FUNDING_PER_USER)).dividedBy(VESTING_PERIODS)),
      await mockUsdc.amount(0.1)
    );
  });

  it("user cannot fund if does not have allocation", async () => {
    await expectRevert(async () => insuredVesting.methods.addFunds(await mockUsdc.amount(FUNDING_PER_USER)).send({ from: user1 }), "amount exceeds allocation");
  });

  it("user cannot add more funds than allocation", async () => {
    await insuredVesting.methods.addAllocation(user1, await mockUsdc.amount(FUNDING_PER_USER)).send({ from: deployer });
    await insuredVesting.methods.addFunds(await mockUsdc.amount(FUNDING_PER_USER)).send({ from: user1 });
    await expectRevert(async () => insuredVesting.methods.addFunds(await mockUsdc.amount(1)).send({ from: user1 }), "amount exceeds allocation");
  });

  it("cannot set amounts after period started", async () => {
    await advanceMonths(LOCKUP_MONTHS);
    await expectRevert(
      async () => insuredVesting.methods.addAllocation(user1, await mockUsdc.amount(FUNDING_PER_USER)).send({ from: deployer }),
      "vesting already started"
    );
  });

  it("cannot set start time after period started", async () => {
    await advanceMonths(LOCKUP_MONTHS);
    await expectRevert(async () => insuredVesting.methods.setStartTime(await getCurrentTimestamp()).send({ from: deployer }), "vesting already started");
  });

  it("owner can set project address", async () => {
    expect(await insuredVesting.methods.project().call()).to.be.not.eq(anyUser);
    await insuredVesting.methods.setProjectAddress(anyUser).send({ from: deployer });
    expect(await insuredVesting.methods.project().call()).to.be.eq(anyUser);
  });

  it("cannot set start time after period started", async () => {
    await expectRevert(
      async () => insuredVesting.methods.setStartTime(BN(await getCurrentTimestamp()).minus(100)).send({ from: deployer }),
      "cannot set start time in the past"
    );
  });

  it("cannot add funds after period started", async () => {
    await advanceMonths(LOCKUP_MONTHS);
    await expectRevert(async () => insuredVesting.methods.addFunds(1).send({ from: user1 }), "vesting already started");
  });

  describe("emergency release", () => {
    it("owner can emergency release vesting period, user hasn't claimed XCTD yet", async () => {
      await insuredVesting.methods.addAllocation(user1, await xctd.amount(FUNDING_PER_USER)).send({ from: deployer });
      await insuredVesting.methods.addFunds(await mockUsdc.amount(FUNDING_PER_USER)).send({ from: user1 });
      await insuredVesting.methods.emergencyReleaseVesting().send({ from: deployer });
      await insuredVesting.methods.emergencyClaim(user1).send({ from: anyUser });
      expect(await mockUsdc.methods.balanceOf(user1).call()).to.be.bignumber.eq(await mockUsdc.amount(FUNDING_PER_USER));
    });

    it("owner can emergency release vesting period, user claimed some XCTD", async () => {
      await insuredVesting.methods.addAllocation(user1, await xctd.amount(FUNDING_PER_USER)).send({ from: deployer });
      await insuredVesting.methods.addFunds(await mockUsdc.amount(FUNDING_PER_USER)).send({ from: user1 });
      await advanceMonths(LOCKUP_MONTHS + 2);
      await insuredVesting.methods.claim(user1).send({ from: deployer });
      await insuredVesting.methods.emergencyReleaseVesting().send({ from: deployer });

      await insuredVesting.methods.emergencyClaim(user1).send({ from: anyUser });
      expect(await mockUsdc.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
        BN(await mockUsdc.amount(FUNDING_PER_USER)).minus(
          BN(await mockUsdc.amount(FUNDING_PER_USER))
            .div(VESTING_PERIODS)
            .multipliedBy(3)
        ),
        30
      );
    });

    it("cannot claim once emergency released", async () => {
      await insuredVesting.methods.addAllocation(user1, await xctd.amount(FUNDING_PER_USER)).send({ from: deployer });
      await insuredVesting.methods.addFunds(await mockUsdc.amount(FUNDING_PER_USER)).send({ from: user1 });
      await insuredVesting.methods.emergencyReleaseVesting().send({ from: deployer });
      await advanceMonths(LOCKUP_MONTHS);
      await expectRevert(async () => insuredVesting.methods.claim(user1).send({ from: anyUser }), "emergency released");
    });

    it("cannot emergency claim if owner hasn't released", async () => {
      await insuredVesting.methods.addAllocation(user1, await xctd.amount(FUNDING_PER_USER)).send({ from: deployer });
      await insuredVesting.methods.addFunds(await mockUsdc.amount(FUNDING_PER_USER)).send({ from: user1 });
      await expectRevert(() => insuredVesting.methods.emergencyClaim(user1).send({ from: anyUser }), "emergency not released");
    });
  });

  describe("recovery", () => {
    it("recovers ether", async () => {
      const startingBalance = await web3().eth.getBalance(deployer);
      expect(await web3().eth.getBalance(insuredVesting.options.address)).to.bignumber.eq(0);
      await setBalance(insuredVesting.options.address, BN(12345 * 1e18));
      await insuredVesting.methods.recover(xctd.options.address).send({ from: deployer });
      expect(await web3().eth.getBalance(insuredVesting.options.address)).to.be.bignumber.zero;
      expect(await web3().eth.getBalance(deployer)).to.bignumber.closeTo(BN(12345 * 1e18).plus(startingBalance), BN(0.1e18));
    });

    it("recovers other tokens", async () => {
      await someOtherToken.methods.transfer(insuredVesting.options.address, BN(12345 * 1e18)).send({ from: deployer });
      await insuredVesting.methods.recover(someOtherToken.options.address).send({ from: deployer });
      expect(await someOtherToken.methods.balanceOf(insuredVesting.options.address).call()).to.be.bignumber.zero;
    });

    // TODO does retrieiving XCTD work only based off allocations or do we have the option to cancel before vesting started.
    it("recovers unallocated xctd", async () => {
      await insuredVesting.methods.addAllocation(user1, await mockUsdc.amount(FUNDING_PER_USER)).send({ from: deployer });
      // await insuredVesting.methods.addAllocation(user2, await mockUsdc.amount(1000)).send({ from: deployer });
      await insuredVesting.methods.recover(xctd.options.address).send({ from: deployer });
      // Recover all but the tokens allocated to users
      expect(await xctd.methods.balanceOf(insuredVesting.options.address).call()).to.be.bignumber.eq(
        (await xctd.amount(FUNDING_PER_USER * 2)).multipliedBy(USDC_TO_XCTD_RATIO)
      );
    });

    // TODO ensure that once funds were added we can't recover XCTDs for them
  });

  describe("access control", () => {
    it("cannot set start time if not owner", async () => {
      await expectRevert(
        async () => insuredVesting.methods.setStartTime(await getCurrentTimestamp()).send({ from: anyUser }),
        "Ownable: caller is not the owner"
      );
    });

    it("cannot add allocations if not owner", async () => {
      await expectRevert(async () => insuredVesting.methods.addAllocation(user1, 1).send({ from: anyUser }), "Ownable: caller is not the owner");
    });

    it("cannot recover if not owner", async () => {
      await expectRevert(async () => insuredVesting.methods.recover(xctd.options.address).send({ from: anyUser }), "Ownable: caller is not the owner");
    });

    it("cannot change project address if not owner", async () => {
      await expectRevert(async () => insuredVesting.methods.setProjectAddress(anyUser).send({ from: anyUser }), "Ownable: caller is not the owner");
    });

    it("cannot change project address if not owner", async () => {
      await expectRevert(async () => insuredVesting.methods.emergencyReleaseVesting().send({ from: anyUser }), "Ownable: caller is not the owner");
    });
  });
});
