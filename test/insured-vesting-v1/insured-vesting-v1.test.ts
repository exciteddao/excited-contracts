import { expect } from "chai";
import BN from "bignumber.js";
import { deployArtifact, expectRevert, setBalance } from "@defi.org/web3-candies/dist/hardhat";
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
  MONTH,
  user2,
  additionalUsers,
  setup,
  getDefaultStartTime,
} from "./fixture";
import { bn18, bn6, web3 } from "@defi.org/web3-candies";
import { InsuredVestingV1 } from "../../typechain-hardhat/contracts/insured-vesting-v1/InsuredVestingV1";

/*
  TODOs:
  - Check extreme cases / complex:
    - large amount of funding
    - many months passing
    - large of amount users, different fundings
    - toggling

 */

describe("InsuredVestingV1", () => {
  const balances = {
    project: {
      xctd: BN(-1),
      usdc: BN(-1),
    },
    user1: {
      xctd: BN(-1),
      usdc: BN(-1),
    },
  };

  async function setBalancesForDelta() {
    balances.user1.usdc = BN(await mockUsdc.methods.balanceOf(user1).call());
    balances.user1.xctd = BN(await xctd.methods.balanceOf(user1).call());
    balances.project.usdc = BN(await mockUsdc.methods.balanceOf(project).call());
    balances.project.xctd = BN(await xctd.methods.balanceOf(project).call());
  }

  async function vestedAmount(months: number, token: "usdc" | "xctd") {
    let amount = BN(FUNDING_PER_USER).dividedBy(VESTING_PERIODS).multipliedBy(months);
    if (token === "xctd") {
      return xctd.amount(amount.multipliedBy(USDC_TO_XCTD_RATIO));
    } else {
      return mockUsdc.amount(amount);
    }
  }

  async function expectBalanceDelta(target: "project" | "user1", token: "usdc" | "xctd", expectedDelta: BN | number, closeTo = 0) {
    const amount = BN(await (token === "xctd" ? xctd : mockUsdc).methods.balanceOf(target === "user1" ? user1 : project).call());
    return expect(amount.minus(balances[target][token])).to.bignumber.closeTo(expectedDelta, closeTo);
  }

  async function expectUserBalanceDelta(token: "usdc" | "xctd", expectedDelta: BN | number, closeTo = 0) {
    return expectBalanceDelta("user1", token, expectedDelta, closeTo);
  }

  async function expectProjectBalanceDelta(token: "usdc" | "xctd", expectedDelta: BN | number, closeTo = 0) {
    return expectBalanceDelta("project", token, expectedDelta, closeTo);
  }

  before(async () => await setup());

  beforeEach(async () => {
    await withFixture();
  });

  describe("with lockup period set", () => {
    beforeEach(async () => {
      await withFixture();
      await insuredVesting.methods.setStartTime(BN(await getCurrentTimestamp()).plus(LOCKUP_MONTHS * MONTH)).send({ from: deployer });
    });

    describe("claim", () => {
      it("can claim tokens for vesting period 1", async () => {
        await addAllocationForUser1();
        await addFundingFromUser1();
        await setBalancesForDelta();
        await advanceMonths(LOCKUP_MONTHS);
        await insuredVesting.methods.claim(user1).send({ from: anyUser });
        await expectUserBalanceDelta("xctd", await vestedAmount(1, "xctd"));
        await expectUserBalanceDelta("usdc", 0);
      });

      it("can claim tokens for vesting period 1, multiple allocations/fundings", async () => {
        await addAllocationForUser1(FUNDING_PER_USER / 4);
        await addFundingFromUser1(FUNDING_PER_USER / 4);
        await advanceMonths(1);
        await addAllocationForUser1(FUNDING_PER_USER / 4);
        await addFundingFromUser1(FUNDING_PER_USER / 4);
        await advanceMonths(1);
        await addAllocationForUser1(FUNDING_PER_USER / 4);
        await addFundingFromUser1(FUNDING_PER_USER / 4);
        await advanceMonths(1);
        await addAllocationForUser1(FUNDING_PER_USER / 4);
        await addFundingFromUser1(FUNDING_PER_USER / 4);
        await setBalancesForDelta();
        await advanceMonths(LOCKUP_MONTHS - 3);
        await insuredVesting.methods.claim(user1).send({ from: anyUser });
        await expectUserBalanceDelta("xctd", await vestedAmount(1, "xctd"));
        await expectUserBalanceDelta("usdc", 0);
      });

      it("can claim tokens for multiple users, random amounts", async () => {
        const additionalUsersFunding = [];

        for (const user of additionalUsers) {
          const amountToAllocate = Math.round(10 + (Math.random() * FUNDING_PER_USER - 10));
          await insuredVesting.methods.addAllocation(user, await mockUsdc.amount(FUNDING_PER_USER)).send({ from: deployer });
          const amountToFund = Math.round(10 + (Math.random() * amountToAllocate - 10));
          await insuredVesting.methods.addFunds(await mockUsdc.amount(amountToFund)).send({ from: user });
          additionalUsersFunding.push(amountToFund);
        }

        await addAllocationForUser1();
        await addFundingFromUser1();
        await setBalancesForDelta();
        await advanceMonths(LOCKUP_MONTHS);
        await insuredVesting.methods.claim(user1).send({ from: anyUser });
        await expectUserBalanceDelta("xctd", await vestedAmount(1, "xctd"));
        await expectUserBalanceDelta("usdc", 0);

        for (const [index, user] of additionalUsers.entries()) {
          const funding = additionalUsersFunding[index];
          expect(await xctd.methods.balanceOf(user).call()).to.be.bignumber.zero;
          await insuredVesting.methods.claim(user).send({ from: anyUser });
          expect(await xctd.methods.balanceOf(user).call()).to.be.bignumber.closeTo(
            (await xctd.amount(funding)).multipliedBy(USDC_TO_XCTD_RATIO).dividedBy(VESTING_PERIODS),
            1
          );
        }
      });

      it("can fund a partial allocation and claim tokens for vesting period 1", async () => {
        await addAllocationForUser1();
        await addFundingFromUser1(FUNDING_PER_USER / 2);
        await setBalancesForDelta();
        await advanceMonths(LOCKUP_MONTHS);
        await insuredVesting.methods.claim(user1).send({ from: anyUser });
        await expectUserBalanceDelta("xctd", (await vestedAmount(1, "xctd")).dividedBy(2));
        await expectUserBalanceDelta("usdc", 0);
      });

      it("can fund a partial allocation multiple times and claim tokens for vesting period 1", async () => {
        await addAllocationForUser1();
        await addFundingFromUser1(FUNDING_PER_USER / 4);
        await advanceMonths(2);
        await addFundingFromUser1(FUNDING_PER_USER / 4);
        await setBalancesForDelta();
        await advanceMonths(LOCKUP_MONTHS - 2);
        await insuredVesting.methods.claim(user1).send({ from: anyUser });
        await expectUserBalanceDelta("xctd", (await vestedAmount(1, "xctd")).dividedBy(2));
        await expectUserBalanceDelta("usdc", 0);
      });

      it("cannot claim tokens for vesting period 1 twice", async () => {
        await addAllocationForUser1();
        await addFundingFromUser1();
        await advanceMonths(LOCKUP_MONTHS);
        await insuredVesting.methods.claim(user1).send({ from: anyUser });
        await expectRevert(() => insuredVesting.methods.claim(user1).send({ from: anyUser }), "already claimed");
      });

      it("cannot claim tokens before starting period, zero time", async () => {
        await addAllocationForUser1();
        await addFundingFromUser1();
        await expectRevert(() => insuredVesting.methods.claim(user1).send({ from: anyUser }), "vesting has not started");
      });

      it("cannot claim tokens before starting period, some time has passed", async () => {
        await advanceMonths(LOCKUP_MONTHS / 2);
        await addAllocationForUser1();
        await addFundingFromUser1();
        await expectRevert(() => insuredVesting.methods.claim(user1).send({ from: anyUser }), "vesting has not started");
      });

      it("cannot claim if not funded", async () => {
        await advanceMonths(LOCKUP_MONTHS);
        await expectRevert(async () => insuredVesting.methods.claim(user1).send({ from: anyUser }), "no funds added");
      });

      it("can claim tokens for entire vesting period, exact months passed", async () => {
        await addAllocationForUser1();
        await addFundingFromUser1();
        await setBalancesForDelta();
        await advanceMonths(LOCKUP_MONTHS + VESTING_PERIODS - 1);
        await insuredVesting.methods.claim(user1).send({ from: anyUser });
        await expectUserBalanceDelta("xctd", await vestedAmount(VESTING_PERIODS, "xctd"));
        await expectUserBalanceDelta("usdc", 0);
      });

      it("can claim tokens for entire vesting period, many months passed", async () => {
        await addAllocationForUser1();
        await addFundingFromUser1();
        await setBalancesForDelta();
        await advanceMonths(LOCKUP_MONTHS + VESTING_PERIODS * 8);
        await insuredVesting.methods.claim(user1).send({ from: anyUser });
        await expectUserBalanceDelta("xctd", await vestedAmount(VESTING_PERIODS, "xctd"));
        await expectUserBalanceDelta("usdc", 0);
      });

      it("project receives funding when claim is made", async () => {
        await setBalancesForDelta();
        await addAllocationForUser1();
        await addFundingFromUser1();
        await advanceMonths(LOCKUP_MONTHS);
        await insuredVesting.methods.claim(user1).send({ from: anyUser });
        await expectProjectBalanceDelta("usdc", await vestedAmount(1, "usdc"));
        await expectProjectBalanceDelta("xctd", 0);
      });

      it("a user can view their last claimed period details", async () => {
        await setBalancesForDelta();
        await addAllocationForUser1();
        await addFundingFromUser1();
        await advanceMonths(LOCKUP_MONTHS);
        const initialClaimDetails = await insuredVesting.methods.lastClaimedDetails(user1).call();
        expect(initialClaimDetails[0]).to.be.bignumber.eq(0);
        await insuredVesting.methods.claim(user1).send({ from: anyUser });
        const lastClaimedDetails = await insuredVesting.methods.lastClaimedDetails(user1).call();
        expect(lastClaimedDetails[0]).to.be.bignumber.eq(1);
      });
    });

    describe("toggle decision", () => {
      it("can toggle decision and claim usdc back for vesting period 1 (toggle after vesting)", async () => {
        await addAllocationForUser1();
        await addFundingFromUser1();
        await setBalancesForDelta();

        await advanceMonths(LOCKUP_MONTHS);

        await insuredVesting.methods.toggleDecision().send({ from: user1 });
        await insuredVesting.methods.claim(user1).send({ from: anyUser });

        await expectUserBalanceDelta("xctd", 0);
        await expectProjectBalanceDelta("xctd", await vestedAmount(1, "xctd"));
        await expectUserBalanceDelta("usdc", await vestedAmount(1, "usdc"));
        await expectProjectBalanceDelta("usdc", 0);
      });

      it("can toggle decision and claim usdc back for vesting period 1 (toggle before vesting)", async () => {
        await addAllocationForUser1();
        await addFundingFromUser1();
        await setBalancesForDelta();

        await insuredVesting.methods.toggleDecision().send({ from: user1 });

        await advanceMonths(LOCKUP_MONTHS);

        await insuredVesting.methods.claim(user1).send({ from: anyUser });

        await expectUserBalanceDelta("xctd", 0);
        await expectProjectBalanceDelta("xctd", await vestedAmount(1, "xctd"));
        await expectUserBalanceDelta("usdc", await vestedAmount(1, "usdc"));
        await expectProjectBalanceDelta("usdc", 0);
      });

      it("can claim some tokens, some usdc for entire vesting period, use toggle multiple times", async () => {
        await addAllocationForUser1();
        await addFundingFromUser1();
        await setBalancesForDelta();

        // Claim for 11 months (remember that when LOCKUP_MONTHS has arrived, we're already in vesting period 1)
        await advanceMonths(LOCKUP_MONTHS + 10);
        await insuredVesting.methods.claim(user1).send({ from: anyUser });
        await expectUserBalanceDelta("xctd", await vestedAmount(11, "xctd"));
        await expectUserBalanceDelta("usdc", 0);
        await expectProjectBalanceDelta("xctd", 0);
        await expectProjectBalanceDelta("usdc", await vestedAmount(11, "usdc"));

        // Toggle, let 3 months pass and claim USDC (we're at month 14)
        await insuredVesting.methods.toggleDecision().send({ from: user1 });
        await advanceMonths(3);
        await insuredVesting.methods.claim(user1).send({ from: anyUser });
        await expectUserBalanceDelta("xctd", await vestedAmount(11, "xctd"));
        await expectUserBalanceDelta("usdc", await vestedAmount(3, "usdc"));
        await expectProjectBalanceDelta("xctd", await vestedAmount(3, "xctd"));
        await expectProjectBalanceDelta("usdc", await vestedAmount(11, "usdc"));

        // Let another 3 months pass, toggle again to token and claim (we're at month 17)
        await advanceMonths(3);
        await insuredVesting.methods.toggleDecision().send({ from: user1 });
        await insuredVesting.methods.claim(user1).send({ from: anyUser });
        await expectUserBalanceDelta("xctd", await vestedAmount(14, "xctd"));
        await expectUserBalanceDelta("usdc", await vestedAmount(3, "usdc"));
        await expectProjectBalanceDelta("xctd", await vestedAmount(3, "xctd"));
        await expectProjectBalanceDelta("usdc", await vestedAmount(14, "usdc"));

        // Toggle again and claim USDC for remaining periods (we're at month 24 - finished)
        await insuredVesting.methods.toggleDecision().send({ from: user1 });
        await advanceMonths(7);
        await insuredVesting.methods.claim(user1).send({ from: anyUser });

        await expectUserBalanceDelta("xctd", await vestedAmount(14, "xctd"), 1);
        await expectUserBalanceDelta("usdc", await vestedAmount(10, "usdc"), 1);
        await expectProjectBalanceDelta("xctd", await vestedAmount(10, "xctd"), 1);
        await expectProjectBalanceDelta("usdc", await vestedAmount(14, "usdc"), 1);

        // Update balances and verify no remainders
        await setBalancesForDelta();
        expect(balances.project.usdc.plus(balances.user1.usdc)).to.be.bignumber.eq(await mockUsdc.amount(FUNDING_PER_USER));
        expect(balances.project.xctd.plus(balances.user1.xctd)).to.be.bignumber.eq((await xctd.amount(FUNDING_PER_USER)).multipliedBy(USDC_TO_XCTD_RATIO));
      });
    });

    describe("add funds", () => {
      it("can add funds", async () => {
        await setBalancesForDelta();
        await addAllocationForUser1();
        await addFundingFromUser1();
        await expectUserBalanceDelta("usdc", (await mockUsdc.amount(FUNDING_PER_USER)).negated());
      });

      it("cannot add funds less than minimum required", async () => {
        await addAllocationForUser1();
        await expectRevert(async () => addFundingFromUser1(1), "amount must be greater than 10 USDC");
      });

      it("user cannot fund if does not have allocation", async () => {
        await expectRevert(
          async () => insuredVesting.methods.addFunds(await mockUsdc.amount(FUNDING_PER_USER)).send({ from: user1 }),
          "amount exceeds allocation"
        );
      });

      it("user cannot add more funds than allocation, two attempts", async () => {
        await addAllocationForUser1();
        await addFundingFromUser1();
        await expectRevert(async () => insuredVesting.methods.addFunds(await mockUsdc.amount(1)).send({ from: user1 }), "amount exceeds allocation");
      });

      it("user cannot add more funds than allocation, single attempts", async () => {
        await addAllocationForUser1();
        await expectRevert(
          async () => insuredVesting.methods.addFunds(await mockUsdc.amount(1 + FUNDING_PER_USER)).send({ from: user1 }),
          "amount exceeds allocation"
        );
      });

      it("cannot add funds after period started", async () => {
        await advanceMonths(LOCKUP_MONTHS);
        await expectRevert(async () => insuredVesting.methods.addFunds(1).send({ from: user1 }), "vesting already started");
      });
    });

    describe("admin", () => {
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
          "start time has to be in the future"
        );
      });
    });

    describe("emergency release", () => {
      it("owner can emergency release vesting period, user hasn't claimed XCTD yet", async () => {
        await addAllocationForUser1();
        await addFundingFromUser1();
        await insuredVesting.methods.emergencyReleaseVesting().send({ from: deployer });
        await insuredVesting.methods.emergencyClaim(user1).send({ from: anyUser });
        expect(await mockUsdc.methods.balanceOf(user1).call()).to.be.bignumber.eq(await mockUsdc.amount(FUNDING_PER_USER));
      });

      it("cannot emergency claim if hasn't funded", async () => {
        await addAllocationForUser1();
        await insuredVesting.methods.emergencyReleaseVesting().send({ from: deployer });
        await expectRevert(() => insuredVesting.methods.emergencyClaim(user1).send({ from: anyUser }), "no funds added");
      });

      it("owner can emergency release vesting period, user hasn't claimed XCTD yet", async () => {
        await addAllocationForUser1();
        await addFundingFromUser1();
        await insuredVesting.methods.emergencyReleaseVesting().send({ from: deployer });
        await insuredVesting.methods.emergencyClaim(user1).send({ from: anyUser });
        expect(await mockUsdc.methods.balanceOf(user1).call()).to.be.bignumber.eq(await mockUsdc.amount(FUNDING_PER_USER));
      });

      it("owner can emergency release vesting period, user claimed some XCTD", async () => {
        await addAllocationForUser1();
        await addFundingFromUser1();
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

      it("cannot regularly claim once emergency released", async () => {
        await addAllocationForUser1();
        await addFundingFromUser1();
        await insuredVesting.methods.emergencyReleaseVesting().send({ from: deployer });
        await advanceMonths(LOCKUP_MONTHS);
        await expectRevert(async () => insuredVesting.methods.claim(user1).send({ from: anyUser }), "emergency released");
      });

      it("cannot emergency claim if owner hasn't released", async () => {
        await addAllocationForUser1();
        await addFundingFromUser1();
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
        await addAllocationForUser1();
        await insuredVesting.methods.addAllocation(user2, await mockUsdc.amount(FUNDING_PER_USER)).send({ from: deployer });
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

  describe("deployment", () => {
    it("cannot deploy with USDC_TO_XCTD below 1:1 ratio", async () => {
      await expectRevert(
        async () =>
          deployArtifact<InsuredVestingV1>("InsuredVestingV1", { from: deployer }, [
            mockUsdc.options.address,
            xctd.options.address,
            project,
            VESTING_PERIODS,
            bn18(0.9).dividedBy(bn6(1)),
            await getDefaultStartTime(),
          ]),
        "minimum rate is 1 USDC:XCTD"
      );
    });

    it("cannot deploy with USDC_TO_XCTD above 10000:1 ratio", async () => {
      await expectRevert(
        async () =>
          deployArtifact<InsuredVestingV1>("InsuredVestingV1", { from: deployer }, [
            mockUsdc.options.address,
            xctd.options.address,
            project,
            VESTING_PERIODS,
            bn18(10_001).dividedBy(bn6(1)),
            await getDefaultStartTime(),
          ]),
        "maximum rate is 10000 USDC:XCTD"
      );
    });

    it("startTime must be more than 7 days from deployment time", async () => {
      await expectRevert(
        async () =>
          deployArtifact<InsuredVestingV1>("InsuredVestingV1", { from: deployer }, [
            mockUsdc.options.address,
            xctd.options.address,
            project,
            VESTING_PERIODS,
            bn18(USDC_TO_XCTD_RATIO).dividedBy(bn6(1)),
            await getCurrentTimestamp(),
          ]),
        "startTime must be more than 7 days from now"
      );
    });

    it("cannot deploy with fewer than 3 vesting periods", async () => {
      await expectRevert(
        async () =>
          deployArtifact<InsuredVestingV1>("InsuredVestingV1", { from: deployer }, [
            mockUsdc.options.address,
            xctd.options.address,
            project,
            0,
            bn18(USDC_TO_XCTD_RATIO).dividedBy(bn6(1)),
            await getDefaultStartTime(),
          ]),
        "periodCount must be at least 3"
      );
    });
  });
});

async function addFundingFromUser1(amount = FUNDING_PER_USER) {
  await insuredVesting.methods.addFunds(await mockUsdc.amount(amount)).send({ from: user1 });
}

async function addAllocationForUser1(amount = FUNDING_PER_USER) {
  await insuredVesting.methods.addAllocation(user1, await mockUsdc.amount(amount)).send({ from: deployer });
}
