import { expect } from "chai";
import BN from "bignumber.js";
import { SnapshotRestorer, takeSnapshot } from "@nomicfoundation/hardhat-network-helpers";
import { deployArtifact, expectRevert, setBalance, tag } from "@defi.org/web3-candies/dist/hardhat";
import {
  FUNDING_PER_USER,
  LOCKUP_MONTHS,
  USDC_TO_XCTD_RATIO,
  advanceMonths,
  anyUser,
  project,
  user1,
  insuredVesting,
  withFixture,
  xctd,
  deployer,
  someOtherToken,
  getCurrentTimestamp,
  user2,
  additionalUsers,
  setup,
  advanceDays,
  Error,
  VESTING_DURATION_SECONDS,
  DAY,
  VESTING_DURATION_DAYS,
  transferXctdToVesting,
  approveXctdToVesting,
  addFundingFromUser1,
  addFundingFromUser2,
  setAllocationForUser1,
  setAllocationForUser2,
  XCTD_TOKENS_ON_SALE,
  Event,
  expectProjectBalanceDelta,
  expectUserBalanceDelta,
  setBalancesForDelta,
  vestedAmount,
  balances,
  usdc,
  fundUsdcFromWhale,
} from "./fixture";
import { account, bn18, bn6, web3, zeroAddress } from "@defi.org/web3-candies";
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

  describe("with xctd approved to contract", () => {
    beforeEach(async () => {
      approveXctdToVesting();
    });

    describe("claim", () => {
      const testCases = [0, 1, 5, 10, 100, 200, 534];

      for (const days of testCases) {
        it(`can claim tokens proportional to amount of seconds in ${days} days passed`, async () => {
          await setAllocationForUser1();
          await addFundingFromUser1();
          await insuredVesting.methods.activate().send({ from: deployer });
          await advanceDays(days);
          await insuredVesting.methods.claim(user1).send({ from: user1 });

          await expectUserBalanceDelta("xctd", await vestedAmount(days, "xctd"));
          await expectUserBalanceDelta("usdc", 0);
        });
      }

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
        await insuredVesting.methods.activate().send({ from: deployer });
        await advanceDays(6);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("xctd", await vestedAmount(6, "xctd"));
        await expectUserBalanceDelta("usdc", 0);
      });

      it("can claim tokens for multiple users, random amounts", async () => {
        const additionalUsersFunding = [];

        for (const user of additionalUsers) {
          const amountToAllocate = 10 + Math.round(Math.random() * (FUNDING_PER_USER - 10));
          await insuredVesting.methods.setAllocation(user, await usdc.amount(FUNDING_PER_USER)).send({ from: deployer });
          const amountToFund = 10 + Math.round(Math.random() * (amountToAllocate - 10));
          await insuredVesting.methods.addFunds(await usdc.amount(amountToFund)).send({ from: user });
          additionalUsersFunding.push(amountToFund);
        }

        await setAllocationForUser1();
        await addFundingFromUser1();
        await setBalancesForDelta();
        await insuredVesting.methods.activate().send({ from: deployer });
        await advanceDays(30);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("xctd", await vestedAmount(30, "xctd"));
        await expectUserBalanceDelta("usdc", 0);

        for (const [index, user] of additionalUsers.entries()) {
          const funding = additionalUsersFunding[index];
          expect(await xctd.methods.balanceOf(user).call()).to.be.bignumber.zero;
          await insuredVesting.methods.claim(user).send({ from: user });
          expect(await xctd.methods.balanceOf(user).call()).to.be.bignumber.closeTo(
            (await xctd.amount(funding))
              .multipliedBy(USDC_TO_XCTD_RATIO)
              .multipliedBy(30 * DAY)
              .dividedBy(VESTING_DURATION_SECONDS),
            await xctd.amount(0.1)
          );
        }
      });

      // TODO figure out a way to send both claims in the same block
      it.skip("cannot claim if there's nothing to claim", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await insuredVesting.methods.activate().send({ from: deployer });
        insuredVesting.methods.claim(user1).send({ from: user1 });

        await expectRevert(() => insuredVesting.methods.claim(user1).send({ from: user1 }), Error.NothingToClaim);
      });

      it("can fund a partial allocation and claim tokens", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1(FUNDING_PER_USER / 3);
        await setBalancesForDelta();
        await insuredVesting.methods.activate().send({ from: deployer });
        await advanceDays(20);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("xctd", (await vestedAmount(20, "xctd")).dividedBy(3));
        await expectUserBalanceDelta("usdc", 0);
      });

      it("can fund a partial allocation multiple times and claim tokens for vesting period 1", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1(FUNDING_PER_USER / 4);
        await advanceMonths(2);
        await addFundingFromUser1(FUNDING_PER_USER / 4);
        await setBalancesForDelta();
        await advanceMonths(LOCKUP_MONTHS - 2);
        await insuredVesting.methods.activate().send({ from: deployer });
        await advanceDays(20);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("xctd", (await vestedAmount(20, "xctd")).dividedBy(2));
        await expectUserBalanceDelta("usdc", 0);
      });

      it("cannot double-claim tokens for same period of time", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await insuredVesting.methods.activate().send({ from: deployer });
        await advanceDays(45);

        await insuredVesting.methods.claim(user1).send({ from: user1 });

        await setBalancesForDelta();
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("xctd", 0);
      });

      it("cannot claim tokens before starting period, zero time", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await expectRevert(() => insuredVesting.methods.claim(user1).send({ from: user1 }), Error.VestingNotStarted);
      });

      it("cannot claim tokens before starting period, some time has passed", async () => {
        await advanceMonths(LOCKUP_MONTHS / 2);
        await setAllocationForUser1();
        await addFundingFromUser1();
        await expectRevert(() => insuredVesting.methods.claim(user1).send({ from: user1 }), Error.VestingNotStarted);
      });

      it("cannot claim if not funded", async () => {
        await advanceMonths(LOCKUP_MONTHS);
        await setAllocationForUser1();
        await addFundingFromUser1();
        await insuredVesting.methods.activate().send({ from: deployer });
        await expectRevert(async () => insuredVesting.methods.claim(user2).send({ from: user2 }), Error.NoFundsAdded);
      });

      it("can claim tokens for the entire vesting period", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await setBalancesForDelta();
        await insuredVesting.methods.activate().send({ from: deployer });
        await advanceDays(VESTING_DURATION_DAYS);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("xctd", await xctd.amount(FUNDING_PER_USER * USDC_TO_XCTD_RATIO));
        await expectUserBalanceDelta("usdc", 0);
      });

      it("can claim tokens for entire vesting period, many months passed", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await setBalancesForDelta();
        await insuredVesting.methods.activate().send({ from: deployer });
        await advanceDays(VESTING_DURATION_DAYS * 3);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("xctd", await xctd.amount(FUNDING_PER_USER * USDC_TO_XCTD_RATIO));
        await expectUserBalanceDelta("usdc", 0);
      });

      it("project receives funding when claim is made", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await insuredVesting.methods.activate().send({ from: deployer });
        await setBalancesForDelta();
        await advanceDays(77);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectProjectBalanceDelta("usdc", await vestedAmount(77, "usdc"));
        await expectProjectBalanceDelta("xctd", 0);
      });

      it("owner can claim on behalf of user", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await insuredVesting.methods.activate().send({ from: deployer });
        await setBalancesForDelta();
        await advanceDays(77);
        await insuredVesting.methods.claim(user1).send({ from: deployer });
        await expectProjectBalanceDelta("usdc", await vestedAmount(77, "usdc"));
        await expectProjectBalanceDelta("xctd", 0);
      });

      it("cannot claim if not user or project", async () => {
        await setBalancesForDelta();
        await setAllocationForUser1();
        await addFundingFromUser1();
        await insuredVesting.methods.activate().send({ from: deployer });
        await advanceDays(77);
        await expectRevert(() => insuredVesting.methods.claim(user1).send({ from: anyUser }), Error.OnlyOwnerOrSender);
      });

      it("claim according to updated funding if allocation was updated", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await setAllocationForUser1(FUNDING_PER_USER / 4);
        await insuredVesting.methods.activate().send({ from: deployer });
        await advanceDays(77);
        await setBalancesForDelta();
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("xctd", (await vestedAmount(77, "xctd")).dividedBy(4));
      });
    });

    describe("toggle decision", () => {
      it("can toggle decision and claim usdc back (toggle after vesting)", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();

        await insuredVesting.methods.activate().send({ from: deployer });
        await setBalancesForDelta();

        await advanceDays(30);

        await insuredVesting.methods.toggleDecision().send({ from: user1 });
        await insuredVesting.methods.claim(user1).send({ from: user1 });

        await expectUserBalanceDelta("xctd", 0);
        await expectProjectBalanceDelta("xctd", await vestedAmount(30, "xctd"));
        await expectUserBalanceDelta("usdc", await vestedAmount(30, "usdc"));
        await expectProjectBalanceDelta("usdc", 0);
      });

      it("can toggle decision and claim usdc back (toggle before vesting)", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();

        await insuredVesting.methods.toggleDecision().send({ from: user1 });

        await insuredVesting.methods.activate().send({ from: deployer });
        await setBalancesForDelta();

        await advanceDays(30);

        await insuredVesting.methods.claim(user1).send({ from: user1 });

        await expectUserBalanceDelta("xctd", 0);
        await expectProjectBalanceDelta("xctd", await vestedAmount(30, "xctd"));
        await expectUserBalanceDelta("usdc", await vestedAmount(30, "usdc"));
        await expectProjectBalanceDelta("usdc", 0);
      });

      it("can claim some tokens, some usdc for entire vesting period, use toggle multiple times", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();

        // Claim for 11 months
        await insuredVesting.methods.activate().send({ from: deployer });
        await setBalancesForDelta();
        const currentProjectXctdBalance = balances.project.xctd;

        await advanceDays(11 * 30);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("xctd", await vestedAmount(11 * 30, "xctd"));
        await expectUserBalanceDelta("usdc", 0);
        await expectProjectBalanceDelta("xctd", 0);
        await expectProjectBalanceDelta("usdc", await vestedAmount(11 * 30, "usdc"));

        // Toggle, let 3 months pass and claim USDC (we're at month 14)
        await insuredVesting.methods.toggleDecision().send({ from: user1 });
        await advanceDays(3 * 30);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("xctd", await vestedAmount(11 * 30, "xctd"));
        await expectUserBalanceDelta("usdc", await vestedAmount(3 * 30, "usdc"));
        await expectProjectBalanceDelta("xctd", await vestedAmount(3 * 30, "xctd"));
        await expectProjectBalanceDelta("usdc", await vestedAmount(11 * 30, "usdc"));

        // Let another 3 months pass, toggle again to token and claim (we're at month 17)
        await advanceDays(3 * 30);
        await insuredVesting.methods.toggleDecision().send({ from: user1 });
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("xctd", await vestedAmount(14 * 30, "xctd"));
        await expectUserBalanceDelta("usdc", await vestedAmount(3 * 30, "usdc"));
        await expectProjectBalanceDelta("xctd", await vestedAmount(3 * 30, "xctd"));
        await expectProjectBalanceDelta("usdc", await vestedAmount(14 * 30, "usdc"));

        // Toggle again and claim USDC for remaining periods (we're at month 24 - finished)
        await insuredVesting.methods.toggleDecision().send({ from: user1 });
        await advanceDays(220);
        await insuredVesting.methods.claim(user1).send({ from: user1 });

        // Update balances and verify no remainders
        await setBalancesForDelta();
        expect(balances.project.usdc.plus(balances.user1.usdc)).to.be.bignumber.eq(await usdc.amount(FUNDING_PER_USER));
        expect(balances.project.xctd.plus(balances.user1.xctd)).to.be.bignumber.eq(
          (await xctd.amount(FUNDING_PER_USER)).multipliedBy(USDC_TO_XCTD_RATIO).plus(currentProjectXctdBalance)
        );
      });

      it("cannot toggle decision if has not funded", async () => {
        await setAllocationForUser1();

        await expectRevert(() => insuredVesting.methods.toggleDecision().send({ from: user1 }), Error.NoFundsAdded);
      });
    });

    describe("add funds", () => {
      it("can add funds", async () => {
        await setBalancesForDelta();
        await setAllocationForUser1();
        await addFundingFromUser1();
        await expectUserBalanceDelta("usdc", (await usdc.amount(FUNDING_PER_USER)).negated());
      });

      it("can add 1 wei amounts of USDC, fully vested", async () => {
        await setBalancesForDelta();
        await setAllocationForUser1();
        await insuredVesting.methods.addFunds(1).send({ from: user1 });
        await expectUserBalanceDelta("usdc", -1);
        await insuredVesting.methods.activate().send({ from: deployer });
        await advanceDays(VESTING_DURATION_DAYS);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("xctd", 1e12 * USDC_TO_XCTD_RATIO, 0);
      });

      it("can add 1 wei amounts of USDC, partially vested", async () => {
        await setBalancesForDelta();
        await setAllocationForUser1();
        await insuredVesting.methods.addFunds(1).send({ from: user1 });
        await expectUserBalanceDelta("usdc", -1);
        await insuredVesting.methods.activate().send({ from: deployer });
        await advanceDays(30);

        // This is a corner case where the amount funded is so little, it's indivisible relative to the time passed
        await expectRevert(async () => insuredVesting.methods.claim(user1).send({ from: user1 }), Error.NothingToClaim);
      });

      it("can add ~wei amounts of USDC, partially vested", async () => {
        await setBalancesForDelta();
        await setAllocationForUser1();
        await insuredVesting.methods.addFunds(100).send({ from: user1 });
        await expectUserBalanceDelta("usdc", -1);
        await insuredVesting.methods.activate().send({ from: deployer });
        await advanceDays(30);
        await insuredVesting.methods.claim(user1).send({ from: user1 });
        await expectUserBalanceDelta("xctd", 4 * 1e12 * USDC_TO_XCTD_RATIO, 0);
      });

      it("user cannot fund if does not have allocation", async () => {
        const amount = await usdc.amount(FUNDING_PER_USER);
        await expectRevert(async () => insuredVesting.methods.addFunds(amount).send({ from: user1 }), `${Error.AllocationExceeded}(${amount})`);
      });

      it("user cannot add more funds than allocation, two attempts", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        const amount = await usdc.amount(1);
        await expectRevert(async () => insuredVesting.methods.addFunds(amount).send({ from: user1 }), `${Error.AllocationExceeded}(${amount})`);
      });

      it("user cannot add more funds than allocation, single attempts", async () => {
        await setAllocationForUser1();
        const amount = await usdc.amount(FUNDING_PER_USER + 1);
        await expectRevert(async () => insuredVesting.methods.addFunds(amount).send({ from: user1 }), `${Error.AllocationExceeded}(${amount})`);
      });

      it("cannot add funds after vesting started", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1(FUNDING_PER_USER / 2);
        await insuredVesting.methods.activate().send({ from: deployer });
        await expectRevert(async () => insuredVesting.methods.addFunds(1).send({ from: user1 }), Error.VestingAlreadyStarted);
      });

      it("cannot add funds if emergency released", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1(FUNDING_PER_USER / 2);
        await insuredVesting.methods.emergencyRelease().send({ from: deployer });
        await expectRevert(async () => insuredVesting.methods.addFunds(1).send({ from: user1 }), Error.EmergencyReleased);
      });

      it("fails if user does not have enough balance", async () => {
        const amount = FUNDING_PER_USER + 1;
        await insuredVesting.methods.setAllocation(user1, await usdc.amount(amount)).send({ from: deployer });
        await expectRevert(
          async () => insuredVesting.methods.addFunds(await usdc.amount(amount)).send({ from: user1 }),
          "ERC20: transfer amount exceeds allowance"
        );
      });
    });

    describe("admin", () => {
      describe("set allocation", () => {
        it("cannot set allocation after period started", async () => {
          await setAllocationForUser1(FUNDING_PER_USER / 4);
          await addFundingFromUser1(FUNDING_PER_USER / 4);
          await insuredVesting.methods.activate().send({ from: deployer });
          await expectRevert(
            async () => insuredVesting.methods.setAllocation(user1, await usdc.amount(FUNDING_PER_USER)).send({ from: deployer }),
            Error.VestingAlreadyStarted
          );
        });

        describe("existing excess deposit is refunded in case of allocation decrease", () => {
          it("single user", async () => {
            await setBalancesForDelta();
            await setAllocationForUser1();
            await addFundingFromUser1();
            await expectUserBalanceDelta("usdc", (await usdc.amount(FUNDING_PER_USER)).negated(), 1);

            await setBalancesForDelta();
            const newAmount = FUNDING_PER_USER / 3;
            const newAllocation = await usdc.amount(newAmount);
            await insuredVesting.methods.setAllocation(user1, newAllocation).send({ from: deployer });

            // // check user USDC balance reflects refunded amount
            await expectUserBalanceDelta("usdc", await usdc.amount(FUNDING_PER_USER - newAmount), 1);
            // // check contract USDC balance has been updated
            expect(await usdc.methods.balanceOf(insuredVesting.options.address).call()).to.be.bignumber.eq(newAllocation);
            // // check user allocation has been updated
            expect((await insuredVesting.methods.userVestings(user1).call()).usdcAllocation).to.be.bignumber.eq(newAllocation);
          });

          // TODO: multiple user scenarios
        });

        describe("setAllocation", () => {
          const testCases: { description: string; setAllocationsFn: () => Promise<any>; expectedAllocation: BN }[] = [
            {
              description: "single user",
              setAllocationsFn: async () => await insuredVesting.methods.setAllocation(user1, await usdc.amount(FUNDING_PER_USER)).send({ from: deployer }),
              expectedAllocation: BN(FUNDING_PER_USER),
            },
            {
              description: "multiple users, smaller allocation added",
              setAllocationsFn: async () => {
                await insuredVesting.methods.setAllocation(user1, await usdc.amount(FUNDING_PER_USER)).send({ from: deployer });
                await insuredVesting.methods.setAllocation(user2, await usdc.amount(FUNDING_PER_USER / 5)).send({ from: deployer });
                await insuredVesting.methods.setAllocation(user1, await usdc.amount(FUNDING_PER_USER / 2)).send({ from: deployer });
              },
              expectedAllocation: BN(FUNDING_PER_USER / 2),
            },
            {
              description: "multiple users, larger allocation added",
              setAllocationsFn: async () => {
                await insuredVesting.methods.setAllocation(user2, await usdc.amount(FUNDING_PER_USER / 2)).send({ from: deployer });
                await insuredVesting.methods.setAllocation(user1, await usdc.amount(FUNDING_PER_USER)).send({ from: deployer });
                await insuredVesting.methods.setAllocation(user2, await usdc.amount(FUNDING_PER_USER)).send({ from: deployer });
              },
              expectedAllocation: BN(FUNDING_PER_USER),
            },
            {
              description: "multiple users, allocation removed",
              setAllocationsFn: async () => {
                await insuredVesting.methods.setAllocation(user2, await usdc.amount(FUNDING_PER_USER / 2)).send({ from: deployer });
                await insuredVesting.methods.setAllocation(user1, await usdc.amount(FUNDING_PER_USER)).send({ from: deployer });
                await insuredVesting.methods.setAllocation(user2, await usdc.amount(0)).send({ from: deployer });
              },
              expectedAllocation: BN(FUNDING_PER_USER),
            },
            {
              description: "allocation increased after funding",
              setAllocationsFn: async () => {
                await insuredVesting.methods.setAllocation(user1, await usdc.amount(FUNDING_PER_USER)).send({ from: deployer });
                await insuredVesting.methods.setAllocation(user2, await usdc.amount(FUNDING_PER_USER)).send({ from: deployer });
                await insuredVesting.methods.addFunds(await usdc.amount(FUNDING_PER_USER)).send({ from: user1 });
                await insuredVesting.methods.setAllocation(user1, await usdc.amount(FUNDING_PER_USER * 2)).send({ from: deployer });
              },
              expectedAllocation: BN(FUNDING_PER_USER * 2),
            },
          ];

          testCases.forEach(({ description, setAllocationsFn, expectedAllocation }) => {
            it(description, async () => {
              await setAllocationsFn();
              const actualUsdcAllocation = (await insuredVesting.methods.userVestings(user1).call()).usdcAllocation;
              expect(actualUsdcAllocation).to.be.bignumber.eq(await usdc.amount(expectedAllocation));
            });
          });
        });
      });

      it("cannot set allocation if emergency released", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await insuredVesting.methods.emergencyRelease().send({ from: deployer });
        await expectRevert(() => insuredVesting.methods.setAllocation(user1, 1).send({ from: deployer }), Error.EmergencyReleased);
      });
    });

    describe("emergency release", () => {
      it("lets user emergency claim back all USDC balance, no XCTD has been claimed", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await insuredVesting.methods.emergencyRelease().send({ from: deployer });
        await insuredVesting.methods.emergencyClaim(user1).send({ from: user1 });
        expect(await usdc.methods.balanceOf(user1).call()).to.be.bignumber.eq(await usdc.amount(FUNDING_PER_USER));
      });

      it("lets owner emergency claim back all USDC balance on behalf of user, no XCTD has been claimed", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await insuredVesting.methods.emergencyRelease().send({ from: deployer });
        await insuredVesting.methods.emergencyClaim(user1).send({ from: deployer });
        expect(await usdc.methods.balanceOf(user1).call()).to.be.bignumber.eq(await usdc.amount(FUNDING_PER_USER));
      });

      it("cannot emergency claim if hasn't funded", async () => {
        await setAllocationForUser1();
        await insuredVesting.methods.emergencyRelease().send({ from: deployer });
        await expectRevert(() => insuredVesting.methods.emergencyClaim(user1).send({ from: user1 }), Error.NoFundsAdded);
      });

      it("lets user emergency claim back remaining USDC balance, some XCTD claimed", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await insuredVesting.methods.activate().send({ from: deployer });
        await advanceDays(VESTING_DURATION_DAYS / 10);
        await insuredVesting.methods.claim(user1).send({ from: deployer });
        await insuredVesting.methods.emergencyRelease().send({ from: deployer });

        await insuredVesting.methods.emergencyClaim(user1).send({ from: user1 });
        expect(await usdc.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(BN((await usdc.amount(FUNDING_PER_USER)).multipliedBy(0.9)), 200);
      });

      it("cannot regularly claim once emergency released", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await insuredVesting.methods.activate().send({ from: deployer });
        await insuredVesting.methods.emergencyRelease().send({ from: deployer });
        await expectRevert(async () => insuredVesting.methods.claim(user1).send({ from: user1 }), Error.EmergencyReleased);
      });

      it("cannot emergency claim twice", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await setAllocationForUser2();
        await addFundingFromUser2();
        await insuredVesting.methods.emergencyRelease().send({ from: deployer });
        await insuredVesting.methods.emergencyClaim(user1).send({ from: user1 });
        expect(await usdc.methods.balanceOf(user1).call()).to.be.bignumber.eq(await usdc.amount(FUNDING_PER_USER));
        await insuredVesting.methods.emergencyClaim(user1).send({ from: user1 });
        expect(await usdc.methods.balanceOf(user1).call()).to.be.bignumber.eq(await usdc.amount(FUNDING_PER_USER));
      });

      it("cannot emergency claim if owner hasn't released", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await expectRevert(() => insuredVesting.methods.emergencyClaim(user1).send({ from: user1 }), Error.EmergencyNotReleased);
      });

      it("only owner or user can emergency claim", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await setAllocationForUser2();
        await addFundingFromUser2();
        await insuredVesting.methods.emergencyRelease().send({ from: deployer });
        await expectRevert(() => insuredVesting.methods.emergencyClaim(user1).send({ from: user2 }), Error.OnlyOwnerOrSender);
      });

      it("only owner can emergency release", async () => {
        await setAllocationForUser1();
        await addFundingFromUser1();
        await expectRevert(() => insuredVesting.methods.emergencyRelease().send({ from: user1 }), "Ownable: caller is not the owner");
      });

      it("cannot emergency release twice", async () => {
        await insuredVesting.methods.emergencyRelease().send({ from: deployer });
        await expectRevert(() => insuredVesting.methods.emergencyRelease().send({ from: deployer }), Error.EmergencyReleased);
      });

      it("recovers all remaining xctd balance if emergency released", async () => {
        await insuredVesting.methods.setAllocation(user1, await usdc.amount(FUNDING_PER_USER)).send({ from: deployer });
        await insuredVesting.methods.setAllocation(user2, await usdc.amount(FUNDING_PER_USER)).send({ from: deployer });
        await transferXctdToVesting(FUNDING_PER_USER * 2 * USDC_TO_XCTD_RATIO);
        await insuredVesting.methods.addFunds(await usdc.amount(FUNDING_PER_USER)).send({ from: user1 });
        await insuredVesting.methods.addFunds(await usdc.amount(FUNDING_PER_USER)).send({ from: user2 });
        await insuredVesting.methods.emergencyRelease().send({ from: deployer });

        await setBalancesForDelta();
        await insuredVesting.methods.recover(xctd.options.address).send({ from: deployer });
        // Recover all but the tokens allocated to users, backed by funding
        expect(await xctd.methods.balanceOf(insuredVesting.options.address).call()).to.be.bignumber.eq(0);
        await expectProjectBalanceDelta("xctd", (await xctd.amount(FUNDING_PER_USER * 2)).multipliedBy(USDC_TO_XCTD_RATIO));
        await expectProjectBalanceDelta("usdc", 0);
      });
    });

    describe("update project address", () => {
      it("should only be updatable by owner", async () => {
        expect(await insuredVesting.methods.project().call()).to.be.eq(project);
        const newProjectAddress = "0x148A0353F50Ba5683Ab0513CF6bda4E4fD43d7D4";
        await insuredVesting.methods.setProjectAddress(newProjectAddress).send({ from: deployer });
        expect(await insuredVesting.methods.project().call()).to.be.eq(newProjectAddress);
      });

      it("should not be updatable by non-owner", async () => {
        const newProjectAddress = "0x148A0353F50Ba5683Ab0513CF6bda4E4fD43d7D4";
        await expectRevert(() => insuredVesting.methods.setProjectAddress(newProjectAddress).send({ from: user1 }), "Ownable: caller is not the owner");
      });

      it("should not be updatable to zero address", async () => {
        await expectRevert(() => insuredVesting.methods.setProjectAddress(zeroAddress).send({ from: deployer }), Error.ZeroAddress);
      });

      it(`should emit '${Event.ProjectAddressChanged}' event upon updating`, async () => {
        const newProjectAddress = "0x148A0353F50Ba5683Ab0513CF6bda4E4fD43d7D4";
        await insuredVesting.methods.setProjectAddress(newProjectAddress).send({ from: deployer });
        const events = await insuredVesting.getPastEvents(Event.ProjectAddressChanged);
        expect(events[0].returnValues.oldAddress).to.be.eq(project);
        expect(events[0].returnValues.newAddress).to.be.eq(newProjectAddress);
      });
    });

    // TODO add expectations for project balances
    describe("recovery", () => {
      it("recovers ether", async () => {
        const startingBalance = await web3().eth.getBalance(project);
        expect(await web3().eth.getBalance(insuredVesting.options.address)).to.bignumber.eq(0);
        await setBalance(insuredVesting.options.address, BN(12345 * 1e18));
        await insuredVesting.methods.recover(xctd.options.address).send({ from: deployer });
        expect(await web3().eth.getBalance(insuredVesting.options.address)).to.be.bignumber.zero;
        expect(await web3().eth.getBalance(project)).to.bignumber.closeTo(BN(12345 * 1e18).plus(startingBalance), BN(0.1e18));
      });

      it("recovers other tokens", async () => {
        await someOtherToken.methods.transfer(insuredVesting.options.address, BN(12345 * 1e18)).send({ from: deployer });
        await insuredVesting.methods.recover(someOtherToken.options.address).send({ from: deployer });
        expect(await someOtherToken.methods.balanceOf(insuredVesting.options.address).call()).to.be.bignumber.zero;
      });

      // TODO does retrieiving XCTD work only based off allocations or do we have the option to cancel before vesting started.
      it("recovers excess xctd (fully funded) ", async () => {
        await insuredVesting.methods.setAllocation(user1, await usdc.amount(FUNDING_PER_USER)).send({ from: deployer });
        await insuredVesting.methods.setAllocation(user2, await usdc.amount(FUNDING_PER_USER)).send({ from: deployer });
        await transferXctdToVesting();
        await insuredVesting.methods.addFunds(await usdc.amount(FUNDING_PER_USER)).send({ from: user1 });
        await insuredVesting.methods.addFunds(await usdc.amount(FUNDING_PER_USER)).send({ from: user2 });
        await insuredVesting.methods.recover(xctd.options.address).send({ from: deployer });
        // Recover all but the tokens allocated to users, backed by funding
        expect(await xctd.methods.balanceOf(insuredVesting.options.address).call()).to.be.bignumber.eq(
          (await xctd.amount(FUNDING_PER_USER * 2)).multipliedBy(USDC_TO_XCTD_RATIO)
        );
      });

      it("recovers excess xctd (underfunded)", async () => {
        await insuredVesting.methods.setAllocation(user1, await usdc.amount(FUNDING_PER_USER)).send({ from: deployer });
        await insuredVesting.methods.setAllocation(user2, await usdc.amount(FUNDING_PER_USER)).send({ from: deployer });
        await insuredVesting.methods.addFunds(await usdc.amount(FUNDING_PER_USER)).send({ from: user1 });
        await insuredVesting.methods.addFunds(await usdc.amount(FUNDING_PER_USER)).send({ from: user2 });
        await xctd.methods.transfer(insuredVesting.options.address, await xctd.amount(100)).send({ from: project });
        await insuredVesting.methods.recover(xctd.options.address).send({ from: deployer });
        // Retains tokens in the contract, nothing to recover
        expect(await xctd.methods.balanceOf(insuredVesting.options.address).call()).to.be.bignumber.eq(await xctd.amount(100));
      });

      // TODO refactor balance deltas
      // todo expectbalancedelta shouldn't run token.amount(...)
      it("recovers by zeroing out allocations (pre-activation)", async () => {
        await insuredVesting.methods.setAllocation(user1, await usdc.amount(FUNDING_PER_USER)).send({ from: deployer });
        await insuredVesting.methods.setAllocation(user2, await usdc.amount(FUNDING_PER_USER)).send({ from: deployer });
        await insuredVesting.methods.addFunds(await usdc.amount(FUNDING_PER_USER)).send({ from: user1 });
        await insuredVesting.methods.addFunds(await usdc.amount(FUNDING_PER_USER)).send({ from: user2 });
        await transferXctdToVesting();

        let initiaProjectBalance = await xctd.methods.balanceOf(project).call();
        await setBalancesForDelta();
        await insuredVesting.methods.recover(xctd.options.address).send({ from: deployer });

        expect(await xctd.methods.balanceOf(insuredVesting.options.address).call()).to.be.bignumber.eq(
          (await xctd.amount(FUNDING_PER_USER * 2)).multipliedBy(USDC_TO_XCTD_RATIO)
        );
        expect(await xctd.methods.balanceOf(project).call()).to.be.bignumber.eq(
          BN(initiaProjectBalance)
            .plus(await xctd.amount(XCTD_TOKENS_ON_SALE))
            .minus((await xctd.amount(FUNDING_PER_USER * 2)).multipliedBy(USDC_TO_XCTD_RATIO))
        );

        const user1UsdcBalanceBefore = await usdc.methods.balanceOf(user1).call();
        const user2UsdcBalanceBefore = await usdc.methods.balanceOf(user2).call();
        await insuredVesting.methods.setAllocation(user1, 0).send({ from: deployer });
        await insuredVesting.methods.setAllocation(user2, 0).send({ from: deployer });
        expect(BN(await usdc.methods.balanceOf(user1).call()).minus(user1UsdcBalanceBefore)).to.be.bignumber.eq(await usdc.amount(FUNDING_PER_USER));
        expect(BN(await usdc.methods.balanceOf(user2).call()).minus(user2UsdcBalanceBefore)).to.be.bignumber.eq(await usdc.amount(FUNDING_PER_USER));

        initiaProjectBalance = await xctd.methods.balanceOf(project).call();
        await insuredVesting.methods.recover(xctd.options.address).send({ from: deployer });
        expect(await xctd.methods.balanceOf(insuredVesting.options.address).call()).to.be.bignumber.eq(0);
        expect(await xctd.methods.balanceOf(project).call()).to.be.bignumber.eq(
          BN(initiaProjectBalance).plus((await xctd.amount(FUNDING_PER_USER * 2)).multipliedBy(USDC_TO_XCTD_RATIO))
        );
      });

      [
        ["minimally overfunded", 1],
        ["overfunded", FUNDING_PER_USER * 3],
        ["exactly funded", 0],
      ].forEach(([scenario, extraFundingToPass]) => {
        it(`does not recover funded usdc (${scenario})`, async () => {
          await setAllocationForUser1();
          await setAllocationForUser2();
          await addFundingFromUser1();
          await addFundingFromUser2();

          await fundUsdcFromWhale(BN(extraFundingToPass), [insuredVesting.options.address]);

          await setBalancesForDelta();
          await insuredVesting.methods.recover(usdc.options.address).send({ from: deployer });
          await expectProjectBalanceDelta("xctd", 0);
          await expectProjectBalanceDelta("usdc", await usdc.amount(extraFundingToPass));
        });
      });
    });

    describe("access control", () => {
      it("cannot add allocations if not owner", async () => {
        await expectRevert(async () => insuredVesting.methods.setAllocation(user1, 1).send({ from: anyUser }), "Ownable: caller is not the owner");
      });

      it("cannot recover if not owner", async () => {
        await expectRevert(async () => insuredVesting.methods.recover(xctd.options.address).send({ from: anyUser }), "Ownable: caller is not the owner");
      });

      it("cannot trigger emergency release if not owner", async () => {
        await expectRevert(async () => insuredVesting.methods.emergencyRelease().send({ from: anyUser }), "Ownable: caller is not the owner");
      });
    });

    describe("view functions", () => {
      it("returns 0 vested when not activated", async () => {
        await setAllocationForUser1(FUNDING_PER_USER);
        await addFundingFromUser1(FUNDING_PER_USER);
        expect(await insuredVesting.methods.usdcVestedFor(user1).call()).to.be.bignumber.eq(0);
      });

      it("returns correct vested amount - immediately after activation", async () => {
        await setAllocationForUser1(FUNDING_PER_USER);
        await addFundingFromUser1(FUNDING_PER_USER);
        await insuredVesting.methods.activate().send({ from: deployer });
        expect(await insuredVesting.methods.usdcVestedFor(user1).call()).to.be.bignumber.eq(0);
      });

      it("returns correct vested amount - 30 days", async () => {
        await setAllocationForUser1(FUNDING_PER_USER);
        await addFundingFromUser1(FUNDING_PER_USER);
        await insuredVesting.methods.activate().send({ from: deployer });
        await advanceDays(30);
        expect(await insuredVesting.methods.usdcVestedFor(user1).call()).to.be.bignumber.eq(await vestedAmount(30, "usdc"));
      });
    });
  });

  describe("activate", () => {
    it("fails if there isn't enough XCTD allowance to cover funded USDC", async () => {
      await setAllocationForUser1(FUNDING_PER_USER);
      await addFundingFromUser1(FUNDING_PER_USER);
      await expectRevert(async () => insuredVesting.methods.activate().send({ from: deployer }), "ERC20: insufficient allowance");
    });

    it("fails if there isn't enough XCTD balance to cover funded USDC", async () => {
      await setAllocationForUser1(FUNDING_PER_USER);
      await addFundingFromUser1(FUNDING_PER_USER);
      await approveXctdToVesting();
      // Get rid of all balance
      await xctd.methods.transfer(anyUser, await xctd.amount(1e9)).send({ from: project });
      await expectRevert(async () => insuredVesting.methods.activate().send({ from: deployer }), "ERC20: transfer amount exceeds balance");
    });

    it("transfers XCTD required to back USDC funding", async () => {
      await setAllocationForUser1(FUNDING_PER_USER);
      await addFundingFromUser1(FUNDING_PER_USER / 4);

      const requiredXctd = await xctd.amount((FUNDING_PER_USER / 4) * USDC_TO_XCTD_RATIO);

      await approveXctdToVesting();

      await insuredVesting.methods.activate().send({ from: deployer });

      const contractXctdBalance = await xctd.methods.balanceOf(insuredVesting.options.address).call();

      expect(contractXctdBalance).to.be.bignumber.eq(requiredXctd);
    });

    it("does not transfer XCTD if already funded sufficiently", async () => {
      await setAllocationForUser1(FUNDING_PER_USER);
      await addFundingFromUser1(FUNDING_PER_USER);

      await approveXctdToVesting();

      await xctd.methods.transfer(insuredVesting.options.address, await xctd.amount(FUNDING_PER_USER * 10)).send({ from: project });

      const initialContractXctdBalance = await xctd.methods.balanceOf(insuredVesting.options.address).call();
      await insuredVesting.methods.activate().send({ from: deployer });
      const contractXctdBalance = await xctd.methods.balanceOf(insuredVesting.options.address).call();

      expect(initialContractXctdBalance).to.be.bignumber.eq(contractXctdBalance);
    });

    it("transfers XCTD required to back USDC funding (partially pre-funded)", async () => {
      await setAllocationForUser1(FUNDING_PER_USER);
      await addFundingFromUser1(FUNDING_PER_USER);

      const requiredXctd = await xctd.amount(FUNDING_PER_USER * USDC_TO_XCTD_RATIO);

      await approveXctdToVesting();

      await xctd.methods.transfer(insuredVesting.options.address, await xctd.amount(FUNDING_PER_USER / 3)).send({ from: project });

      await insuredVesting.methods.activate().send({ from: deployer });

      const contractXctdBalance = await xctd.methods.balanceOf(insuredVesting.options.address).call();

      expect(contractXctdBalance).to.be.bignumber.eq(requiredXctd);
    });

    it("fails if already activated", async () => {
      await setAllocationForUser1(FUNDING_PER_USER);
      await addFundingFromUser1(FUNDING_PER_USER);
      await approveXctdToVesting();

      await insuredVesting.methods.activate().send({ from: deployer });

      await expectRevert(async () => insuredVesting.methods.activate().send({ from: deployer }), Error.VestingAlreadyStarted);
    });

    it("fails if not owner", async () => {
      await setAllocationForUser1(FUNDING_PER_USER);
      await addFundingFromUser1(FUNDING_PER_USER);

      await expectRevert(async () => insuredVesting.methods.activate().send({ from: anyUser }), "Ownable: caller is not the owner");
    });

    it("fails if not funded", async () => {
      await expectRevert(async () => insuredVesting.methods.activate().send({ from: deployer }), Error.NoFundsAdded);
    });

    it("activates", async () => {
      await setAllocationForUser1(FUNDING_PER_USER);
      await addFundingFromUser1(FUNDING_PER_USER);
      await approveXctdToVesting();

      await insuredVesting.methods.activate().send({ from: deployer });

      expect(await insuredVesting.methods.startTime().call()).to.be.bignumber.eq(await getCurrentTimestamp());
    });

    it("tranfers the correct amount of xctd after setting allocations with refunds", async () => {
      await setAllocationForUser1(FUNDING_PER_USER);
      await addFundingFromUser1(FUNDING_PER_USER);
      await setAllocationForUser2(FUNDING_PER_USER);
      await addFundingFromUser2(FUNDING_PER_USER);
      // Reduce allocation
      await setAllocationForUser2(FUNDING_PER_USER / 2);

      await approveXctdToVesting((FUNDING_PER_USER + FUNDING_PER_USER / 2) * USDC_TO_XCTD_RATIO);
      await insuredVesting.methods.activate().send({ from: deployer });
    });
  });

  describe("deployment", () => {
    describe("project address", () => {
      it("project address cannot be zero", async () => {
        // TODO TEMPORARY: until having production XCTD & project addresses
        const testConfig = [...config];
        testConfig[1] = xctd.options.address;
        testConfig[2] = zeroAddress;
        // END TEMPORARY
        await expectRevert(async () => deployArtifact<InsuredVestingV1>("InsuredVestingV1", { from: deployer }, testConfig), Error.ZeroAddress);
      });

      it("project address should be set correctly", async () => {
        expect(await insuredVesting.methods.project().call()).to.be.eq(project);
      });
    });
  });
});
