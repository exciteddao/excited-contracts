import { expect } from "chai";
import BN from "bignumber.js";
import { SnapshotRestorer, takeSnapshot } from "@nomicfoundation/hardhat-network-helpers";
import { expectRevert, setBalance } from "@defi.org/web3-candies/dist/hardhat";
import {
  FUNDING_PER_USER,
  LOCKUP_MONTHS,
  FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO,
  anyUser,
  projectWallet,
  user1,
  insuredVesting,
  withFixture,
  projectToken,
  deployer,
  someOtherToken,
  user2,
  additionalUsers,
  setup,
  Error,
  VESTING_DURATION_SECONDS,
  VESTING_DURATION_DAYS,
  transferProjectTokenToVesting,
  approveProjectTokenToVesting,
  addFundingFromUser1,
  addFundingFromUser2,
  setAllowedAllocationForUser1,
  setAllowedAllocationForUser2,
  Event,
  expectProjectBalanceDelta,
  expectUserBalanceDelta,
  setBalancesForDelta,
  vestedAmount,
  balances,
  fundingToken,
  fundFundingTokenFromWhale,
  PROJECT_TOKENS_ON_SALE,
  activateAndReachStartTime,
  getDefaultStartTime,
  daoWallet,
  differentProjectWallet,
} from "./fixture";
import { account, web3, zeroAddress } from "@defi.org/web3-candies";
import { advanceDays, DAY, getCurrentTimestamp, advanceMonths, MONTH, generateAccessControlErrorMsg } from "../utils";

