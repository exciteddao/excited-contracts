import { expect } from "chai";
import BN from "bignumber.js";
import { deployArtifact, expectRevert, setBalance } from "@defi.org/web3-candies/dist/hardhat";
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
  MONTH,
  getDefaultStartTime,
  Error,
  advanceDays,
  DAY,
  VESTING_DURATION_SECONDS,
} from "./fixture";
import { web3 } from "@defi.org/web3-candies";
import { UninsuredVestingV1 } from "../../typechain-hardhat/contracts/uninsured-vesting-v1/UninsuredVestingV1";

async function advanceToStartTime() {
  await advanceMonths(LOCKUP_MONTHS);
}

describe("UninsuredVestingV1", () => {
  beforeEach(async () => withFixture());

  describe("with lockup period set", () => {
    const testCases = [0, 1, 5, 10, 100, 200, 534];

    for (const days of testCases) {
      it(`can claim tokens proportional to amount of seconds in ${days} days passed`, async () => {
        await uninsuredVesting.methods.addAmount(user1, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer });
        await advanceToStartTime();
        await advanceDays(days);
        await uninsuredVesting.methods.claim(user1).send({ from: anyUser });

        expect(await xctd.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
          (await xctd.amount(TOKENS_PER_USER)).multipliedBy(days * DAY).dividedBy(VESTING_DURATION_SECONDS),
          await xctd.amount(0.01)
        );
      });
    }

    it(`can claim tokens for the entire period`, async () => {
      await uninsuredVesting.methods.addAmount(user1, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer });
      await advanceToStartTime();
      await advanceDays(VESTING_DURATION_SECONDS);
      await uninsuredVesting.methods.claim(user1).send({ from: anyUser });

      expect(await xctd.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(await xctd.amount(TOKENS_PER_USER), await xctd.amount(0.01));
    });

    it(`can claim tokens for the entire period, longer than vesting period has passed`, async () => {
      await uninsuredVesting.methods.addAmount(user1, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer });
      await advanceToStartTime();
      await advanceDays(VESTING_DURATION_SECONDS * 2);
      await uninsuredVesting.methods.claim(user1).send({ from: anyUser });

      expect(await xctd.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(await xctd.amount(TOKENS_PER_USER), await xctd.amount(0.01));
    });

    it("cannot double-claim tokens for same period of time", async () => {
      await uninsuredVesting.methods.addAmount(user1, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer });
      await advanceToStartTime();
      const daysToAdvance = 66;
      await advanceDays(daysToAdvance);

      await uninsuredVesting.methods.claim(user1).send({ from: anyUser });
      const balanceAfterFirstClaim = await xctd.methods.balanceOf(user1).call();
      expect(balanceAfterFirstClaim).to.be.bignumber.closeTo(
        (await xctd.amount(TOKENS_PER_USER)).multipliedBy(daysToAdvance * DAY).dividedBy(VESTING_DURATION_SECONDS),
        await xctd.amount(0.01)
      );

      await uninsuredVesting.methods.claim(user1).send({ from: anyUser });
      expect(await xctd.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(balanceAfterFirstClaim, await xctd.amount(0.01));
    });

    it("cannot claim tokens before starting period", async () => {
      await uninsuredVesting.methods.addAmount(user1, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer });
      await expectRevert(() => uninsuredVesting.methods.claim(user1).send({ from: anyUser }), Error.VestingNotStarted);
    });

    it("cannot claim if there's no eligibility", async () => {
      await advanceToStartTime();
      await advanceDays(1);
      await expectRevert(() => uninsuredVesting.methods.claim(user1).send({ from: anyUser }), Error.NothingToClaim);
    });

    it("cannot set amounts after period started", async () => {
      await advanceToStartTime();
      await expectRevert(
        async () => uninsuredVesting.methods.addAmount(user1, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer }),
        Error.VestingAlreadyStarted
      );
    });

    it("cannot set start time after period started", async () => {
      await advanceToStartTime();
      await expectRevert(async () => uninsuredVesting.methods.setStartTime(await getCurrentTimestamp()).send({ from: deployer }), Error.VestingAlreadyStarted);
    });

    it("cannot set start time after period started", async () => {
      const newStartTime = BN(await getCurrentTimestamp()).minus(100);
      await expectRevert(
        async () => uninsuredVesting.methods.setStartTime(newStartTime).send({ from: deployer }),
        `${Error.StartTimeNotInFuture}(${newStartTime})`
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

  describe("deployment", () => {
    it("startTime must be more than 7 days from deployment time", async () => {
      await expectRevert(
        async () => await deployArtifact<UninsuredVestingV1>("UninsuredVestingV1", { from: deployer }, [xctd.options.address, await getCurrentTimestamp()]),
        Error.StartTimeTooSoon
      );
    });
  });
});
