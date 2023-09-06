import { expect } from "chai";
import BN from "bignumber.js";
import { expectRevert, setBalance } from "@defi.org/web3-candies/dist/hardhat";
import {
  anyUser,
  user1,
  vesting,
  withFixture,
  projectToken,
  TOKENS_PER_USER,
  deployer,
  getCurrentTimestamp,
  someOtherToken,
  user2,
  Error,
  advanceDays,
  DAY,
  VESTING_DURATION_SECONDS,
  approveProjectTokenToVesting,
  transferProjectTokenToVesting,
  setAmountForUser1,
  setAmountForUser2,
  setup,
  vestedAmount,
  MONTH,
  getDefaultStartTime,
  activateAndReachStartTime,
} from "./fixture";
import { web3 } from "@defi.org/web3-candies";

describe("VestingV1", () => {
  before(async () => await setup());

  beforeEach(async () => withFixture());

  describe("with projectToken approved to contract", () => {
    beforeEach(async () => {
      transferProjectTokenToVesting();
    });

    describe("claim", () => {
      const testCases = [0, 1, 5, 10, 100, 200, 534];

      for (const days of testCases) {
        it(`can claim tokens proportional to amount of seconds in ${days} days passed`, async () => {
          await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: deployer });
          await activateAndReachStartTime();
          await advanceDays(days);
          await vesting.methods.claim(user1).send({ from: user1 });

          expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
            (await projectToken.amount(TOKENS_PER_USER)).multipliedBy(days * DAY).dividedBy(VESTING_DURATION_SECONDS),
            await projectToken.amount(0.01)
          );
        });
      }

      it("does not vest before start time", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: deployer });
        await vesting.methods.activate(await getDefaultStartTime()).send({ from: deployer });
        await advanceDays(1);
        expect(await vesting.methods.totalVestedFor(user1).call()).to.be.bignumber.zero;
        await advanceDays(3);
        expect(await vesting.methods.totalVestedFor(user1).call()).to.be.bignumber.to.be.bignumber.closeTo(
          (await projectToken.amount(TOKENS_PER_USER)).multipliedBy(1 * DAY).dividedBy(VESTING_DURATION_SECONDS),
          await projectToken.amount(0.01)
        );
      });

      it("vests if set to current time stamp", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: deployer });
        await vesting.methods.activate(BN(await getCurrentTimestamp()).plus(1)).send({ from: deployer });
        await advanceDays(1);
        await vesting.methods.claim(user1).send({ from: user1 });

        expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
          (await projectToken.amount(TOKENS_PER_USER)).multipliedBy(1 * DAY).dividedBy(VESTING_DURATION_SECONDS),
          await projectToken.amount(0.01)
        );
      });

      it(`can claim tokens for the entire period`, async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: deployer });
        await activateAndReachStartTime();
        await advanceDays(VESTING_DURATION_SECONDS);
        await vesting.methods.claim(user1).send({ from: user1 });

        expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
          await projectToken.amount(TOKENS_PER_USER),
          await projectToken.amount(0.01)
        );
      });

      it(`can claim tokens for the entire period, longer than vesting period has passed`, async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: deployer });
        await activateAndReachStartTime();
        await advanceDays(VESTING_DURATION_SECONDS * 2);
        await vesting.methods.claim(user1).send({ from: user1 });

        expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
          await projectToken.amount(TOKENS_PER_USER),
          await projectToken.amount(0.01)
        );
      });

      it("cannot double-claim tokens for same period of time", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: deployer });
        await activateAndReachStartTime();
        const daysToAdvance = 66;
        await advanceDays(daysToAdvance);

        await vesting.methods.claim(user1).send({ from: user1 });
        const balanceAfterFirstClaim = await projectToken.methods.balanceOf(user1).call();
        expect(balanceAfterFirstClaim).to.be.bignumber.closeTo(
          (await projectToken.amount(TOKENS_PER_USER)).multipliedBy(daysToAdvance * DAY).dividedBy(VESTING_DURATION_SECONDS),
          await projectToken.amount(0.01)
        );

        await vesting.methods.claim(user1).send({ from: user1 });
        expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(balanceAfterFirstClaim, await projectToken.amount(0.01));
      });

      it("cannot claim tokens before starting period - not activated", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: deployer });
        await expectRevert(() => vesting.methods.claim(user1).send({ from: user1 }), Error.VestingNotStarted);
      });

      it("cannot claim tokens before starting period - activated", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: deployer });
        await vesting.methods.activate(await getDefaultStartTime()).send({ from: deployer });
        await expectRevert(() => vesting.methods.claim(user1).send({ from: user1 }), Error.VestingNotStarted);
        await advanceDays(1);
        await expectRevert(() => vesting.methods.claim(user1).send({ from: user1 }), Error.VestingNotStarted);
      });

      it("cannot claim if there's no eligibility", async () => {
        await vesting.methods.setAmount(user2, await projectToken.amount(TOKENS_PER_USER)).send({ from: deployer });
        await activateAndReachStartTime();
        await advanceDays(1);
        await expectRevert(() => vesting.methods.claim(user1).send({ from: user1 }), Error.NothingToClaim);
      });

      it("owner can claim on behalf of user", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: deployer });
        await activateAndReachStartTime();
        await advanceDays(70);
        await vesting.methods.claim(user1).send({ from: deployer });

        expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
          (await projectToken.amount(TOKENS_PER_USER)).multipliedBy(70 * DAY).dividedBy(VESTING_DURATION_SECONDS),
          await projectToken.amount(0.01)
        );
      });

      it("cannot claim if not user or project", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: deployer });
        await activateAndReachStartTime();
        await advanceDays(70);
        await expectRevert(() => vesting.methods.claim(user1).send({ from: anyUser }), Error.OnlyOwnerOrSender);
      });
    });

    describe("recovery", () => {
      it("recovers ether", async () => {
        const startingBalance = await web3().eth.getBalance(deployer);
        expect(await web3().eth.getBalance(vesting.options.address)).to.bignumber.eq(0);
        await setBalance(vesting.options.address, BN(12345 * 1e18));
        await vesting.methods.recover(projectToken.options.address).send({ from: deployer });
        expect(await web3().eth.getBalance(vesting.options.address)).to.be.bignumber.zero;
        expect(await web3().eth.getBalance(deployer)).to.bignumber.closeTo(BN(12345 * 1e18).plus(startingBalance), BN(0.1e18));
      });

      it("recovers other tokens", async () => {
        await someOtherToken.methods.transfer(vesting.options.address, BN(12345 * 1e18)).send({ from: deployer });
        await vesting.methods.recover(someOtherToken.options.address).send({ from: deployer });
        expect(await someOtherToken.methods.balanceOf(vesting.options.address).call()).to.be.bignumber.zero;
      });

      it("recovers excess projectToken, some allocations set", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: deployer });
        await vesting.methods.setAmount(user2, await projectToken.amount(TOKENS_PER_USER)).send({ from: deployer });
        await vesting.methods.recover(projectToken.options.address).send({ from: deployer });
        // Recover all but the tokens allocated to users
        expect(await projectToken.methods.balanceOf(vesting.options.address).call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER * 2));
      });

      it("recovers excess projectToken, no allocations set", async () => {
        await vesting.methods.recover(projectToken.options.address).send({ from: deployer });
        expect(await projectToken.methods.balanceOf(vesting.options.address).call()).to.be.bignumber.eq(await projectToken.amount(0));
      });

      it("recovers excess projectToken, recovery called multiple times is idempotent", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER / 4)).send({ from: deployer });
        await vesting.methods.recover(projectToken.options.address).send({ from: deployer });
        expect(await projectToken.methods.balanceOf(vesting.options.address).call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER / 4));
        await vesting.methods.recover(projectToken.options.address).send({ from: deployer });
        await vesting.methods.recover(projectToken.options.address).send({ from: deployer });
        expect(await projectToken.methods.balanceOf(vesting.options.address).call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER / 4));
      });

      it("can still recover excess funds after some already claimed", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: deployer });
        await activateAndReachStartTime();

        advanceDays(30);

        const currentUserBalance = BN(await projectToken.methods.balanceOf(user1).call());

        await vesting.methods.claim(user1).send({ from: user1 });

        expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
          currentUserBalance.plus(await vestedAmount(30)),
          await projectToken.amount(0.1)
        );

        await vesting.methods.recover(projectToken.options.address).send({ from: deployer });
        expect(await projectToken.methods.balanceOf(vesting.options.address).call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
      });

      it("handles zero token balance gracefully", async () => {
        const startingBalance = await someOtherToken.methods.balanceOf(vesting.options.address).call();
        expect(startingBalance).to.be.bignumber.zero;
        await vesting.methods.recover(someOtherToken.options.address).send({ from: deployer });
        expect(await someOtherToken.methods.balanceOf(vesting.options.address).call()).to.be.bignumber.zero;
      });
    });

    describe("access control", () => {
      it("cannot call activate if not owner", async () => {
        await expectRevert(async () => vesting.methods.activate(await getDefaultStartTime()).send({ from: anyUser }), "Ownable: caller is not the owner");
      });

      it("cannot set amounts if not owner", async () => {
        await expectRevert(async () => vesting.methods.setAmount(user1, 1).send({ from: anyUser }), "Ownable: caller is not the owner");
      });

      it("cannot recover if not owner", async () => {
        await expectRevert(async () => vesting.methods.recover(projectToken.options.address).send({ from: anyUser }), "Ownable: caller is not the owner");
      });
    });

    describe("admin", () => {
      describe("set amount", () => {
        it("cannot set amount after activation", async () => {
          await setAmountForUser1();
          await vesting.methods.activate(await getDefaultStartTime()).send({ from: deployer });
          await expectRevert(async () => await setAmountForUser2(), Error.AlreadyActivated);
        });

        describe("per user and global amounts are accurate", () => {
          it("no users", async () => {
            expect(await vesting.methods.totalAllocated().call()).to.be.bignumber.zero;
          });

          it("single user", async () => {
            await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: deployer });
            expect((await vesting.methods.userVestings(user1).call()).amount).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
            expect(await vesting.methods.totalAllocated().call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
          });

          it("single user, amount updated to same amount as previously", async () => {
            await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: deployer });
            await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: deployer });
            expect((await vesting.methods.userVestings(user1).call()).amount).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
            expect(await vesting.methods.totalAllocated().call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
          });

          it("multiple users", async () => {
            await vesting.methods.setAmount(user1, await projectToken.amount(3_500)).send({ from: deployer });
            await vesting.methods.setAmount(user2, await projectToken.amount(1_000)).send({ from: deployer });
            expect((await vesting.methods.userVestings(user1).call()).amount).to.be.bignumber.eq(await projectToken.amount(3_500));
            expect((await vesting.methods.userVestings(user2).call()).amount).to.be.bignumber.eq(await projectToken.amount(1_000));
            expect(await vesting.methods.totalAllocated().call()).to.be.bignumber.eq(
              await (await projectToken.amount(3_500)).plus(await projectToken.amount(1_000))
            );
          });

          it("multiple users, amount reduced", async () => {
            await vesting.methods.setAmount(user1, await projectToken.amount(10_000)).send({ from: deployer });
            await vesting.methods.setAmount(user2, await projectToken.amount(10_000)).send({ from: deployer });
            await vesting.methods.setAmount(user1, await projectToken.amount(3_000)).send({ from: deployer });
            expect((await vesting.methods.userVestings(user1).call()).amount).to.be.bignumber.eq(await projectToken.amount(3_000));
            expect((await vesting.methods.userVestings(user2).call()).amount).to.be.bignumber.eq(await projectToken.amount(10_000));
            expect(await vesting.methods.totalAllocated().call()).to.be.bignumber.eq(await await projectToken.amount(13_000));
          });

          it("multiple users, amount reduced to zero", async () => {
            await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: deployer });
            await vesting.methods.setAmount(user2, await projectToken.amount(TOKENS_PER_USER)).send({ from: deployer });
            await vesting.methods.setAmount(user2, await projectToken.amount(0)).send({ from: deployer });
            expect((await vesting.methods.userVestings(user1).call()).amount).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
            expect((await vesting.methods.userVestings(user2).call()).amount).to.be.bignumber.eq(await projectToken.amount(0));
            expect(await vesting.methods.totalAllocated().call()).to.be.bignumber.eq(await await projectToken.amount(TOKENS_PER_USER));
          });
        });
      });
    });
  });

  describe("activate", () => {
    it("fails if start time is in the past", async () => {
      const timeInPast = BN(await getCurrentTimestamp()).minus(1);
      await expectRevert(async () => vesting.methods.activate(timeInPast).send({ from: deployer }), Error.StartTimeIsInPast);
    });

    it("fails if start time is too far in to the future", async () => {
      const timeInDistantFuture = BN(await getCurrentTimestamp())
        .plus(MONTH * 3)
        .plus(DAY);
      await expectRevert(async () => vesting.methods.activate(timeInDistantFuture).send({ from: deployer }), Error.StartTimeTooLate);
    });

    it("fails if there isn't enough PROJECT_TOKEN allowance to cover total allocated", async () => {
      await setAmountForUser1();
      await expectRevert(async () => vesting.methods.activate(await getDefaultStartTime()).send({ from: deployer }), "ERC20: insufficient allowance");
    });

    it("fails if there isn't enough PROJECT_TOKEN balance to cover total allocated", async () => {
      await setAmountForUser1();
      await approveProjectTokenToVesting();
      // Get rid of all balance
      await projectToken.methods.transfer(anyUser, await projectToken.amount(1e9)).send({ from: deployer });
      await expectRevert(async () => vesting.methods.activate(await getDefaultStartTime()).send({ from: deployer }), "ERC20: transfer amount exceeds balance");
    });

    it("transfers PROJECT_TOKEN proportional to total allocated", async () => {
      await setAmountForUser1();
      await approveProjectTokenToVesting();
      await vesting.methods.activate(await getDefaultStartTime()).send({ from: deployer });
      expect(await projectToken.methods.balanceOf(vesting.options.address).call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
    });

    it("does not transfer PROJECT_TOKEN if already funded sufficiently", async () => {
      await setAmountForUser1();
      await approveProjectTokenToVesting();
      await projectToken.methods.transfer(vesting.options.address, await projectToken.amount(TOKENS_PER_USER)).send({ from: deployer });
      const initialContractProjectTokenBalance = await projectToken.methods.balanceOf(vesting.options.address).call();
      await vesting.methods.activate(await getDefaultStartTime()).send({ from: deployer });
      const currentContractBalance = await projectToken.methods.balanceOf(vesting.options.address).call();
      expect(initialContractProjectTokenBalance).to.be.bignumber.eq(currentContractBalance);
    });

    it("transfers PROJECT_TOKEN required to back FUNDING_TOKEN funding (partially pre-funded)", async () => {
      await setAmountForUser1();
      await approveProjectTokenToVesting();
      await projectToken.methods.transfer(vesting.options.address, await projectToken.amount(TOKENS_PER_USER / 4)).send({ from: deployer });
      await vesting.methods.activate(await getDefaultStartTime()).send({ from: deployer });
      const contractProjectTokenBalance = await projectToken.methods.balanceOf(vesting.options.address).call();
      expect(contractProjectTokenBalance).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
    });

    it("fails if already activated", async () => {
      await setAmountForUser1();
      await approveProjectTokenToVesting();
      await vesting.methods.activate(await getDefaultStartTime()).send({ from: deployer });
      await expectRevert(async () => vesting.methods.activate(await getDefaultStartTime()).send({ from: deployer }), Error.AlreadyActivated);
    });

    it("fails if no allocations added", async () => {
      await expectRevert(async () => vesting.methods.activate(await getDefaultStartTime()).send({ from: deployer }), Error.NoAllocationsAdded);
    });

    it("sets start time", async () => {
      await setAmountForUser1();
      await approveProjectTokenToVesting();
      const startTimeToSet = await getDefaultStartTime();
      await vesting.methods.activate(startTimeToSet).send({ from: deployer });
      expect(await vesting.methods.vestingStartTime().call()).to.be.bignumber.eq(startTimeToSet);
    });
  });

  describe("view functions", () => {
    it("returns 0 vested when not activated", async () => {
      await setAmountForUser1();
      expect(await vesting.methods.totalVestedFor(user1).call()).to.be.bignumber.eq(0);
    });
  });
});