describe("InsuredVestingV1", () => {
  let snap: SnapshotRestorer;

  beforeEach(async () => {
    snap = await takeSnapshot();
    await setup();
    await withFixture();
  });

  afterEach(async () => {
    await snap.restore();
  });

  describe("with PROJECT_TOKEN approved to contract", () => {
    beforeEach(async () => {
      approveProjectTokenToVesting();
    });

    describe("claim", () => {
      const testCases = [0, 1, 5, 10, 100, 200, 534];

      for (const days of testCases) {
        it(`can claim tokens proportional to amount of seconds in ${days} days passed`, async () => {
          await setAllowedAllocationForUser1();
          await addFundingFromUser1();
          await activateAndReachStartTime();
          await advanceDays(days);
          await insuredVesting.methods.claim(user1).send({ from: user1 });

          await expectUserBalanceDelta("projectToken", await vestedAmount(days, "projectToken"));
          await expectUserBalanceDelta("fundingToken", 0);
        });
      }

      it("does not vest before start time", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();
        await insuredVesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
        await advanceDays(1);
        expect(await insuredVesting.methods.fundingTokenVestedFor(user1).call()).to.be.bignumber.zero;
        await advanceDays(3);
        expect(await insuredVesting.methods.fundingTokenVestedFor(user1).call()).to.be.bignumber.to.be.bignumber.closeTo(
          (await fundingToken.amount(FUNDING_PER_USER)).multipliedBy(1 * DAY).dividedBy(VESTING_DURATION_SECONDS),
          await fundingToken.amount(0.01)
        );
      });

      it("starts vesting if activated with current time stamp", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();
        await insuredVesting.methods.activate(BN(await getCurrentTimestamp()).plus(1)).send({ from: projectWallet });
        await advanceDays(1);
        await insuredVesting.methods.claim(user1).send({ from: user1 });

        expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
          (await projectToken.amount(FUNDING_PER_USER))
            .multipliedBy(FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO)
            .multipliedBy(1 * DAY)
            .dividedBy(VESTING_DURATION_SECONDS),
          await projectToken.amount(0.01)
        );
      });

      it("can claim tokens for vesting period 1, multiple fundings", async () => {
        await setAllowedAllocationForUser1(FUNDING_PER_USER);
        await addFundingFromUser1(FUNDING_PER_USER / 4);
        await advanceMonths(1);
        await addFundingFromUser1(FUNDING_PER_USER / 4);
        await advanceMonths(1);
        await addFundingFromUser1(FUNDING_PER_USER / 4);
        await advanceMonths(1);
        await addFundingFromUser1(FUNDING_PER_USER / 4);
        await setBalancesForDelta();
        await advanceMonths(LOCKUP_MONTHS - 3);
        await activateAndReachStartTime();
        await advanceDays(6);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("projectToken", await vestedAmount(6, "projectToken"));
        await expectUserBalanceDelta("fundingToken", 0);
      });

      it("can claim tokens for multiple users, random amounts", async () => {
        const additionalUsersFunding = [];

        for (const user of additionalUsers) {
          const amountToAllocate = 10 + Math.round(Math.random() * (FUNDING_PER_USER - 10));
          await insuredVesting.methods.setAllowedAllocation(user, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
          const amountToFund = 10 + Math.round(Math.random() * (amountToAllocate - 10));
          await insuredVesting.methods.addFunds(await fundingToken.amount(amountToFund)).send({ from: user });
          additionalUsersFunding.push(amountToFund);
        }

        await setAllowedAllocationForUser1();
        await addFundingFromUser1();
        await setBalancesForDelta();
        await activateAndReachStartTime();
        await advanceDays(30);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("projectToken", await vestedAmount(30, "projectToken"));
        await expectUserBalanceDelta("fundingToken", 0);

        for (const [index, user] of additionalUsers.entries()) {
          const funding = additionalUsersFunding[index];
          expect(await projectToken.methods.balanceOf(user).call()).to.be.bignumber.zero;
          await insuredVesting.methods.claim(user).send({ from: user });
          expect(await projectToken.methods.balanceOf(user).call()).to.be.bignumber.closeTo(
            (await projectToken.amount(funding))
              .multipliedBy(FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO)
              .multipliedBy(30 * DAY)
              .dividedBy(VESTING_DURATION_SECONDS),
            await projectToken.amount(0.1)
          );
        }
      });

      it("can fund a partial allowed allocation and claim tokens", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1(FUNDING_PER_USER / 3);
        await setBalancesForDelta();
        await activateAndReachStartTime();
        await advanceDays(20);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("projectToken", (await vestedAmount(20, "projectToken")).dividedBy(3));
        await expectUserBalanceDelta("fundingToken", 0);
      });

      it("can fund a partial allowed allocation multiple times and claim tokens for vesting period 1", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1(FUNDING_PER_USER / 4);
        await advanceMonths(2);
        await addFundingFromUser1(FUNDING_PER_USER / 4);
        await setBalancesForDelta();
        await advanceMonths(LOCKUP_MONTHS - 2);
        await activateAndReachStartTime();
        await advanceDays(20);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("projectToken", (await vestedAmount(20, "projectToken")).dividedBy(2));
        await expectUserBalanceDelta("fundingToken", 0);
      });

      it("cannot double-claim tokens for same period of time", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();
        await activateAndReachStartTime();
        await advanceDays(45);

        await insuredVesting.methods.claim(user1).send({ from: user1 });

        await setBalancesForDelta();
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("projectToken", 0);
      });

      it("cannot claim tokens before starting period, zero time, not activated", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();
        await expectRevert(() => insuredVesting.methods.claim(user1).send({ from: user1 }), Error.VestingNotStarted);
      });

      it("cannot claim tokens before starting period, some time has passed, not activated", async () => {
        await advanceMonths(LOCKUP_MONTHS / 2);
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();
        await expectRevert(() => insuredVesting.methods.claim(user1).send({ from: user1 }), Error.VestingNotStarted);
      });

      it("cannot claim tokens before starting period - activated", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();
        await insuredVesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
        await expectRevert(() => insuredVesting.methods.claim(user1).send({ from: user1 }), Error.VestingNotStarted);
        await advanceDays(1);
        await expectRevert(() => insuredVesting.methods.claim(user1).send({ from: user1 }), Error.VestingNotStarted);
      });

      it("cannot claim if not funded", async () => {
        await advanceMonths(LOCKUP_MONTHS);
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();
        await activateAndReachStartTime();
        await expectRevert(async () => insuredVesting.methods.claim(user2).send({ from: user2 }), Error.NoFundsAdded);
      });

      it("can claim tokens for the entire vesting period", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();
        await setBalancesForDelta();
        await activateAndReachStartTime();
        await advanceDays(VESTING_DURATION_DAYS);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("projectToken", await projectToken.amount(FUNDING_PER_USER * FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO));
        await expectUserBalanceDelta("fundingToken", 0);
      });

      it("can claim tokens for entire vesting period, many months passed", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();
        await setBalancesForDelta();
        await activateAndReachStartTime();
        await advanceDays(VESTING_DURATION_DAYS * 3);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("projectToken", await projectToken.amount(FUNDING_PER_USER * FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO));
        await expectUserBalanceDelta("fundingToken", 0);
      });

      it("project receives funding when claim is made", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();
        await activateAndReachStartTime();
        await setBalancesForDelta();
        await advanceDays(77);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectProjectBalanceDelta("fundingToken", await vestedAmount(77, "fundingToken"));
        await expectProjectBalanceDelta("projectToken", 0);
      });

      it("project can claim on behalf of user", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();
        await activateAndReachStartTime();
        await setBalancesForDelta();
        await advanceDays(77);
        await insuredVesting.methods.claim(user1).send({ from: projectWallet });
        await expectProjectBalanceDelta("fundingToken", await vestedAmount(77, "fundingToken"));
        await expectProjectBalanceDelta("projectToken", 0);
      });

      it("cannot claim if not user or project", async () => {
        await setBalancesForDelta();
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();
        await activateAndReachStartTime();
        await advanceDays(77);
        await expectRevert(() => insuredVesting.methods.claim(user1).send({ from: anyUser }), Error.OnlyProjectOrSender);
      });

      it("claim according to updated funding if allocation was updated", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();
        await setAllowedAllocationForUser1(FUNDING_PER_USER / 4);
        await activateAndReachStartTime();
        await advanceDays(77);
        await setBalancesForDelta();
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("projectToken", (await vestedAmount(77, "projectToken")).dividedBy(4));
      });
    });

    describe("set decision for refund", () => {
      it("can set decision and claim fundingToken back (after vesting)", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();

        await activateAndReachStartTime();
        await setBalancesForDelta();

        await advanceDays(30);

        await insuredVesting.methods.setDecision(true).send({ from: user1 });
        await insuredVesting.methods.claim(user1).send({ from: user1 });

        await expectUserBalanceDelta("projectToken", 0);
        await expectProjectBalanceDelta("projectToken", await vestedAmount(30, "projectToken"));
        await expectUserBalanceDelta("fundingToken", await vestedAmount(30, "fundingToken"));
        await expectProjectBalanceDelta("fundingToken", 0);
      });

      it("can set decision and claim fundingToken back (before vesting)", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();

        await insuredVesting.methods.setDecision(true).send({ from: user1 });

        await activateAndReachStartTime();
        await setBalancesForDelta();

        await advanceDays(30);

        await insuredVesting.methods.claim(user1).send({ from: user1 });

        await expectUserBalanceDelta("projectToken", 0);
        await expectProjectBalanceDelta("projectToken", await vestedAmount(30, "projectToken"));
        await expectUserBalanceDelta("fundingToken", await vestedAmount(30, "fundingToken"));
        await expectProjectBalanceDelta("fundingToken", 0);
      });

      it("can claim some tokens, some fundingToken for entire vesting period, use setDecision multiple times", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();

        // Claim for 11 months
        await activateAndReachStartTime();
        await setBalancesForDelta();
        const currentProjectTokenBalance = balances.project.projectToken;

        await advanceDays(11 * 30);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("projectToken", await vestedAmount(11 * 30, "projectToken"));
        await expectUserBalanceDelta("fundingToken", 0);
        await expectProjectBalanceDelta("projectToken", 0);
        await expectProjectBalanceDelta("fundingToken", await vestedAmount(11 * 30, "fundingToken"));

        // Set decision, let 3 months pass and claim FUNDING_TOKEN (we're at month 14)
        await insuredVesting.methods.setDecision(true).send({ from: user1 });
        await advanceDays(3 * 30);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("projectToken", await vestedAmount(11 * 30, "projectToken"));
        await expectUserBalanceDelta("fundingToken", await vestedAmount(3 * 30, "fundingToken"));
        await expectProjectBalanceDelta("projectToken", await vestedAmount(3 * 30, "projectToken"));
        await expectProjectBalanceDelta("fundingToken", await vestedAmount(11 * 30, "fundingToken"));

        // Let another 3 months pass, set decision again to token and claim (we're at month 17)
        await advanceDays(3 * 30);
        await insuredVesting.methods.setDecision(false).send({ from: user1 });
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("projectToken", await vestedAmount(14 * 30, "projectToken"));
        await expectUserBalanceDelta("fundingToken", await vestedAmount(3 * 30, "fundingToken"));
        await expectProjectBalanceDelta("projectToken", await vestedAmount(3 * 30, "projectToken"));
        await expectProjectBalanceDelta("fundingToken", await vestedAmount(14 * 30, "fundingToken"));

        // Set decision again and claim FUNDING_TOKEN for remaining periods (we're at month 24 - finished)
        await insuredVesting.methods.setDecision(true).send({ from: user1 });
        await advanceDays(220);
        await insuredVesting.methods.claim(user1).send({ from: user1 });

        // Update balances and verify no remainders
        await setBalancesForDelta();
        expect(balances.project.fundingToken.plus(balances.user1.fundingToken)).to.be.bignumber.eq(await fundingToken.amount(FUNDING_PER_USER));
        expect(balances.project.projectToken.plus(balances.user1.projectToken)).to.be.bignumber.eq(
          (await projectToken.amount(FUNDING_PER_USER)).multipliedBy(FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO).plus(currentProjectTokenBalance)
        );
      });

      it("cannot set decision if has not funded", async () => {
        await setAllowedAllocationForUser1();

        await expectRevert(() => insuredVesting.methods.setDecision(true).send({ from: user1 }), Error.NoFundsAdded);
      });

      it("setting same decision multiple times is idempotent", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();

        expect((await insuredVesting.methods.userVestings(user1).call()).shouldRefund).to.be.false;
        await insuredVesting.methods.setDecision(true).send({ from: user1 });
        expect((await insuredVesting.methods.userVestings(user1).call()).shouldRefund).to.be.true;
        await insuredVesting.methods.setDecision(true).send({ from: user1 });
        expect((await insuredVesting.methods.userVestings(user1).call()).shouldRefund).to.be.true;

        await insuredVesting.methods.setDecision(false).send({ from: user1 });
        expect((await insuredVesting.methods.userVestings(user1).call()).shouldRefund).to.be.false;
        await insuredVesting.methods.setDecision(false).send({ from: user1 });
        expect((await insuredVesting.methods.userVestings(user1).call()).shouldRefund).to.be.false;
      });
    });

    describe("add funds", () => {
      it("can add funds", async () => {
        await setBalancesForDelta();
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();
        await expectUserBalanceDelta("fundingToken", (await fundingToken.amount(FUNDING_PER_USER)).negated());
      });

      it("can add 1 wei amounts of FUNDING_TOKEN, fully vested", async () => {
        await setBalancesForDelta();
        await setAllowedAllocationForUser1();
        await insuredVesting.methods.addFunds(1).send({ from: user1 });
        await expectUserBalanceDelta("fundingToken", -1);
        await activateAndReachStartTime();
        await advanceDays(VESTING_DURATION_DAYS);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("projectToken", 1e12 * FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO, 0);
      });

      it("can add 1 wei amounts of FUNDING_TOKEN, partially vested", async () => {
        await setBalancesForDelta();
        await setAllowedAllocationForUser1();
        await insuredVesting.methods.addFunds(1).send({ from: user1 });
        await expectUserBalanceDelta("fundingToken", -1);
        await activateAndReachStartTime();
        await advanceDays(30);

        // This is a corner case where the amount funded is so little, it's indivisible relative to the time passed
        await expectRevert(async () => insuredVesting.methods.claim(user1).send({ from: user1 }), Error.NothingToClaim);
      });

      it("can add ~wei amounts of FUNDING_TOKEN, partially vested", async () => {
        await setBalancesForDelta();
        await setAllowedAllocationForUser1();
        await insuredVesting.methods.addFunds(100).send({ from: user1 });
        await expectUserBalanceDelta("fundingToken", -1);
        await activateAndReachStartTime();
        await advanceDays(30);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("projectToken", 4 * 1e12 * FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO, 0);
      });

      it("user cannot fund if does not have allowed allocation", async () => {
        const amount = await fundingToken.amount(FUNDING_PER_USER);
        await expectRevert(async () => insuredVesting.methods.addFunds(amount).send({ from: user1 }), `${Error.AllowedAllocationExceeded}(${amount})`);
      });

      it("user cannot add more funds than allowed allocation, two attempts", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();
        const amount = await fundingToken.amount(1);
        await expectRevert(async () => insuredVesting.methods.addFunds(amount).send({ from: user1 }), `${Error.AllowedAllocationExceeded}(${amount})`);
      });

      it("user cannot add more funds than allowed allocation, single attempts", async () => {
        await setAllowedAllocationForUser1();
        const amount = await fundingToken.amount(FUNDING_PER_USER + 1);
        await expectRevert(async () => insuredVesting.methods.addFunds(amount).send({ from: user1 }), `${Error.AllowedAllocationExceeded}(${amount})`);
      });

      it("cannot add funds after activation", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1(FUNDING_PER_USER / 2);
        await insuredVesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
        await expectRevert(async () => insuredVesting.methods.addFunds(1).send({ from: user1 }), Error.AlreadyActivated);
      });

      it("cannot add funds if emergency released", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1(FUNDING_PER_USER / 2);
        await insuredVesting.methods.emergencyRelease().send({ from: daoWallet });
        await expectRevert(async () => insuredVesting.methods.addFunds(1).send({ from: user1 }), Error.EmergencyReleased);
      });

      it("fails if user does not have enough balance", async () => {
        const amount = FUNDING_PER_USER + 1;
        await insuredVesting.methods.setAllowedAllocation(user1, await fundingToken.amount(amount)).send({ from: projectWallet });
        await expectRevert(
          async () => insuredVesting.methods.addFunds(await fundingToken.amount(amount)).send({ from: user1 }),
          "ERC20: transfer amount exceeds allowance"
        );
      });
    });

    describe("admin", () => {
      describe("set allowed allocation", () => {
        it("cannot set allowed allocation after activation", async () => {
          await setAllowedAllocationForUser1(FUNDING_PER_USER / 4);
          await addFundingFromUser1(FUNDING_PER_USER / 4);
          await insuredVesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
          await expectRevert(
            async () => insuredVesting.methods.setAllowedAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet }),
            Error.AlreadyActivated
          );
        });

        describe("existing excess deposit is refunded in case of allowed allocation decrease", () => {
          it("single user", async () => {
            await setBalancesForDelta();
            await setAllowedAllocationForUser1();
            await addFundingFromUser1();
            await expectUserBalanceDelta("fundingToken", (await fundingToken.amount(FUNDING_PER_USER)).negated(), 1);

            await setBalancesForDelta();
            const newAmount = FUNDING_PER_USER / 3;
            const newAllowedAllocation = await fundingToken.amount(newAmount);
            await insuredVesting.methods.setAllowedAllocation(user1, newAllowedAllocation).send({ from: projectWallet });

            // // check user FUNDING_TOKEN balance reflects refunded amount
            await expectUserBalanceDelta("fundingToken", await fundingToken.amount(FUNDING_PER_USER - newAmount), 1);
            // // check contract FUNDING_TOKEN balance has been updated
            expect(await fundingToken.methods.balanceOf(insuredVesting.options.address).call()).to.be.bignumber.eq(newAllowedAllocation);
            // // check user allocation has been updated
            expect((await insuredVesting.methods.userVestings(user1).call()).fundingTokenAllocation).to.be.bignumber.eq(newAllowedAllocation);
          });

          // TODO: multiple user scenarios
        });

        describe("setAllowedAllocation", () => {
          const testCases: { description: string; setAllowedAllocationsFn: () => Promise<any>; expectedAllocation: BN }[] = [
            {
              description: "single user",
              setAllowedAllocationsFn: async () =>
                await insuredVesting.methods.setAllowedAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet }),
              expectedAllocation: BN(FUNDING_PER_USER),
            },
            {
              description: "multiple users, smaller allocation added",
              setAllowedAllocationsFn: async () => {
                await insuredVesting.methods.setAllowedAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
                await insuredVesting.methods.setAllowedAllocation(user2, await fundingToken.amount(FUNDING_PER_USER / 5)).send({ from: projectWallet });
                await insuredVesting.methods.setAllowedAllocation(user1, await fundingToken.amount(FUNDING_PER_USER / 2)).send({ from: projectWallet });
              },
              expectedAllocation: BN(FUNDING_PER_USER / 2),
            },
            {
              description: "multiple users, larger allocation added",
              setAllowedAllocationsFn: async () => {
                await insuredVesting.methods.setAllowedAllocation(user2, await fundingToken.amount(FUNDING_PER_USER / 2)).send({ from: projectWallet });
                await insuredVesting.methods.setAllowedAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
                await insuredVesting.methods.setAllowedAllocation(user2, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
              },
              expectedAllocation: BN(FUNDING_PER_USER),
            },
            {
              description: "multiple users, allocation removed",
              setAllowedAllocationsFn: async () => {
                await insuredVesting.methods.setAllowedAllocation(user2, await fundingToken.amount(FUNDING_PER_USER / 2)).send({ from: projectWallet });
                await insuredVesting.methods.setAllowedAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
                await insuredVesting.methods.setAllowedAllocation(user2, await fundingToken.amount(0)).send({ from: projectWallet });
              },
              expectedAllocation: BN(FUNDING_PER_USER),
            },
            {
              description: "allocation increased after funding",
              setAllowedAllocationsFn: async () => {
                await insuredVesting.methods.setAllowedAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
                await insuredVesting.methods.setAllowedAllocation(user2, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
                await insuredVesting.methods.addFunds(await fundingToken.amount(FUNDING_PER_USER)).send({ from: user1 });
                await insuredVesting.methods.setAllowedAllocation(user1, await fundingToken.amount(FUNDING_PER_USER * 2)).send({ from: projectWallet });
              },
              expectedAllocation: BN(FUNDING_PER_USER * 2),
            },
          ];

          testCases.forEach(({ description, setAllowedAllocationsFn, expectedAllocation }) => {
            it(description, async () => {
              await setAllowedAllocationsFn();
              const actualFundingTokenAllocation = (await insuredVesting.methods.userVestings(user1).call()).fundingTokenAllocation;
              expect(actualFundingTokenAllocation).to.be.bignumber.eq(await fundingToken.amount(expectedAllocation));
            });
          });
        });
      });

      it("cannot set allocation if emergency released", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();
        await insuredVesting.methods.emergencyRelease().send({ from: daoWallet });
        await expectRevert(() => insuredVesting.methods.setAllowedAllocation(user1, 1).send({ from: projectWallet }), Error.EmergencyReleased);
      });
    });

    describe("emergency release", () => {
      it("lets user emergency claim back all FUNDING_TOKEN balance, no PROJECT_TOKEN has been claimed", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();
        await insuredVesting.methods.emergencyRelease().send({ from: daoWallet });
        await insuredVesting.methods.emergencyClaim(user1).send({ from: user1 });
        expect(await fundingToken.methods.balanceOf(user1).call()).to.be.bignumber.eq(await fundingToken.amount(FUNDING_PER_USER));
      });

      it("lets project emergency claim back all FUNDING_TOKEN balance on behalf of user, no PROJECT_TOKEN has been claimed", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();
        await insuredVesting.methods.emergencyRelease().send({ from: daoWallet });
        await insuredVesting.methods.emergencyClaim(user1).send({ from: projectWallet });
        expect(await fundingToken.methods.balanceOf(user1).call()).to.be.bignumber.eq(await fundingToken.amount(FUNDING_PER_USER));
      });

      it("cannot emergency claim if hasn't funded", async () => {
        await setAllowedAllocationForUser1();
        await insuredVesting.methods.emergencyRelease().send({ from: daoWallet });
        await expectRevert(() => insuredVesting.methods.emergencyClaim(user1).send({ from: user1 }), Error.NoFundsAdded);
      });

      it("lets user emergency claim back remaining FUNDING_TOKEN balance, some PROJECT_TOKEN claimed", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();
        await activateAndReachStartTime();
        await advanceDays(VESTING_DURATION_DAYS / 10);
        await insuredVesting.methods.claim(user1).send({ from: projectWallet });
        await insuredVesting.methods.emergencyRelease().send({ from: daoWallet });

        await insuredVesting.methods.emergencyClaim(user1).send({ from: user1 });
        expect(await fundingToken.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
          BN((await fundingToken.amount(FUNDING_PER_USER)).multipliedBy(0.9)),
          200
        );
      });

      it("cannot regularly claim once emergency released", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();
        await activateAndReachStartTime();
        await insuredVesting.methods.emergencyRelease().send({ from: daoWallet });
        await expectRevert(async () => insuredVesting.methods.claim(user1).send({ from: user1 }), Error.EmergencyReleased);
      });

      it("cannot emergency claim twice", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();
        await setAllowedAllocationForUser2();
        await addFundingFromUser2();
        await insuredVesting.methods.emergencyRelease().send({ from: daoWallet });
        await insuredVesting.methods.emergencyClaim(user1).send({ from: user1 });
        expect(await fundingToken.methods.balanceOf(user1).call()).to.be.bignumber.eq(await fundingToken.amount(FUNDING_PER_USER));
        await insuredVesting.methods.emergencyClaim(user1).send({ from: user1 });
        expect(await fundingToken.methods.balanceOf(user1).call()).to.be.bignumber.eq(await fundingToken.amount(FUNDING_PER_USER));
      });

      it("cannot emergency claim if dao hasn't released", async () => {
        await setAllowedAllocationForUser1();
        await addFundingFromUser1();
        await expectRevert(() => insuredVesting.methods.emergencyClaim(user1).send({ from: user1 }), Error.EmergencyNotReleased);
      });

      it("cannot emergency release twice", async () => {
        await insuredVesting.methods.emergencyRelease().send({ from: daoWallet });
        await expectRevert(() => insuredVesting.methods.emergencyRelease().send({ from: daoWallet }), Error.EmergencyReleased);
      });

      it("recovers all remaining PROJECT_TOKEN balance if emergency released", async () => {
        await insuredVesting.methods.setAllowedAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
        await insuredVesting.methods.setAllowedAllocation(user2, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
        await transferProjectTokenToVesting(FUNDING_PER_USER * 2 * FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO);
        await insuredVesting.methods.addFunds(await fundingToken.amount(FUNDING_PER_USER)).send({ from: user1 });
        await insuredVesting.methods.addFunds(await fundingToken.amount(FUNDING_PER_USER)).send({ from: user2 });
        await insuredVesting.methods.emergencyRelease().send({ from: daoWallet });

        await setBalancesForDelta();
        await insuredVesting.methods.recoverToken(projectToken.options.address).send({ from: daoWallet });
        // Recover all but the tokens allocated to users, backed by funding
        expect(await projectToken.methods.balanceOf(insuredVesting.options.address).call()).to.be.bignumber.eq(0);
        await expectProjectBalanceDelta("projectToken", (await projectToken.amount(FUNDING_PER_USER * 2)).multipliedBy(FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO));
        await expectProjectBalanceDelta("fundingToken", 0);
      });
    });

    describe("update project wallet address", () => {
      it("should only be updatable by project", async () => {
        expect(await insuredVesting.methods.projectWallet().call()).to.be.eq(projectWallet);
        await insuredVesting.methods.setProjectWalletAddress(differentProjectWallet).send({ from: projectWallet });
        expect(await insuredVesting.methods.projectWallet().call()).to.be.eq(differentProjectWallet);
      });

      it("should not be updatable to zero address", async () => {
        await expectRevert(() => insuredVesting.methods.setProjectWalletAddress(zeroAddress).send({ from: projectWallet }), Error.ZeroAddress);
      });

      it(`should emit '${Event.ProjectWalletAddressChanged}' event upon updating`, async () => {
        await insuredVesting.methods.setProjectWalletAddress(differentProjectWallet).send({ from: projectWallet });
        const events = await insuredVesting.getPastEvents(Event.ProjectWalletAddressChanged);
        expect(events[0].returnValues.oldAddress).to.be.eq(projectWallet);
        expect(events[0].returnValues.newAddress).to.be.eq(differentProjectWallet);
      });

      it("should short circuit if new address is same as old address", async () => {
        await expectRevert(() => insuredVesting.methods.setProjectWalletAddress(projectWallet).send({ from: projectWallet }), Error.SameAddress);
      });

      it("project role permissions should be available to new project wallet address after update", async () => {
        await insuredVesting.methods.setAllowedAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
        await insuredVesting.methods.addFunds(await fundingToken.amount(FUNDING_PER_USER)).send({ from: user1 });
        await insuredVesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
        await insuredVesting.methods.setProjectWalletAddress(differentProjectWallet).send({ from: projectWallet });
        await advanceDays(10);
        await insuredVesting.methods.claim(user1).send({ from: differentProjectWallet });
      });

      it("old wallet should not have project role permissions after update", async () => {
        const projectRole = await insuredVesting.methods.PROJECT_ROLE().call();

        await insuredVesting.methods.setAllowedAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
        await insuredVesting.methods.setProjectWalletAddress(differentProjectWallet).send({ from: projectWallet });
        await insuredVesting.methods.addFunds(await fundingToken.amount(FUNDING_PER_USER)).send({ from: user1 });

        await expectRevert(
          async () => await insuredVesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet }),
          generateAccessControlErrorMsg(projectWallet, projectRole)
        );

        await expectRevert(async () => await insuredVesting.methods.claim(user1).send({ from: projectWallet }), Error.OnlyProjectOrSender);
      });

      it('old wallet address should not be able to call "setProjectWalletAddress" after update', async () => {
        const setProjectWalletRole = await insuredVesting.methods.SET_PROJECT_WALLET_ROLE().call();

        await insuredVesting.methods.setAllowedAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });

        await insuredVesting.methods.setProjectWalletAddress(differentProjectWallet).send({ from: projectWallet });
        await insuredVesting.methods.addFunds(await fundingToken.amount(FUNDING_PER_USER)).send({ from: user1 });

        await expectRevert(
          async () => await insuredVesting.methods.setProjectWalletAddress(projectWallet).send({ from: projectWallet }),
          generateAccessControlErrorMsg(projectWallet, setProjectWalletRole)
        );
      });
    });

    // TODO add expectations for project balances
    describe("recovery", () => {
      it("recovers ether", async () => {
        const startingBalance = await web3().eth.getBalance(projectWallet);
        expect(await web3().eth.getBalance(insuredVesting.options.address)).to.bignumber.eq(0);
        await setBalance(insuredVesting.options.address, BN(12345 * 1e18));
        await insuredVesting.methods.recoverEther().send({ from: daoWallet });
        expect(await web3().eth.getBalance(insuredVesting.options.address)).to.be.bignumber.zero;
        expect(await web3().eth.getBalance(projectWallet)).to.bignumber.closeTo(BN(12345 * 1e18).plus(startingBalance), BN(0.1e18));
      });

      it("recovers other tokens", async () => {
        await someOtherToken.methods.transfer(insuredVesting.options.address, BN(12345 * 1e18)).send({ from: deployer });
        await insuredVesting.methods.recoverToken(someOtherToken.options.address).send({ from: daoWallet });
        expect(await someOtherToken.methods.balanceOf(insuredVesting.options.address).call()).to.be.bignumber.zero;
      });

      // TODO does retrieiving PROJECT_TOKEN work only based off allocations or do we have the option to cancel before vesting started.
      it("recovers excess PROJECT_TOKEN (fully funded) ", async () => {
        await insuredVesting.methods.setAllowedAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
        await insuredVesting.methods.setAllowedAllocation(user2, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
        await transferProjectTokenToVesting();
        await insuredVesting.methods.addFunds(await fundingToken.amount(FUNDING_PER_USER)).send({ from: user1 });
        await insuredVesting.methods.addFunds(await fundingToken.amount(FUNDING_PER_USER)).send({ from: user2 });
        await insuredVesting.methods.recoverToken(projectToken.options.address).send({ from: daoWallet });
        // Recover all but the tokens allocated to users, backed by funding
        expect(await projectToken.methods.balanceOf(insuredVesting.options.address).call()).to.be.bignumber.eq(
          (await projectToken.amount(FUNDING_PER_USER * 2)).multipliedBy(FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO)
        );
      });

      it("recovers excess PROJECT_TOKEN (underfunded)", async () => {
        await insuredVesting.methods.setAllowedAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
        await insuredVesting.methods.setAllowedAllocation(user2, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
        await insuredVesting.methods.addFunds(await fundingToken.amount(FUNDING_PER_USER)).send({ from: user1 });
        await insuredVesting.methods.addFunds(await fundingToken.amount(FUNDING_PER_USER)).send({ from: user2 });
        await projectToken.methods.transfer(insuredVesting.options.address, await projectToken.amount(100)).send({ from: projectWallet });
        await insuredVesting.methods.recoverToken(projectToken.options.address).send({ from: daoWallet });
        // Retains tokens in the contract, nothing to recover
        expect(await projectToken.methods.balanceOf(insuredVesting.options.address).call()).to.be.bignumber.eq(await projectToken.amount(100));
      });

      // TODO refactor balance deltas
      // todo expectbalancedelta shouldn't run token.amount(...)
      it("recovers by zeroing out allocations (pre-activation)", async () => {
        await insuredVesting.methods.setAllowedAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
        await insuredVesting.methods.setAllowedAllocation(user2, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
        await insuredVesting.methods.addFunds(await fundingToken.amount(FUNDING_PER_USER)).send({ from: user1 });
        await insuredVesting.methods.addFunds(await fundingToken.amount(FUNDING_PER_USER)).send({ from: user2 });
        await transferProjectTokenToVesting();

        let initiaProjectBalance = await projectToken.methods.balanceOf(projectWallet).call();
        await setBalancesForDelta();
        await insuredVesting.methods.recoverToken(projectToken.options.address).send({ from: daoWallet });

        expect(await projectToken.methods.balanceOf(insuredVesting.options.address).call()).to.be.bignumber.eq(
          (await projectToken.amount(FUNDING_PER_USER * 2)).multipliedBy(FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO)
        );
        expect(await projectToken.methods.balanceOf(projectWallet).call()).to.be.bignumber.eq(
          BN(initiaProjectBalance)
            .plus(await projectToken.amount(PROJECT_TOKENS_ON_SALE))
            .minus((await projectToken.amount(FUNDING_PER_USER * 2)).multipliedBy(FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO))
        );

        const user1FundingTokenBalanceBefore = await fundingToken.methods.balanceOf(user1).call();
        const user2FundingTokenBalanceBefore = await fundingToken.methods.balanceOf(user2).call();
        await insuredVesting.methods.setAllowedAllocation(user1, 0).send({ from: projectWallet });
        await insuredVesting.methods.setAllowedAllocation(user2, 0).send({ from: projectWallet });
        expect(BN(await fundingToken.methods.balanceOf(user1).call()).minus(user1FundingTokenBalanceBefore)).to.be.bignumber.eq(
          await fundingToken.amount(FUNDING_PER_USER)
        );
        expect(BN(await fundingToken.methods.balanceOf(user2).call()).minus(user2FundingTokenBalanceBefore)).to.be.bignumber.eq(
          await fundingToken.amount(FUNDING_PER_USER)
        );

        initiaProjectBalance = await projectToken.methods.balanceOf(projectWallet).call();
        await insuredVesting.methods.recoverToken(projectToken.options.address).send({ from: daoWallet });
        expect(await projectToken.methods.balanceOf(insuredVesting.options.address).call()).to.be.bignumber.eq(0);
        expect(await projectToken.methods.balanceOf(projectWallet).call()).to.be.bignumber.eq(
          BN(initiaProjectBalance).plus((await projectToken.amount(FUNDING_PER_USER * 2)).multipliedBy(FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO))
        );
      });

      [
        ["minimally overfunded", 1],
        ["overfunded", FUNDING_PER_USER * 3],
        ["exactly funded", 0],
      ].forEach(([scenario, extraFundingToPass]) => {
        it(`does not recover funded fundingToken (${scenario})`, async () => {
          await setAllowedAllocationForUser1();
          await setAllowedAllocationForUser2();
          await addFundingFromUser1();
          await addFundingFromUser2();

          await fundFundingTokenFromWhale(BN(extraFundingToPass), [insuredVesting.options.address]);

          await setBalancesForDelta();
          await insuredVesting.methods.recoverToken(fundingToken.options.address).send({ from: daoWallet });
          await expectProjectBalanceDelta("projectToken", 0);
          await expectProjectBalanceDelta("fundingToken", await fundingToken.amount(extraFundingToPass));
        });
      });
    });

    describe("access control", () => {
      describe("only project", () => {
        it("can call activate", async () => {
          const projectRole = await insuredVesting.methods.PROJECT_ROLE().call();

          const expectedInvalidUsers = [daoWallet, deployer];
          for (const invalidUser of expectedInvalidUsers) {
            await expectRevert(
              async () => insuredVesting.methods.activate(await getDefaultStartTime()).send({ from: invalidUser }),
              generateAccessControlErrorMsg(invalidUser, projectRole)
            );
          }

          await setAllowedAllocationForUser1(FUNDING_PER_USER);
          await addFundingFromUser1(FUNDING_PER_USER / 4);
          await approveProjectTokenToVesting();
          await insuredVesting.methods.activate(await getCurrentTimestamp()).send({ from: projectWallet });
        });

        it("can claim on behalf of a user", async () => {
          const expectedInvalidUsers = [daoWallet, user2];

          for (const invalidUser of expectedInvalidUsers) {
            await expectRevert(async () => insuredVesting.methods.claim(user1).send({ from: invalidUser }), Error.OnlyProjectOrSender);
          }

          await setAllowedAllocationForUser1(FUNDING_PER_USER);
          await addFundingFromUser1(FUNDING_PER_USER / 4);
          await activateAndReachStartTime();
          await insuredVesting.methods.claim(user1).send({ from: projectWallet });
        });

        it("can emergency claim on behalf of a user", async () => {
          const expectedInvalidUsers = [daoWallet, user2, deployer];

          for (const invalidUser of expectedInvalidUsers) {
            await expectRevert(async () => insuredVesting.methods.emergencyClaim(user1).send({ from: invalidUser }), Error.OnlyProjectOrSender);
          }

          await setAllowedAllocationForUser1();
          await addFundingFromUser1();
          await activateAndReachStartTime();
          await insuredVesting.methods.emergencyRelease().send({ from: daoWallet });
          await insuredVesting.methods.emergencyClaim(user1).send({ from: projectWallet });
        });

        it("can set allowed allocation", async () => {
          const projectRole = await insuredVesting.methods.PROJECT_ROLE().call();

          const expectedInvalidUsers = [daoWallet, deployer, user1];
          for (const invalidUser of expectedInvalidUsers) {
            await expectRevert(
              async () => insuredVesting.methods.setAllowedAllocation(user1, 1).send({ from: invalidUser }),
              generateAccessControlErrorMsg(invalidUser, projectRole)
            );
          }

          await insuredVesting.methods.setAllowedAllocation(user1, 1).send({ from: projectWallet });
        });

        it("can set new project wallet address", async () => {
          const setProjectWalletRole = await insuredVesting.methods.SET_PROJECT_WALLET_ROLE().call();

          const expectedInvalidUsers = [daoWallet, deployer, user1];
          for (const invalidUser of expectedInvalidUsers) {
            await expectRevert(
              async () => insuredVesting.methods.setProjectWalletAddress(differentProjectWallet).send({ from: invalidUser }),
              generateAccessControlErrorMsg(invalidUser, setProjectWalletRole)
            );
          }

          await insuredVesting.methods.setProjectWalletAddress(differentProjectWallet).send({ from: projectWallet });
        });
      });

      describe("only dao", () => {
        it("can emergency release", async () => {
          const daoRole = await insuredVesting.methods.DAO_ROLE().call();

          await setAllowedAllocationForUser1();
          await addFundingFromUser1();

          const expectedInvalidUsers = [projectWallet, deployer, user1, user2];
          for (const invalidUser of expectedInvalidUsers) {
            await expectRevert(
              async () => insuredVesting.methods.emergencyRelease().send({ from: invalidUser }),
              generateAccessControlErrorMsg(invalidUser, daoRole)
            );
          }

          await insuredVesting.methods.emergencyRelease().send({ from: daoWallet });
        });

        it("can recover ether", async () => {
          const daoRole = await insuredVesting.methods.DAO_ROLE().call();

          await setAllowedAllocationForUser1();
          await addFundingFromUser1();

          const expectedInvalidUsers = [projectWallet, deployer, user1, anyUser];
          for (const invalidUser of expectedInvalidUsers) {
            await expectRevert(
              async () => insuredVesting.methods.recoverEther().send({ from: invalidUser }),
              generateAccessControlErrorMsg(invalidUser, daoRole)
            );
          }

          await insuredVesting.methods.recoverEther().send({ from: daoWallet });
        });

        it("can recover token", async () => {
          const daoRole = await insuredVesting.methods.DAO_ROLE().call();

          await setAllowedAllocationForUser1();
          await addFundingFromUser1();

          const expectedInvalidUsers = [projectWallet, anyUser];
          for (const invalidUser of expectedInvalidUsers) {
            await expectRevert(
              async () => insuredVesting.methods.recoverToken(projectToken.options.address).send({ from: invalidUser }),
              generateAccessControlErrorMsg(invalidUser, daoRole)
            );
          }

          await insuredVesting.methods.recoverToken(projectToken.options.address).send({ from: daoWallet });
        });
      });

      it("the daoWallet address should be set to the DAO_ROLE", async () => {
        const daoRole = await insuredVesting.methods.DAO_ROLE().call();
        expect(await insuredVesting.methods.hasRole(daoRole, daoWallet).call()).to.equal(true);
      });

      it("the projectWallet address should be set to the PROJECT_ROLE", async () => {
        const projectRole = await insuredVesting.methods.PROJECT_ROLE().call();
        expect(await insuredVesting.methods.hasRole(projectRole, projectWallet).call()).to.equal(true);
      });

      it("the projectWallet address should be set to the SET_PROJECT_WALLET_ROLE", async () => {
        const setProjectWalletRole = await insuredVesting.methods.SET_PROJECT_WALLET_ROLE().call();

        expect(await insuredVesting.methods.hasRole(setProjectWalletRole, projectWallet).call()).to.equal(true);
      });
    });

    describe("view functions", () => {
      describe("funding token", () => {
        it("returns 0 vested when not activated", async () => {
          await setAllowedAllocationForUser1(FUNDING_PER_USER);
          await addFundingFromUser1(FUNDING_PER_USER);
          expect(await insuredVesting.methods.fundingTokenVestedFor(user1).call()).to.be.bignumber.eq(0);
        });

        it("returns correct vested amount - immediately after activation", async () => {
          await setAllowedAllocationForUser1(FUNDING_PER_USER);
          await addFundingFromUser1(FUNDING_PER_USER);
          await activateAndReachStartTime();
          expect(await insuredVesting.methods.fundingTokenVestedFor(user1).call()).to.be.bignumber.closeTo(0, 200);
        });

        it("returns correct vested amount - 30 days", async () => {
          await setAllowedAllocationForUser1(FUNDING_PER_USER);
          await addFundingFromUser1(FUNDING_PER_USER);
          await activateAndReachStartTime();
          await advanceDays(30);
          expect(await insuredVesting.methods.fundingTokenVestedFor(user1).call()).to.be.bignumber.eq(await vestedAmount(30, "fundingToken"));
        });

        it("returns correct vested amount - claim", async () => {
          await setAllowedAllocationForUser1(FUNDING_PER_USER);
          await addFundingFromUser1(FUNDING_PER_USER);
          await activateAndReachStartTime();
          await advanceDays(30);
          await insuredVesting.methods.claim(user1).send({ from: projectWallet });
          expect(await insuredVesting.methods.fundingTokenClaimableFor(user1).call()).to.be.bignumber.zero;
          await advanceDays(30);
          expect(await insuredVesting.methods.fundingTokenClaimableFor(user1).call()).to.be.bignumber.eq(await vestedAmount(30, "fundingToken"));
          expect(await insuredVesting.methods.fundingTokenVestedFor(user1).call()).to.be.bignumber.closeTo(
            await vestedAmount(60, "fundingToken"),
            await fundingToken.amount(0.1)
          );
        });
      });

      describe("project token", () => {
        it("returns 0 vested when not activated", async () => {
          await setAllowedAllocationForUser1(FUNDING_PER_USER);
          await addFundingFromUser1(FUNDING_PER_USER);
          expect(await insuredVesting.methods.projectTokenClaimableFor(user1).call()).to.be.bignumber.eq(0);
        });

        it("returns correct vested amount - immediately after activation", async () => {
          await setAllowedAllocationForUser1(FUNDING_PER_USER);
          await addFundingFromUser1(FUNDING_PER_USER);
          await activateAndReachStartTime();
          expect(await insuredVesting.methods.projectTokenClaimableFor(user1).call()).to.be.bignumber.closeTo(0, 200);
        });

        it("returns correct vested amount - 30 days", async () => {
          await setAllowedAllocationForUser1(FUNDING_PER_USER);
          await addFundingFromUser1(FUNDING_PER_USER);
          await activateAndReachStartTime();
          await advanceDays(30);
          expect(await insuredVesting.methods.projectTokenClaimableFor(user1).call()).to.be.bignumber.closeTo(
            await vestedAmount(30, "projectToken"),
            await projectToken.amount(0.1)
          );
        });

        it("returns correct vested amount - claim", async () => {
          await setAllowedAllocationForUser1(FUNDING_PER_USER);
          await addFundingFromUser1(FUNDING_PER_USER);
          await activateAndReachStartTime();
          await advanceDays(30);
          await insuredVesting.methods.claim(user1).send({ from: projectWallet });
          expect(await insuredVesting.methods.projectTokenClaimableFor(user1).call()).to.be.bignumber.zero;
          await advanceDays(30);
          expect(await insuredVesting.methods.projectTokenClaimableFor(user1).call()).to.be.bignumber.closeTo(
            await vestedAmount(30, "projectToken"),
            await projectToken.amount(0.1)
          );
          expect(await insuredVesting.methods.projectTokenVestedFor(user1).call()).to.be.bignumber.closeTo(
            await vestedAmount(60, "projectToken"),
            await projectToken.amount(0.1)
          );
        });
      });
    });
  });

  describe("activate", () => {
    it("fails if start time is in the past", async () => {
      const timeInPast = BN(await getCurrentTimestamp()).minus(1);
      await expectRevert(async () => insuredVesting.methods.activate(timeInPast).send({ from: projectWallet }), Error.StartTimeIsInPast);
    });

    it("fails if start time is too far in to the future", async () => {
      const timeInDistantFuture = BN(await getCurrentTimestamp())
        .plus(MONTH * 3)
        .plus(DAY);
      await expectRevert(async () => insuredVesting.methods.activate(timeInDistantFuture).send({ from: projectWallet }), Error.StartTimeTooLate);
    });

    it("fails if there isn't enough PROJECT_TOKEN allowance to cover funded FUNDING_TOKEN", async () => {
      await setAllowedAllocationForUser1(FUNDING_PER_USER);
      await addFundingFromUser1(FUNDING_PER_USER);
      await expectRevert(
        async () => insuredVesting.methods.activate(await getCurrentTimestamp()).send({ from: projectWallet }),
        "ERC20: insufficient allowance"
      );
    });

    it("fails if there isn't enough PROJECT_TOKEN balance to cover funded FUNDING_TOKEN", async () => {
      await setAllowedAllocationForUser1(FUNDING_PER_USER);
      await addFundingFromUser1(FUNDING_PER_USER);
      await approveProjectTokenToVesting();
      // Get rid of all balance
      await projectToken.methods.transfer(anyUser, await projectToken.amount(1e9)).send({ from: projectWallet });
      await expectRevert(
        async () => insuredVesting.methods.activate(await getCurrentTimestamp()).send({ from: projectWallet }),
        "ERC20: transfer amount exceeds balance"
      );
    });

    it("transfers PROJECT_TOKEN required to back FUNDING_TOKEN funding", async () => {
      await setAllowedAllocationForUser1(FUNDING_PER_USER);
      await addFundingFromUser1(FUNDING_PER_USER / 4);

      const requiredProjectToken = await projectToken.amount((FUNDING_PER_USER / 4) * FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO);

      await approveProjectTokenToVesting();

      await insuredVesting.methods.activate(await getCurrentTimestamp()).send({ from: projectWallet });

      const contractProjectTokenBalance = await projectToken.methods.balanceOf(insuredVesting.options.address).call();

      expect(contractProjectTokenBalance).to.be.bignumber.eq(requiredProjectToken);
    });

    it("does not transfer PROJECT_TOKEN if already funded sufficiently", async () => {
      await setAllowedAllocationForUser1(FUNDING_PER_USER);
      await addFundingFromUser1(FUNDING_PER_USER);

      await approveProjectTokenToVesting();

      await projectToken.methods.transfer(insuredVesting.options.address, await projectToken.amount(FUNDING_PER_USER * 10)).send({ from: projectWallet });

      const initialContractProjectTokenBalance = await projectToken.methods.balanceOf(insuredVesting.options.address).call();
      await insuredVesting.methods.activate(await getCurrentTimestamp()).send({ from: projectWallet });
      const contractProjectTokenBalance = await projectToken.methods.balanceOf(insuredVesting.options.address).call();

      expect(initialContractProjectTokenBalance).to.be.bignumber.eq(contractProjectTokenBalance);
    });

    it("transfers PROJECT_TOKEN required to back FUNDING_TOKEN funding (partially pre-funded)", async () => {
      await setAllowedAllocationForUser1(FUNDING_PER_USER);
      await addFundingFromUser1(FUNDING_PER_USER);

      const requiredProjectToken = await projectToken.amount(FUNDING_PER_USER * FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO);

      await approveProjectTokenToVesting();

      await projectToken.methods.transfer(insuredVesting.options.address, await projectToken.amount(FUNDING_PER_USER / 3)).send({ from: projectWallet });

      await insuredVesting.methods.activate(await getCurrentTimestamp()).send({ from: projectWallet });

      const contractProjectTokenBalance = await projectToken.methods.balanceOf(insuredVesting.options.address).call();

      expect(contractProjectTokenBalance).to.be.bignumber.eq(requiredProjectToken);
    });

    it("fails if already activated", async () => {
      await setAllowedAllocationForUser1(FUNDING_PER_USER);
      await addFundingFromUser1(FUNDING_PER_USER);
      await approveProjectTokenToVesting();

      await insuredVesting.methods.activate(await getCurrentTimestamp()).send({ from: projectWallet });

      await expectRevert(async () => insuredVesting.methods.activate(await getCurrentTimestamp()).send({ from: projectWallet }), Error.AlreadyActivated);
    });

    it("fails if not funded", async () => {
      await expectRevert(async () => insuredVesting.methods.activate(await getCurrentTimestamp()).send({ from: projectWallet }), Error.NoFundsAdded);
    });

    it("activates", async () => {
      await setAllowedAllocationForUser1(FUNDING_PER_USER);
      await addFundingFromUser1(FUNDING_PER_USER);
      await approveProjectTokenToVesting();

      await insuredVesting.methods.activate(await getCurrentTimestamp()).send({ from: projectWallet });

      expect(await insuredVesting.methods.vestingStartTime().call()).to.be.bignumber.closeTo(await getCurrentTimestamp(), 1);
    });

    it("tranfers the correct amount of PROJECT_TOKEN after setting allowed allocations with refunds", async () => {
      await setAllowedAllocationForUser1(FUNDING_PER_USER);
      await addFundingFromUser1(FUNDING_PER_USER);
      await setAllowedAllocationForUser2(FUNDING_PER_USER);
      await addFundingFromUser2(FUNDING_PER_USER);
      // Reduce allowed allocation
      await setAllowedAllocationForUser2(FUNDING_PER_USER / 2);

      await approveProjectTokenToVesting((FUNDING_PER_USER + FUNDING_PER_USER / 2) * FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO);
      await insuredVesting.methods.activate(await getCurrentTimestamp()).send({ from: projectWallet });
    });
  });
});
