import { expect } from "chai";
import BN from "bignumber.js";
import { SnapshotRestorer, takeSnapshot } from "@nomicfoundation/hardhat-network-helpers";
import { deployArtifact, expectRevert, setBalance } from "@defi.org/web3-candies/dist/hardhat";
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
  setAllocationForUser1,
  setAllocationForUser2,
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
  differentProjectWallet,
  fundingTokenToProjectToken,
} from "./fixture";
import { web3, zeroAddress } from "@defi.org/web3-candies";
import { advanceDays, DAY, getCurrentTimestamp, advanceMonths, MONTH } from "../utils";
import { CALLER_NOT_OWNER_REVERT_MSG, OWNER_REVERT_MSG, PROJECT_ROLE_REVERT_MSG } from "../constants";
import { InsuredVestingV1 } from "../../typechain-hardhat/contracts/insured-vesting-v1/InsuredVestingV1";
import { config } from "../../deployment/insured-vesting-v1/config";

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
          await setAllocationForUser1();
          await addFundingFromUser1();
          await activateAndReachStartTime();
          await advanceDays(days);
          await insuredVesting.methods.claim(user1).send({ from: user1 });

          await expectUserBalanceDelta("projectToken", await vestedAmount(days, "projectToken"));
          await expectUserBalanceDelta("fundingToken", 0);
        });
      }

      it("does not vest before start time", async () => {
        await setAllocationForUser1();
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
        await setAllocationForUser1();
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
        await setAllocationForUser1(FUNDING_PER_USER);
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
          await insuredVesting.methods.setAllocation(user, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
          const amountToFund = 10 + Math.round(Math.random() * (amountToAllocate - 10));
          await insuredVesting.methods.addFunds(await fundingToken.amount(amountToFund)).send({ from: user });
          additionalUsersFunding.push(amountToFund);
        }

        await setAllocationForUser1();
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

      it("can fund a partial allocation and claim tokens", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1(FUNDING_PER_USER / 3);
        await setBalancesForDelta();
        await activateAndReachStartTime();
        await advanceDays(20);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("projectToken", (await vestedAmount(20, "projectToken")).dividedBy(3));
        await expectUserBalanceDelta("fundingToken", 0);
      });

      it("can fund a partial allocation multiple times and claim tokens for vesting period 1", async () => {
        await setAllocationForUser1();
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
        await setAllocationForUser1();
        await addFundingFromUser1();
        await activateAndReachStartTime();
        await advanceDays(45);

        await insuredVesting.methods.claim(user1).send({ from: user1 });

        await setBalancesForDelta();
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("projectToken", 0);
      });

      it("cannot claim tokens before starting period, zero time, not activated", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await expectRevert(() => insuredVesting.methods.claim(user1).send({ from: user1 }), Error.VestingNotStarted);
      });

      it("cannot claim tokens before starting period, some time has passed, not activated", async () => {
        await advanceMonths(LOCKUP_MONTHS / 2);
        await setAllocationForUser1();
        await addFundingFromUser1();
        await expectRevert(() => insuredVesting.methods.claim(user1).send({ from: user1 }), Error.VestingNotStarted);
      });

      it("cannot claim tokens before starting period - activated", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await insuredVesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
        await expectRevert(() => insuredVesting.methods.claim(user1).send({ from: user1 }), Error.VestingNotStarted);
        await advanceDays(1);
        await expectRevert(() => insuredVesting.methods.claim(user1).send({ from: user1 }), Error.VestingNotStarted);
      });

      it("cannot claim if not funded", async () => {
        await advanceMonths(LOCKUP_MONTHS);
        await setAllocationForUser1();
        await addFundingFromUser1();
        await activateAndReachStartTime();
        await expectRevert(async () => insuredVesting.methods.claim(user2).send({ from: user2 }), Error.NoFundsAdded);
      });

      it("can claim tokens for the entire vesting period", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await setBalancesForDelta();
        await activateAndReachStartTime();
        await advanceDays(VESTING_DURATION_DAYS);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("projectToken", await projectToken.amount(FUNDING_PER_USER * FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO));
        await expectUserBalanceDelta("fundingToken", 0);
      });

      it("can claim tokens for entire vesting period, many months passed", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await setBalancesForDelta();
        await activateAndReachStartTime();
        await advanceDays(VESTING_DURATION_DAYS * 3);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("projectToken", await projectToken.amount(FUNDING_PER_USER * FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO));
        await expectUserBalanceDelta("fundingToken", 0);
      });

      it("project receives funding when claim is made", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await activateAndReachStartTime();
        await setBalancesForDelta();
        await advanceDays(77);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectProjectBalanceDelta("fundingToken", await vestedAmount(77, "fundingToken"));
        await expectProjectBalanceDelta("projectToken", 0);
      });

      it("project can claim on behalf of user", async () => {
        await setAllocationForUser1();
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
        await setAllocationForUser1();
        await addFundingFromUser1();
        await activateAndReachStartTime();
        await advanceDays(77);
        await expectRevert(() => insuredVesting.methods.claim(user1).send({ from: anyUser }), Error.OnlyProjectOrSender);
      });

      it("claim according to updated funding if allocation was updated", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await setAllocationForUser1(FUNDING_PER_USER / 4);
        await activateAndReachStartTime();
        await advanceDays(77);
        await setBalancesForDelta();
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("projectToken", (await vestedAmount(77, "projectToken")).dividedBy(4));
      });
    });

    describe("set decision for refund", () => {
      it("can set decision and claim fundingToken back (after vesting)", async () => {
        await setAllocationForUser1();
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
        await setAllocationForUser1();
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
        await setAllocationForUser1();
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
        await setAllocationForUser1();

        await expectRevert(() => insuredVesting.methods.setDecision(true).send({ from: user1 }), Error.NoFundsAdded);
      });

      it("setting same decision multiple times is idempotent", async () => {
        await setAllocationForUser1();
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
        await setAllocationForUser1();
        await addFundingFromUser1();
        await expectUserBalanceDelta("fundingToken", (await fundingToken.amount(FUNDING_PER_USER)).negated());
      });

      it("can add 1 wei amounts of FUNDING_TOKEN, fully vested", async () => {
        await setBalancesForDelta();
        await setAllocationForUser1();
        await insuredVesting.methods.addFunds(1).send({ from: user1 });
        await expectUserBalanceDelta("fundingToken", -1);
        await activateAndReachStartTime();
        await advanceDays(VESTING_DURATION_DAYS);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("projectToken", 1e12 * FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO, 0);
      });

      it("can add 1 wei amounts of FUNDING_TOKEN, partially vested", async () => {
        await setBalancesForDelta();
        await setAllocationForUser1();
        await insuredVesting.methods.addFunds(1).send({ from: user1 });
        await expectUserBalanceDelta("fundingToken", -1);
        await activateAndReachStartTime();
        await advanceDays(30);

        // This is a corner case where the amount funded is so little, it's indivisible relative to the time passed
        await expectRevert(async () => insuredVesting.methods.claim(user1).send({ from: user1 }), Error.NothingToClaim);
      });

      it("can add ~wei amounts of FUNDING_TOKEN, partially vested", async () => {
        await setBalancesForDelta();
        await setAllocationForUser1();
        await insuredVesting.methods.addFunds(100).send({ from: user1 });
        await expectUserBalanceDelta("fundingToken", -1);
        await activateAndReachStartTime();
        await advanceDays(30);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("projectToken", 4 * 1e12 * FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO, 0);
      });

      it("user cannot fund if does not have allocation", async () => {
        const amount = await fundingToken.amount(FUNDING_PER_USER);
        await expectRevert(async () => insuredVesting.methods.addFunds(amount).send({ from: user1 }), `${Error.AllocationExceeded}(${amount})`);
      });

      it("user cannot add more funds than allocation, two attempts", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        const amount = await fundingToken.amount(1);
        await expectRevert(async () => insuredVesting.methods.addFunds(amount).send({ from: user1 }), `${Error.AllocationExceeded}(${amount})`);
      });

      it("user cannot add more funds than allocation, single attempts", async () => {
        await setAllocationForUser1();
        const amount = await fundingToken.amount(FUNDING_PER_USER + 1);
        await expectRevert(async () => insuredVesting.methods.addFunds(amount).send({ from: user1 }), `${Error.AllocationExceeded}(${amount})`);
      });

      it("cannot add funds after activation", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1(FUNDING_PER_USER / 2);
        await insuredVesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
        await expectRevert(async () => insuredVesting.methods.addFunds(1).send({ from: user1 }), Error.AlreadyActivated);
      });

      it("cannot add funds if emergency released", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1(FUNDING_PER_USER / 2);
        await insuredVesting.methods.emergencyRelease().send({ from: deployer });
        await expectRevert(async () => insuredVesting.methods.addFunds(1).send({ from: user1 }), Error.EmergencyReleaseActive);
      });

      it("fails if user does not have enough balance", async () => {
        const amount = FUNDING_PER_USER + 1;
        await insuredVesting.methods.setAllocation(user1, await fundingToken.amount(amount)).send({ from: projectWallet });
        await expectRevert(
          async () => insuredVesting.methods.addFunds(await fundingToken.amount(amount)).send({ from: user1 }),
          "ERC20: transfer amount exceeds allowance"
        );
      });
    });

    describe("admin", () => {
      describe("set allocation", () => {
        it("cannot set allocation after activation", async () => {
          await setAllocationForUser1(FUNDING_PER_USER / 4);
          await addFundingFromUser1(FUNDING_PER_USER / 4);
          await insuredVesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
          await expectRevert(
            async () => insuredVesting.methods.setAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet }),
            Error.AlreadyActivated
          );
        });

        describe("existing excess deposit is refunded in case of allocation decrease", () => {
          it("single user", async () => {
            await setBalancesForDelta();
            await setAllocationForUser1();
            await addFundingFromUser1();
            await expectUserBalanceDelta("fundingToken", (await fundingToken.amount(FUNDING_PER_USER)).negated(), 1);

            await setBalancesForDelta();
            const newAmount = FUNDING_PER_USER / 3;
            const newAllocation = await fundingToken.amount(newAmount);
            await insuredVesting.methods.setAllocation(user1, newAllocation).send({ from: projectWallet });

            // // check user FUNDING_TOKEN balance reflects refunded amount
            await expectUserBalanceDelta("fundingToken", await fundingToken.amount(FUNDING_PER_USER - newAmount), 1);
            // // check contract FUNDING_TOKEN balance has been updated
            expect(await fundingToken.methods.balanceOf(insuredVesting.options.address).call()).to.be.bignumber.eq(newAllocation);
            // // check user allocation has been updated
            expect((await insuredVesting.methods.userVestings(user1).call()).fundingTokenAllocation).to.be.bignumber.eq(newAllocation);
          });

          // TODO: multiple user scenarios
        });

        describe("setAllocation", () => {
          const testCases: { description: string; setAllocationsFn: () => Promise<any>; expectedAllocation: BN }[] = [
            {
              description: "single user",
              setAllocationsFn: async () =>
                await insuredVesting.methods.setAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet }),
              expectedAllocation: BN(FUNDING_PER_USER),
            },
            {
              description: "multiple users, smaller allocation added",
              setAllocationsFn: async () => {
                await insuredVesting.methods.setAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
                await insuredVesting.methods.setAllocation(user2, await fundingToken.amount(FUNDING_PER_USER / 5)).send({ from: projectWallet });
                await insuredVesting.methods.setAllocation(user1, await fundingToken.amount(FUNDING_PER_USER / 2)).send({ from: projectWallet });
              },
              expectedAllocation: BN(FUNDING_PER_USER / 2),
            },
            {
              description: "multiple users, larger allocation added",
              setAllocationsFn: async () => {
                await insuredVesting.methods.setAllocation(user2, await fundingToken.amount(FUNDING_PER_USER / 2)).send({ from: projectWallet });
                await insuredVesting.methods.setAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
                await insuredVesting.methods.setAllocation(user2, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
              },
              expectedAllocation: BN(FUNDING_PER_USER),
            },
            {
              description: "multiple users, allocation removed",
              setAllocationsFn: async () => {
                await insuredVesting.methods.setAllocation(user2, await fundingToken.amount(FUNDING_PER_USER / 2)).send({ from: projectWallet });
                await insuredVesting.methods.setAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
                await insuredVesting.methods.setAllocation(user2, await fundingToken.amount(0)).send({ from: projectWallet });
              },
              expectedAllocation: BN(FUNDING_PER_USER),
            },
            {
              description: "allocation increased after funding",
              setAllocationsFn: async () => {
                await insuredVesting.methods.setAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
                await insuredVesting.methods.setAllocation(user2, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
                await insuredVesting.methods.addFunds(await fundingToken.amount(FUNDING_PER_USER)).send({ from: user1 });
                await insuredVesting.methods.setAllocation(user1, await fundingToken.amount(FUNDING_PER_USER * 2)).send({ from: projectWallet });
              },
              expectedAllocation: BN(FUNDING_PER_USER * 2),
            },
          ];

          testCases.forEach(({ description, setAllocationsFn: setAllocationsFn, expectedAllocation }) => {
            it(description, async () => {
              await setAllocationsFn();
              const actualFundingTokenAllocation = (await insuredVesting.methods.userVestings(user1).call()).fundingTokenAllocation;
              expect(actualFundingTokenAllocation).to.be.bignumber.eq(await fundingToken.amount(expectedAllocation));
            });
          });
        });
      });

      it("cannot set allocation if emergency released", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await insuredVesting.methods.emergencyRelease().send({ from: deployer });
        await expectRevert(() => insuredVesting.methods.setAllocation(user1, 1).send({ from: projectWallet }), Error.EmergencyReleaseActive);
      });
    });

    describe("emergency release", () => {
      it("lets user emergency claim back all FUNDING_TOKEN balance, no PROJECT_TOKEN has been claimed", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await insuredVesting.methods.emergencyRelease().send({ from: deployer });
        await insuredVesting.methods.emergencyClaim(user1).send({ from: user1 });
        expect(await fundingToken.methods.balanceOf(user1).call()).to.be.bignumber.eq(await fundingToken.amount(FUNDING_PER_USER));
      });

      it("lets project emergency claim back all FUNDING_TOKEN balance on behalf of user, no PROJECT_TOKEN has been claimed", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await insuredVesting.methods.emergencyRelease().send({ from: deployer });
        await insuredVesting.methods.emergencyClaim(user1).send({ from: projectWallet });
        expect(await fundingToken.methods.balanceOf(user1).call()).to.be.bignumber.eq(await fundingToken.amount(FUNDING_PER_USER));
      });

      it("cannot emergency claim if hasn't funded", async () => {
        await setAllocationForUser1();
        await insuredVesting.methods.emergencyRelease().send({ from: deployer });
        await expectRevert(() => insuredVesting.methods.emergencyClaim(user1).send({ from: user1 }), Error.NoFundsAdded);
      });

      it("lets user emergency claim back remaining FUNDING_TOKEN balance, some PROJECT_TOKEN claimed", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await activateAndReachStartTime();
        await advanceDays(VESTING_DURATION_DAYS / 10);
        await insuredVesting.methods.claim(user1).send({ from: projectWallet });
        await insuredVesting.methods.emergencyRelease().send({ from: deployer });

        await insuredVesting.methods.emergencyClaim(user1).send({ from: user1 });
        expect(await fundingToken.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
          BN((await fundingToken.amount(FUNDING_PER_USER)).multipliedBy(0.9)),
          200
        );
      });

      it("can regularly claim even if emergency released", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await activateAndReachStartTime();
        await insuredVesting.methods.emergencyRelease().send({ from: deployer });
        await advanceDays(VESTING_DURATION_DAYS / 4);
        await setBalancesForDelta();
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("projectToken", await vestedAmount(VESTING_DURATION_DAYS / 4, "projectToken"));
      });

      it("cannot emergency claim twice", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await setAllocationForUser2();
        await addFundingFromUser2();
        await insuredVesting.methods.emergencyRelease().send({ from: deployer });
        await insuredVesting.methods.emergencyClaim(user1).send({ from: user1 });
        expect(await fundingToken.methods.balanceOf(user1).call()).to.be.bignumber.eq(await fundingToken.amount(FUNDING_PER_USER));
        await insuredVesting.methods.emergencyClaim(user1).send({ from: user1 });
        expect(await fundingToken.methods.balanceOf(user1).call()).to.be.bignumber.eq(await fundingToken.amount(FUNDING_PER_USER));
      });

      it("cannot emergency claim if owner hasn't released", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await expectRevert(() => insuredVesting.methods.emergencyClaim(user1).send({ from: user1 }), Error.NotEmergencyReleased);
      });

      it("cannot emergency release twice", async () => {
        await insuredVesting.methods.emergencyRelease().send({ from: deployer });
        await expectRevert(() => insuredVesting.methods.emergencyRelease().send({ from: deployer }), Error.EmergencyReleaseActive);
      });

      it("recovers all remaining PROJECT_TOKEN balance if emergency released", async () => {
        await insuredVesting.methods.setAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
        await insuredVesting.methods.setAllocation(user2, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
        await transferProjectTokenToVesting(FUNDING_PER_USER * 2 * FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO);
        await insuredVesting.methods.addFunds(await fundingToken.amount(FUNDING_PER_USER)).send({ from: user1 });
        await insuredVesting.methods.addFunds(await fundingToken.amount(FUNDING_PER_USER)).send({ from: user2 });
        await insuredVesting.methods.emergencyRelease().send({ from: deployer });

        await setBalancesForDelta();
        await insuredVesting.methods.recoverToken(projectToken.options.address).send({ from: deployer });
        // Recover all but the tokens allocated to users, backed by funding
        expect(await projectToken.methods.balanceOf(insuredVesting.options.address).call()).to.be.bignumber.eq(0);
        await expectProjectBalanceDelta("projectToken", (await projectToken.amount(FUNDING_PER_USER * 2)).multipliedBy(FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO));
        await expectProjectBalanceDelta("fundingToken", 0);
      });
    });

    describe("transfer project role", () => {
      it("should only be transferable by project wallet", async () => {
        expect(await insuredVesting.methods.projectWallet().call()).to.be.eq(projectWallet);
        await insuredVesting.methods.transferProjectRole(differentProjectWallet).send({ from: projectWallet });
        expect(await insuredVesting.methods.projectWallet().call()).to.be.eq(differentProjectWallet);
      });

      it("should not be updatable to zero address", async () => {
        await expectRevert(
          () => insuredVesting.methods.transferProjectRole(zeroAddress).send({ from: projectWallet }),
          "ProjectRole: new project wallet is the zero address"
        );
      });

      it(`should emit '${Event.ProjectRoleTransferred}' event upon updating`, async () => {
        await insuredVesting.methods.transferProjectRole(differentProjectWallet).send({ from: projectWallet });
        const events = await insuredVesting.getPastEvents(Event.ProjectRoleTransferred);
        expect(events[0].returnValues.previousProjectWallet).to.be.eq(projectWallet);
        expect(events[0].returnValues.newProjectWallet).to.be.eq(differentProjectWallet);
      });

      it("project role permissions should be available to new project wallet address after role transfer", async () => {
        await insuredVesting.methods.setAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
        await insuredVesting.methods.addFunds(await fundingToken.amount(FUNDING_PER_USER)).send({ from: user1 });
        await insuredVesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
        await insuredVesting.methods.transferProjectRole(differentProjectWallet).send({ from: projectWallet });
        await advanceDays(10);
        await insuredVesting.methods.claim(user1).send({ from: differentProjectWallet });
      });

      it("old wallet should not have project role permissions after ownership transfer", async () => {
        await insuredVesting.methods.setAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
        await insuredVesting.methods.transferProjectRole(differentProjectWallet).send({ from: projectWallet });
        await insuredVesting.methods.addFunds(await fundingToken.amount(FUNDING_PER_USER)).send({ from: user1 });

        await expectRevert(
          async () => await insuredVesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet }),
          PROJECT_ROLE_REVERT_MSG
        );

        await expectRevert(async () => await insuredVesting.methods.claim(user1).send({ from: projectWallet }), Error.OnlyProjectOrSender);
      });

      it("old wallet address should not be able to call transfer role again after initial transfer", async () => {
        await insuredVesting.methods.setAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });

        await insuredVesting.methods.transferProjectRole(differentProjectWallet).send({ from: projectWallet });
        await insuredVesting.methods.addFunds(await fundingToken.amount(FUNDING_PER_USER)).send({ from: user1 });

        await expectRevert(async () => await insuredVesting.methods.transferProjectRole(projectWallet).send({ from: projectWallet }), PROJECT_ROLE_REVERT_MSG);
      });
    });

    // TODO add expectations for project balances
    describe("recovery", () => {
      it("recovers ether", async () => {
        const startingBalance = await web3().eth.getBalance(projectWallet);
        expect(await web3().eth.getBalance(insuredVesting.options.address)).to.bignumber.eq(0);
        await setBalance(insuredVesting.options.address, BN(12345 * 1e18));
        await insuredVesting.methods.recoverEther().send({ from: deployer });
        expect(await web3().eth.getBalance(insuredVesting.options.address)).to.be.bignumber.zero;
        expect(await web3().eth.getBalance(projectWallet)).to.bignumber.closeTo(BN(12345 * 1e18).plus(startingBalance), BN(0.1e18));
      });

      it("recovers other tokens", async () => {
        await someOtherToken.methods.transfer(insuredVesting.options.address, BN(12345 * 1e18)).send({ from: deployer });
        await insuredVesting.methods.recoverToken(someOtherToken.options.address).send({ from: deployer });
        expect(await someOtherToken.methods.balanceOf(insuredVesting.options.address).call()).to.be.bignumber.zero;
      });

      it("recovers excess PROJECT_TOKEN (overfunded) ", async () => {
        await insuredVesting.methods.setAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
        await insuredVesting.methods.setAllocation(user2, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
        await transferProjectTokenToVesting();
        await insuredVesting.methods.addFunds(await fundingToken.amount(FUNDING_PER_USER)).send({ from: user1 });
        await insuredVesting.methods.addFunds(await fundingToken.amount(FUNDING_PER_USER)).send({ from: user2 });
        await insuredVesting.methods.recoverToken(projectToken.options.address).send({ from: deployer });
        // Recover all but the tokens allocated to users, backed by funding
        expect(await projectToken.methods.balanceOf(insuredVesting.options.address).call()).to.be.bignumber.eq(
          (await projectToken.amount(FUNDING_PER_USER * 2)).multipliedBy(FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO)
        );
      });

      it("recovers excess PROJECT_TOKEN (underfunded)", async () => {
        await insuredVesting.methods.setAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
        await insuredVesting.methods.setAllocation(user2, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
        await insuredVesting.methods.addFunds(await fundingToken.amount(FUNDING_PER_USER)).send({ from: user1 });
        await insuredVesting.methods.addFunds(await fundingToken.amount(FUNDING_PER_USER)).send({ from: user2 });
        await projectToken.methods.transfer(insuredVesting.options.address, await projectToken.amount(100)).send({ from: projectWallet });
        await expectRevert(() => insuredVesting.methods.recoverToken(projectToken.options.address).send({ from: deployer }), Error.NothingToClaim);
      });

      // TODO refactor balance deltas
      // todo expectbalancedelta shouldn't run token.amount(...)
      it("recovers by zeroing out allocations (pre-activation)", async () => {
        await insuredVesting.methods.setAllocation(user1, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
        await insuredVesting.methods.setAllocation(user2, await fundingToken.amount(FUNDING_PER_USER)).send({ from: projectWallet });
        await insuredVesting.methods.addFunds(await fundingToken.amount(FUNDING_PER_USER)).send({ from: user1 });
        await insuredVesting.methods.addFunds(await fundingToken.amount(FUNDING_PER_USER)).send({ from: user2 });
        await transferProjectTokenToVesting();

        let initiaProjectBalance = await projectToken.methods.balanceOf(projectWallet).call();
        await setBalancesForDelta();
        await insuredVesting.methods.recoverToken(projectToken.options.address).send({ from: deployer });

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
        await insuredVesting.methods.setAllocation(user1, 0).send({ from: projectWallet });
        await insuredVesting.methods.setAllocation(user2, 0).send({ from: projectWallet });
        expect(BN(await fundingToken.methods.balanceOf(user1).call()).minus(user1FundingTokenBalanceBefore)).to.be.bignumber.eq(
          await fundingToken.amount(FUNDING_PER_USER)
        );
        expect(BN(await fundingToken.methods.balanceOf(user2).call()).minus(user2FundingTokenBalanceBefore)).to.be.bignumber.eq(
          await fundingToken.amount(FUNDING_PER_USER)
        );

        initiaProjectBalance = await projectToken.methods.balanceOf(projectWallet).call();
        await insuredVesting.methods.recoverToken(projectToken.options.address).send({ from: deployer });
        expect(await projectToken.methods.balanceOf(insuredVesting.options.address).call()).to.be.bignumber.eq(0);
        expect(await projectToken.methods.balanceOf(projectWallet).call()).to.be.bignumber.eq(
          BN(initiaProjectBalance).plus((await projectToken.amount(FUNDING_PER_USER * 2)).multipliedBy(FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO))
        );
      });

      it(`does not recover funded fundingToken (overFunded)`, async () => {
        await setAllocationForUser1();
        await setAllocationForUser2();
        await addFundingFromUser1();
        await addFundingFromUser2();

        await fundFundingTokenFromWhale(BN(FUNDING_PER_USER * 3), [insuredVesting.options.address]);

        await setBalancesForDelta();
        await insuredVesting.methods.recoverToken(fundingToken.options.address).send({ from: deployer });
        await expectProjectBalanceDelta("projectToken", 0);
        await expectProjectBalanceDelta("fundingToken", await fundingToken.amount(FUNDING_PER_USER * 3));
      });

      it(`does not recover funded fundingToken (exactly funded)`, async () => {
        await setAllocationForUser1();
        await setAllocationForUser2();
        await addFundingFromUser1();
        await addFundingFromUser2();

        await setBalancesForDelta();
        await expectRevert(() => insuredVesting.methods.recoverToken(fundingToken.options.address).send({ from: deployer }), Error.NothingToClaim);
      });

      it("recovers with claim", async () => {
        // Users fund
        await setAllocationForUser1(FUNDING_PER_USER / 4);
        await addFundingFromUser1(FUNDING_PER_USER / 4);
        await setAllocationForUser2(FUNDING_PER_USER / 4);
        await addFundingFromUser2(FUNDING_PER_USER / 4);
        await approveProjectTokenToVesting();
        await activateAndReachStartTime();

        // quarter of vesting period passed and user1 claims, there are 0 tokens to recover
        await advanceDays(VESTING_DURATION_DAYS / 4);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await setBalancesForDelta();
        await expectRevert(() => insuredVesting.methods.recoverToken(fundingToken.options.address).send({ from: deployer }), Error.NothingToClaim);
        await expectRevert(() => insuredVesting.methods.recoverToken(projectToken.options.address).send({ from: deployer }), Error.NothingToClaim);
        await expectProjectBalanceDelta("fundingToken", 0);

        // excess tokens are transferred, we ensure that all are recovered
        await fundFundingTokenFromWhale(BN(12_345), [insuredVesting.options.address]);
        await setBalancesForDelta();
        await insuredVesting.methods.recoverToken(fundingToken.options.address).send({ from: deployer });
        await expectProjectBalanceDelta("fundingToken", await fundingToken.amount(12_345));

        // excess project tokens are transferred, we ensure that all are recovered
        await transferProjectTokenToVesting(12_345);
        await setBalancesForDelta();
        await insuredVesting.methods.recoverToken(projectToken.options.address).send({ from: deployer });
        await expectProjectBalanceDelta("projectToken", await projectToken.amount(12_345));

        // Remaining period passes, both users claim, nothing to recover
        await advanceDays((VESTING_DURATION_DAYS * 3) / 4);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await insuredVesting.methods.claim(user2).send({ from: user2 });
        await setBalancesForDelta();
        await expectRevert(() => insuredVesting.methods.recoverToken(fundingToken.options.address).send({ from: deployer }), Error.NothingToClaim);
        await expectRevert(() => insuredVesting.methods.recoverToken(projectToken.options.address).send({ from: deployer }), Error.NothingToClaim);
        await expectProjectBalanceDelta("fundingToken", 0);

        // excess tokens are transferred, we ensure that all are recovered
        await fundFundingTokenFromWhale(BN(12_345), [insuredVesting.options.address]);
        await setBalancesForDelta();
        await insuredVesting.methods.recoverToken(fundingToken.options.address).send({ from: deployer });
        await expectProjectBalanceDelta("fundingToken", await fundingToken.amount(12_345));

        // excess project tokens are transferred, we ensure that all are recovered
        await transferProjectTokenToVesting(12_345);
        await setBalancesForDelta();
        await insuredVesting.methods.recoverToken(projectToken.options.address).send({ from: deployer });
        await expectProjectBalanceDelta("projectToken", await projectToken.amount(12_345));
      });
    });

    describe("access control", () => {
      describe("only project", () => {
        it("can call activate", async () => {
          const expectedInvalidUsers = [deployer];
          for (const invalidUser of expectedInvalidUsers) {
            await expectRevert(async () => insuredVesting.methods.activate(await getDefaultStartTime()).send({ from: invalidUser }), PROJECT_ROLE_REVERT_MSG);
          }

          await setAllocationForUser1(FUNDING_PER_USER);
          await addFundingFromUser1(FUNDING_PER_USER / 4);
          await approveProjectTokenToVesting();
          await insuredVesting.methods.activate(await getCurrentTimestamp()).send({ from: projectWallet });
        });

        it("can claim on behalf of a user", async () => {
          const expectedInvalidUsers = [user2];

          for (const invalidUser of expectedInvalidUsers) {
            await expectRevert(async () => insuredVesting.methods.claim(user1).send({ from: invalidUser }), Error.OnlyProjectOrSender);
          }

          await setAllocationForUser1(FUNDING_PER_USER);
          await addFundingFromUser1(FUNDING_PER_USER / 4);
          await activateAndReachStartTime();
          await insuredVesting.methods.claim(user1).send({ from: projectWallet });
        });

        it("can emergency claim on behalf of a user", async () => {
          const expectedInvalidUsers = [user2, deployer];

          for (const invalidUser of expectedInvalidUsers) {
            await expectRevert(async () => insuredVesting.methods.emergencyClaim(user1).send({ from: invalidUser }), Error.OnlyProjectOrSender);
          }

          await setAllocationForUser1();
          await addFundingFromUser1();
          await activateAndReachStartTime();
          await insuredVesting.methods.emergencyRelease().send({ from: deployer });
          await insuredVesting.methods.emergencyClaim(user1).send({ from: projectWallet });
        });

        it("can set allocation", async () => {
          const expectedInvalidUsers = [deployer, user1];
          for (const invalidUser of expectedInvalidUsers) {
            await expectRevert(async () => insuredVesting.methods.setAllocation(user1, 1).send({ from: invalidUser }), PROJECT_ROLE_REVERT_MSG);
          }

          await insuredVesting.methods.setAllocation(user1, 1).send({ from: projectWallet });
        });

        it("can transfer project role", async () => {
          const expectedInvalidUsers = [deployer, user1];
          for (const invalidUser of expectedInvalidUsers) {
            await expectRevert(
              async () => insuredVesting.methods.transferProjectRole(differentProjectWallet).send({ from: invalidUser }),
              PROJECT_ROLE_REVERT_MSG
            );
          }

          await insuredVesting.methods.transferProjectRole(differentProjectWallet).send({ from: projectWallet });
        });
      });

      describe("only owner", () => {
        it("can emergency release", async () => {
          await setAllocationForUser1();
          await addFundingFromUser1();

          const expectedInvalidUsers = [projectWallet, user1, user2];
          for (const invalidUser of expectedInvalidUsers) {
            await expectRevert(async () => insuredVesting.methods.emergencyRelease().send({ from: invalidUser }), OWNER_REVERT_MSG);
          }

          await insuredVesting.methods.emergencyRelease().send({ from: deployer });
        });

        it("can recover ether", async () => {
          await setAllocationForUser1();
          await addFundingFromUser1();

          const expectedInvalidUsers = [projectWallet, user1, anyUser];
          for (const invalidUser of expectedInvalidUsers) {
            await expectRevert(async () => insuredVesting.methods.recoverEther().send({ from: invalidUser }), OWNER_REVERT_MSG);
          }

          await insuredVesting.methods.recoverEther().send({ from: deployer });
        });

        it("can recover token", async () => {
          await setAllocationForUser1();
          await addFundingFromUser1();

          const expectedInvalidUsers = [projectWallet, anyUser];
          for (const invalidUser of expectedInvalidUsers) {
            await expectRevert(async () => insuredVesting.methods.recoverToken(someOtherToken.options.address).send({ from: invalidUser }), OWNER_REVERT_MSG);
          }

          await insuredVesting.methods.recoverToken(someOtherToken.options.address).send({ from: deployer });
        });
      });
    });

    describe("Renounce ownership", () => {
      it("emergencyRelease, recoverEther, recoverToken should not be callable after renouncing ownership", async () => {
        await insuredVesting.methods.renounceOwnership().send({ from: deployer });
        await expectRevert(async () => await insuredVesting.methods.emergencyRelease().send({ from: deployer }), CALLER_NOT_OWNER_REVERT_MSG);
        await expectRevert(async () => await insuredVesting.methods.recoverEther().send({ from: deployer }), CALLER_NOT_OWNER_REVERT_MSG);
        await expectRevert(
          async () => await insuredVesting.methods.recoverToken(projectToken.options.address).send({ from: deployer }),
          CALLER_NOT_OWNER_REVERT_MSG
        );
      });
    });

    describe("view functions", () => {
      describe("funding token", () => {
        it("returns 0 vested when not activated", async () => {
          await setAllocationForUser1(FUNDING_PER_USER);
          await addFundingFromUser1(FUNDING_PER_USER);
          expect(await insuredVesting.methods.fundingTokenVestedFor(user1).call()).to.be.bignumber.eq(0);
        });

        it("returns correct vested amount - immediately after activation", async () => {
          await setAllocationForUser1(FUNDING_PER_USER);
          await addFundingFromUser1(FUNDING_PER_USER);
          await activateAndReachStartTime();
          expect(await insuredVesting.methods.fundingTokenVestedFor(user1).call()).to.be.bignumber.closeTo(0, 200);
        });

        it("returns correct vested amount - 30 days", async () => {
          await setAllocationForUser1(FUNDING_PER_USER);
          await addFundingFromUser1(FUNDING_PER_USER);
          await activateAndReachStartTime();
          await advanceDays(30);
          expect(await insuredVesting.methods.fundingTokenVestedFor(user1).call()).to.be.bignumber.eq(await vestedAmount(30, "fundingToken"));
        });

        it("returns correct vested amount - claim", async () => {
          await setAllocationForUser1(FUNDING_PER_USER);
          await addFundingFromUser1(FUNDING_PER_USER);
          await activateAndReachStartTime();
          await advanceDays(30);
          await insuredVesting.methods.claim(user1).send({ from: projectWallet });
          expect(await insuredVesting.methods.fundingTokenClaimableFor(user1).call()).to.be.bignumber.zero;
          await advanceDays(30);
          expect(await insuredVesting.methods.fundingTokenClaimableFor(user1).call()).to.be.bignumber.closeTo(
            await vestedAmount(30, "fundingToken"),
            await fundingToken.amount(0.1)
          );
          expect(await insuredVesting.methods.fundingTokenVestedFor(user1).call()).to.be.bignumber.closeTo(
            await vestedAmount(60, "fundingToken"),
            await fundingToken.amount(0.1)
          );
        });
      });

      describe("project token", () => {
        it("returns 0 vested when not activated", async () => {
          await setAllocationForUser1(FUNDING_PER_USER);
          await addFundingFromUser1(FUNDING_PER_USER);
          expect(await insuredVesting.methods.projectTokenClaimableFor(user1).call()).to.be.bignumber.eq(0);
        });

        it("returns correct vested amount - immediately after activation", async () => {
          await setAllocationForUser1(FUNDING_PER_USER);
          await addFundingFromUser1(FUNDING_PER_USER);
          await activateAndReachStartTime();
          expect(await insuredVesting.methods.projectTokenClaimableFor(user1).call()).to.be.bignumber.closeTo(0, 200);
        });

        it("returns correct vested amount - 30 days", async () => {
          await setAllocationForUser1(FUNDING_PER_USER);
          await addFundingFromUser1(FUNDING_PER_USER);
          await activateAndReachStartTime();
          await advanceDays(30);
          expect(await insuredVesting.methods.projectTokenClaimableFor(user1).call()).to.be.bignumber.closeTo(
            await vestedAmount(30, "projectToken"),
            await projectToken.amount(0.1)
          );
        });

        it("returns correct vested amount - claim", async () => {
          await setAllocationForUser1(FUNDING_PER_USER);
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
      await expectRevert(async () => insuredVesting.methods.activate(timeInPast).send({ from: projectWallet }), Error.StartTimeInPast);
    });

    it("fails if start time is too far in to the future", async () => {
      const timeInDistantFuture = BN(await getCurrentTimestamp())
        .plus(MONTH * 3)
        .plus(DAY);
      await expectRevert(async () => insuredVesting.methods.activate(timeInDistantFuture).send({ from: projectWallet }), Error.StartTimeTooDistant);
    });

    it("fails if there isn't enough PROJECT_TOKEN allowance to cover funded FUNDING_TOKEN", async () => {
      await setAllocationForUser1(FUNDING_PER_USER);
      await addFundingFromUser1(FUNDING_PER_USER);
      await expectRevert(
        async () => insuredVesting.methods.activate(await getCurrentTimestamp()).send({ from: projectWallet }),
        "ERC20: insufficient allowance"
      );
    });

    it("fails if there isn't enough PROJECT_TOKEN balance to cover funded FUNDING_TOKEN", async () => {
      await setAllocationForUser1(FUNDING_PER_USER);
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
      await setAllocationForUser1(FUNDING_PER_USER);
      await addFundingFromUser1(FUNDING_PER_USER / 4);

      const requiredProjectToken = await projectToken.amount((FUNDING_PER_USER / 4) * FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO);

      await approveProjectTokenToVesting();

      await insuredVesting.methods.activate(await getCurrentTimestamp()).send({ from: projectWallet });

      const contractProjectTokenBalance = await projectToken.methods.balanceOf(insuredVesting.options.address).call();

      expect(contractProjectTokenBalance).to.be.bignumber.eq(requiredProjectToken);
    });

    it("transfers allocated amount PROJECT_TOKEN even if already funded sufficiently", async () => {
      await setAllocationForUser1(FUNDING_PER_USER);
      await addFundingFromUser1(FUNDING_PER_USER);

      await approveProjectTokenToVesting();

      await projectToken.methods.transfer(insuredVesting.options.address, await projectToken.amount(FUNDING_PER_USER * 10)).send({ from: projectWallet });

      const initialContractProjectTokenBalance = await projectToken.methods.balanceOf(insuredVesting.options.address).call();
      await insuredVesting.methods.activate(await getCurrentTimestamp()).send({ from: projectWallet });
      const contractProjectTokenBalance = await projectToken.methods.balanceOf(insuredVesting.options.address).call();

      expect(BN(contractProjectTokenBalance).minus(initialContractProjectTokenBalance)).to.be.bignumber.eq(fundingTokenToProjectToken(BN(FUNDING_PER_USER)));
    });

    it("transfers PROJECT_TOKEN required to cover FUNDING_TOKEN funding (partially pre-funded)", async () => {
      await setAllocationForUser1(FUNDING_PER_USER);
      await addFundingFromUser1(FUNDING_PER_USER);

      const requiredProjectToken = await projectToken.amount(FUNDING_PER_USER * FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO);

      await approveProjectTokenToVesting();

      await projectToken.methods.transfer(insuredVesting.options.address, await projectToken.amount(FUNDING_PER_USER / 3)).send({ from: projectWallet });

      const initialProjectTokenBalance = await projectToken.methods.balanceOf(insuredVesting.options.address).call();
      await insuredVesting.methods.activate(await getCurrentTimestamp()).send({ from: projectWallet });
      const contractProjectTokenBalance = await projectToken.methods.balanceOf(insuredVesting.options.address).call();

      expect(BN(contractProjectTokenBalance).minus(initialProjectTokenBalance)).to.be.bignumber.eq(requiredProjectToken);
    });

    it("fails if already activated", async () => {
      await setAllocationForUser1(FUNDING_PER_USER);
      await addFundingFromUser1(FUNDING_PER_USER);
      await approveProjectTokenToVesting();

      await insuredVesting.methods.activate(await getCurrentTimestamp()).send({ from: projectWallet });

      await expectRevert(async () => insuredVesting.methods.activate(await getCurrentTimestamp()).send({ from: projectWallet }), Error.AlreadyActivated);
    });

    it("fails if not funded", async () => {
      await expectRevert(async () => insuredVesting.methods.activate(await getCurrentTimestamp()).send({ from: projectWallet }), Error.NoFundsAdded);
    });

    it("activates", async () => {
      await setAllocationForUser1(FUNDING_PER_USER);
      await addFundingFromUser1(FUNDING_PER_USER);
      await approveProjectTokenToVesting();

      await insuredVesting.methods.activate(await getCurrentTimestamp()).send({ from: projectWallet });

      expect(await insuredVesting.methods.vestingStartTime().call()).to.be.bignumber.closeTo(await getCurrentTimestamp(), 1);
    });

    it("tranfers the correct amount of PROJECT_TOKEN after setting allocations with refunds", async () => {
      await setAllocationForUser1(FUNDING_PER_USER);
      await addFundingFromUser1(FUNDING_PER_USER);
      await setAllocationForUser2(FUNDING_PER_USER);
      await addFundingFromUser2(FUNDING_PER_USER);
      // Reduce allocation
      await setAllocationForUser2(FUNDING_PER_USER / 2);

      await approveProjectTokenToVesting((FUNDING_PER_USER + FUNDING_PER_USER / 2) * FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO);
      await insuredVesting.methods.activate(await getCurrentTimestamp()).send({ from: projectWallet });
    });
  });

  describe("deployment", () => {
    it("cannot set vesting duration to over 10 years", async () => {
      // TODO TEMPORARY: until having production project token address & project wallet address
      const testConfig = [...config];
      testConfig[1] = projectToken.options.address;
      testConfig[2] = projectWallet;
      // END TEMPORARY

      const YEAR = 365 * DAY;
      for (const duration of [YEAR * 11, YEAR * 100]) {
        testConfig[4] = duration;
        await expectRevert(() => deployArtifact<InsuredVestingV1>("InsuredVestingV1", { from: deployer }, testConfig), Error.VestingDurationTooLong);
      }

      for (const duration of [0, YEAR * 3, YEAR * 10, YEAR * 9]) {
        testConfig[4] = duration;
        await deployArtifact<InsuredVestingV1>("InsuredVestingV1", { from: deployer }, testConfig);
      }
    });
  });
});
