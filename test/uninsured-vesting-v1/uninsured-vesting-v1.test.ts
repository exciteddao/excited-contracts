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
  someOtherToken,
  user2,
  Error,
  VESTING_DURATION_SECONDS,
  approveProjectTokenToVesting,
  transferProjectTokenToVesting,
  setAmountForUser1,
  setAmountForUser2,
  setup,
  vestedAmount,
  getDefaultStartTime,
  activateAndReachStartTime,
  projectWallet,
  differentProjectWallet,
} from "./fixture";
import { web3, zeroAddress } from "@defi.org/web3-candies";
import { advanceDays, DAY, getCurrentTimestamp, MONTH } from "../utils";
import { VESTING_DURATION_DAYS } from "../insured-vesting-v1/fixture";
import { CALLER_NOT_OWNER_REVERT_MSG, OWNER_REVERT_MSG, PROJECT_ROLE_REVERT_MSG } from "../constants";

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
          await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
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
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
        await vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
        await advanceDays(1);
        expect(await vesting.methods.totalVestedFor(user1).call()).to.be.bignumber.zero;
        await advanceDays(3);
        expect(await vesting.methods.totalVestedFor(user1).call()).to.be.bignumber.to.be.bignumber.closeTo(
          (await projectToken.amount(TOKENS_PER_USER)).multipliedBy(1 * DAY).dividedBy(VESTING_DURATION_SECONDS),
          await projectToken.amount(0.01)
        );
      });

      it("starts vesting if activated with current time stamp", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
        await vesting.methods.activate(BN(await getCurrentTimestamp()).plus(1)).send({ from: projectWallet });
        await advanceDays(1);
        await vesting.methods.claim(user1).send({ from: user1 });

        expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
          (await projectToken.amount(TOKENS_PER_USER)).multipliedBy(1 * DAY).dividedBy(VESTING_DURATION_SECONDS),
          await projectToken.amount(0.01)
        );
      });

      it(`can claim tokens for the entire period`, async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
        await activateAndReachStartTime();
        await advanceDays(VESTING_DURATION_SECONDS);
        await vesting.methods.claim(user1).send({ from: user1 });

        expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
          await projectToken.amount(TOKENS_PER_USER),
          await projectToken.amount(0.01)
        );
      });

      it(`can claim tokens for the entire period, longer than vesting period has passed`, async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
        await activateAndReachStartTime();
        await advanceDays(VESTING_DURATION_SECONDS * 2);
        await vesting.methods.claim(user1).send({ from: user1 });

        expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
          await projectToken.amount(TOKENS_PER_USER),
          await projectToken.amount(0.01)
        );
      });

      it("cannot double-claim tokens for same period of time", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
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
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
        await expectRevert(() => vesting.methods.claim(user1).send({ from: user1 }), Error.VestingNotStarted);
      });

      it("cannot claim tokens before starting period - activated", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
        await vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
        await expectRevert(() => vesting.methods.claim(user1).send({ from: user1 }), Error.VestingNotStarted);
        await advanceDays(1);
        await expectRevert(() => vesting.methods.claim(user1).send({ from: user1 }), Error.VestingNotStarted);
      });

      it("cannot claim if there's no eligibility", async () => {
        await vesting.methods.setAmount(user2, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
        await activateAndReachStartTime();
        await advanceDays(1);
        await expectRevert(() => vesting.methods.claim(user1).send({ from: user1 }), Error.NothingToClaim);
      });

      it("project can claim on behalf of user", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
        await activateAndReachStartTime();
        await advanceDays(70);
        await vesting.methods.claim(user1).send({ from: projectWallet });

        expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
          (await projectToken.amount(TOKENS_PER_USER)).multipliedBy(70 * DAY).dividedBy(VESTING_DURATION_SECONDS),
          await projectToken.amount(0.01)
        );
      });

      it("cannot claim if not user or project", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
        await activateAndReachStartTime();
        await advanceDays(70);
        await expectRevert(() => vesting.methods.claim(user1).send({ from: anyUser }), Error.OnlyProjectOrSender);
      });
    });

    describe("transfer project role", () => {
      it("should only be transferable by project wallet", async () => {
        expect(await vesting.methods.projectWallet().call()).to.be.eq(projectWallet);
        await vesting.methods.transferProjectRole(differentProjectWallet).send({ from: projectWallet });
        expect(await vesting.methods.projectWallet().call()).to.be.eq(differentProjectWallet);
      });

      it("should not be updatable to zero address", async () => {
        await expectRevert(
          () => vesting.methods.transferProjectRole(zeroAddress).send({ from: projectWallet }),
          "ProjectRole: new project wallet is the zero address"
        );
      });

      it("project role permissions should be available to new project wallet address after role transfer", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
        await vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
        await vesting.methods.transferProjectRole(differentProjectWallet).send({ from: projectWallet });
        await advanceDays(10);
        await vesting.methods.claim(user1).send({ from: differentProjectWallet });
      });

      it("old wallet should not have project role permissions after ownership transfer", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
        await vesting.methods.transferProjectRole(differentProjectWallet).send({ from: projectWallet });

        await expectRevert(
          async () => await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet }),
          PROJECT_ROLE_REVERT_MSG
        );

        await expectRevert(async () => await vesting.methods.claim(user1).send({ from: projectWallet }), Error.OnlyProjectOrSender);
      });

      it("old wallet address should not be able to call transfer role again after initial transfer", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
        await vesting.methods.transferProjectRole(differentProjectWallet).send({ from: projectWallet });

        await expectRevert(async () => await vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet }), PROJECT_ROLE_REVERT_MSG);
      });
    });

    describe("recovery", () => {
      it("recovers ether", async () => {
        const startingBalance = await web3().eth.getBalance(projectWallet);
        expect(await web3().eth.getBalance(vesting.options.address)).to.bignumber.eq(0);
        await setBalance(vesting.options.address, BN(12345 * 1e18));
        await vesting.methods.recoverEther().send({ from: deployer });
        expect(await web3().eth.getBalance(vesting.options.address)).to.be.bignumber.zero;
        expect(await web3().eth.getBalance(projectWallet)).to.bignumber.closeTo(BN(12345 * 1e18).plus(startingBalance), BN(0.1e18));
      });

      it("does not recover ether if recovering token", async () => {
        expect(await web3().eth.getBalance(vesting.options.address)).to.bignumber.eq(0);
        await setBalance(vesting.options.address, BN(12345 * 1e18));
        await someOtherToken.methods.transfer(vesting.options.address, BN(12345 * 1e18)).send({ from: deployer });
        await vesting.methods.recoverToken(someOtherToken.options.address).send({ from: deployer });
        expect(await web3().eth.getBalance(vesting.options.address)).to.bignumber.closeTo(BN(12345 * 1e18), BN(0.1e18));
      });

      it("recovers other tokens", async () => {
        await someOtherToken.methods.transfer(vesting.options.address, BN(12345 * 1e18)).send({ from: deployer });
        await vesting.methods.recoverToken(someOtherToken.options.address).send({ from: deployer });
        expect(await someOtherToken.methods.balanceOf(vesting.options.address).call()).to.be.bignumber.zero;
        // TODO: assert balance of owner wallet / projectWallet
      });

      it("recovers excess projectToken, some allocations set", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
        await vesting.methods.setAmount(user2, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
        await vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer });
        // Recover all but the tokens allocated to users
        expect(await projectToken.methods.balanceOf(vesting.options.address).call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER * 2));
      });

      it("recovers excess projectToken, no allocations set", async () => {
        await vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer });
        expect(await projectToken.methods.balanceOf(vesting.options.address).call()).to.be.bignumber.eq(await projectToken.amount(0));
      });

      it("recovers excess projectToken, recovery called multiple times is idempotent", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER / 4)).send({ from: projectWallet });
        await vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer });
        expect(await projectToken.methods.balanceOf(vesting.options.address).call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER / 4));
        await vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer });
        await vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer });
        expect(await projectToken.methods.balanceOf(vesting.options.address).call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER / 4));
      });

      it("can still recover excess funds after some already claimed", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
        await activateAndReachStartTime();

        advanceDays(30);

        const currentUserBalance = BN(await projectToken.methods.balanceOf(user1).call());

        await vesting.methods.claim(user1).send({ from: user1 });

        expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
          currentUserBalance.plus(await vestedAmount(30)),
          await projectToken.amount(0.1)
        );

        await vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer });
        expect(await projectToken.methods.balanceOf(vesting.options.address).call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
      });

      it("handles zero token balance gracefully", async () => {
        const startingBalance = await someOtherToken.methods.balanceOf(vesting.options.address).call();
        expect(startingBalance).to.be.bignumber.zero;
        await vesting.methods.recoverToken(someOtherToken.options.address).send({ from: deployer });
        expect(await someOtherToken.methods.balanceOf(vesting.options.address).call()).to.be.bignumber.zero;
      });
    });

    describe("access control", () => {
      describe("only project", () => {
        it("can activate", async () => {
          const expectedInvalidUsers = [user1, deployer, anyUser];

          for (const invalidUser of expectedInvalidUsers) {
            await expectRevert(async () => vesting.methods.activate(await getDefaultStartTime()).send({ from: invalidUser }), PROJECT_ROLE_REVERT_MSG);
          }

          await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
          await vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
          // should not revert
        });

        it("can set amounts", async () => {
          const expectedInvalidUsers = [anyUser, user2, deployer];

          for (const invalidUser of expectedInvalidUsers) {
            await expectRevert(async () => vesting.methods.setAmount(user1, 1).send({ from: invalidUser }), PROJECT_ROLE_REVERT_MSG);
          }

          await vesting.methods.setAmount(user1, 1).send({ from: projectWallet });
          // should not revert
        });

        it("can emergency claim", async () => {
          await setAmountForUser1();
          await approveProjectTokenToVesting();
          await activateAndReachStartTime();
          await vesting.methods.emergencyRelease().send({ from: deployer });
          await expectRevert(async () => vesting.methods.emergencyClaim(user1).send({ from: anyUser }), Error.OnlyProjectOrSender);

          await vesting.methods.emergencyClaim(user1).send({ from: projectWallet });
        });
      });

      describe("only owner", () => {
        it("can recover ether", async () => {
          const expectedInvalidUsers = [projectWallet, anyUser, user2];

          for (const invalidUser of expectedInvalidUsers) {
            await expectRevert(async () => await vesting.methods.recoverEther().send({ from: invalidUser }), OWNER_REVERT_MSG);
          }

          await vesting.methods.recoverEther().send({ from: deployer });
        });

        it("can recover token", async () => {
          const expectedInvalidUsers = [projectWallet, anyUser, user2];

          for (const invalidUser of expectedInvalidUsers) {
            await expectRevert(async () => await vesting.methods.recoverToken(projectToken.options.address).send({ from: invalidUser }), OWNER_REVERT_MSG);
          }

          await vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer });
        });

        it("can emergency release", async () => {
          await setAmountForUser1();
          await approveProjectTokenToVesting();
          await vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
          expect(await vesting.methods.emergencyReleased().call()).to.be.false;

          await expectRevert(async () => vesting.methods.emergencyRelease().send({ from: anyUser }), OWNER_REVERT_MSG);

          await vesting.methods.emergencyRelease().send({ from: deployer });
          expect(await vesting.methods.emergencyReleased().call()).to.be.true;
        });
      });
    });

    describe("set amount", () => {
      it("cannot set amount after activation", async () => {
        await setAmountForUser1();
        await vesting.methods.activate(await getCurrentTimestamp()).send({ from: projectWallet });
        await expectRevert(async () => await setAmountForUser2(), Error.AlreadyActivated);
      });

      describe("per user and global amounts are accurate", () => {
        it("no users", async () => {
          expect(await vesting.methods.totalAllocated().call()).to.be.bignumber.zero;
        });

        it("single user", async () => {
          await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
          expect((await vesting.methods.userVestings(user1).call()).amount).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
          expect(await vesting.methods.totalAllocated().call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
        });

        it("single user, amount updated to same amount as previously", async () => {
          await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
          await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
          expect((await vesting.methods.userVestings(user1).call()).amount).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
          expect(await vesting.methods.totalAllocated().call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
        });

        it("multiple users", async () => {
          await vesting.methods.setAmount(user1, await projectToken.amount(3_500)).send({ from: projectWallet });
          await vesting.methods.setAmount(user2, await projectToken.amount(1_000)).send({ from: projectWallet });
          expect((await vesting.methods.userVestings(user1).call()).amount).to.be.bignumber.eq(await projectToken.amount(3_500));
          expect((await vesting.methods.userVestings(user2).call()).amount).to.be.bignumber.eq(await projectToken.amount(1_000));
          expect(await vesting.methods.totalAllocated().call()).to.be.bignumber.eq(
            await (await projectToken.amount(3_500)).plus(await projectToken.amount(1_000))
          );
        });

        it("multiple users, amount reduced", async () => {
          await vesting.methods.setAmount(user1, await projectToken.amount(10_000)).send({ from: projectWallet });
          await vesting.methods.setAmount(user2, await projectToken.amount(10_000)).send({ from: projectWallet });
          await vesting.methods.setAmount(user1, await projectToken.amount(3_000)).send({ from: projectWallet });
          expect((await vesting.methods.userVestings(user1).call()).amount).to.be.bignumber.eq(await projectToken.amount(3_000));
          expect((await vesting.methods.userVestings(user2).call()).amount).to.be.bignumber.eq(await projectToken.amount(10_000));
          expect(await vesting.methods.totalAllocated().call()).to.be.bignumber.eq(await await projectToken.amount(13_000));
        });

        it("multiple users, amount reduced to zero", async () => {
          await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
          await vesting.methods.setAmount(user2, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
          await vesting.methods.setAmount(user2, await projectToken.amount(0)).send({ from: projectWallet });
          expect((await vesting.methods.userVestings(user1).call()).amount).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
          expect((await vesting.methods.userVestings(user2).call()).amount).to.be.bignumber.eq(await projectToken.amount(0));
          expect(await vesting.methods.totalAllocated().call()).to.be.bignumber.eq(await await projectToken.amount(TOKENS_PER_USER));
        });
      });
    });
  });

  describe("activate", () => {
    it("fails if start time is in the past", async () => {
      const timeInPast = BN(await getCurrentTimestamp()).minus(1);
      await expectRevert(async () => vesting.methods.activate(timeInPast).send({ from: projectWallet }), Error.StartTimeIsInPast);
    });

    it("fails if start time is too far in to the future", async () => {
      const timeInDistantFuture = BN(await getCurrentTimestamp())
        .plus(MONTH * 3)
        .plus(DAY);
      await expectRevert(async () => vesting.methods.activate(timeInDistantFuture).send({ from: projectWallet }), Error.StartTimeTooLate);
    });

    it("fails if there isn't enough PROJECT_TOKEN allowance to cover total allocated", async () => {
      await setAmountForUser1();
      await expectRevert(async () => vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet }), "ERC20: insufficient allowance");
    });

    it("fails if there isn't enough PROJECT_TOKEN balance to cover total allocated", async () => {
      await setAmountForUser1();
      await approveProjectTokenToVesting();
      // Get rid of all balance
      await projectToken.methods.transfer(anyUser, await projectToken.amount(1e9)).send({ from: projectWallet });
      await expectRevert(
        async () => vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet }),
        "ERC20: transfer amount exceeds balance"
      );
    });

    it("transfers PROJECT_TOKEN proportional to total allocated", async () => {
      await setAmountForUser1();
      await approveProjectTokenToVesting();
      await vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
      expect(await projectToken.methods.balanceOf(vesting.options.address).call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
    });

    it("does not transfer PROJECT_TOKEN if already funded sufficiently", async () => {
      await setAmountForUser1();
      await approveProjectTokenToVesting();
      await projectToken.methods.transfer(vesting.options.address, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
      const initialContractProjectTokenBalance = await projectToken.methods.balanceOf(vesting.options.address).call();
      await vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
      const currentContractBalance = await projectToken.methods.balanceOf(vesting.options.address).call();
      expect(initialContractProjectTokenBalance).to.be.bignumber.eq(currentContractBalance);
    });

    it("transfers PROJECT_TOKEN required to back FUNDING_TOKEN funding (partially pre-funded)", async () => {
      await setAmountForUser1();
      await approveProjectTokenToVesting();
      await projectToken.methods.transfer(vesting.options.address, await projectToken.amount(TOKENS_PER_USER / 4)).send({ from: projectWallet });
      await vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
      const contractProjectTokenBalance = await projectToken.methods.balanceOf(vesting.options.address).call();
      expect(contractProjectTokenBalance).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
    });

    it("fails if already activated", async () => {
      await setAmountForUser1();
      await approveProjectTokenToVesting();
      await vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
      await expectRevert(async () => vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet }), Error.AlreadyActivated);
    });

    it("fails if no allocations added", async () => {
      await expectRevert(async () => vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet }), Error.NoAllocationsAdded);
    });

    it("sets start time", async () => {
      await setAmountForUser1();
      await approveProjectTokenToVesting();
      const startTimeToSet = await getDefaultStartTime();
      await vesting.methods.activate(startTimeToSet).send({ from: projectWallet });
      expect(await vesting.methods.vestingStartTime().call()).to.be.bignumber.eq(startTimeToSet);
    });
  });

  describe("emergency release", () => {
    it("cannot emergency release if not activated", async () => {
      await expectRevert(async () => vesting.methods.emergencyRelease().send({ from: deployer }), Error.NotActivated);
    });

    it("cannot emergency release twice", async () => {
      await setAmountForUser1();
      await approveProjectTokenToVesting();
      await activateAndReachStartTime();
      await vesting.methods.emergencyRelease().send({ from: deployer });
      await expectRevert(async () => vesting.methods.emergencyRelease().send({ from: deployer }), Error.EmergencyReleased);
    });

    [
      ["user", false],
      ["project", true],
    ].forEach(([who, isProject]) => {
      describe(`emergency claim by ${who}`, () => {
        it("lets user claim after emergency release (full amount)", async () => {
          await setAmountForUser1();
          await approveProjectTokenToVesting();
          await activateAndReachStartTime();
          await vesting.methods.emergencyRelease().send({ from: deployer });
          await vesting.methods.emergencyClaim(user1).send({ from: isProject ? projectWallet : user1 });
          expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
        });

        it("lets user claim after emergency release (some already claimed before)", async () => {
          await setAmountForUser1();
          await approveProjectTokenToVesting();
          await activateAndReachStartTime();
          await advanceDays(VESTING_DURATION_DAYS / 4);
          await vesting.methods.claim(user1).send({ from: user1 });
          expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
            (await projectToken.amount(TOKENS_PER_USER)).dividedBy(4),
            await projectToken.amount(0.1)
          );
          await vesting.methods.emergencyRelease().send({ from: deployer });
          await vesting.methods.emergencyClaim(user1).send({ from: isProject ? projectWallet : user1 });
          expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
        });

        it("lets multiple users claim after emergency release (some already claimed before)", async () => {
          await setAmountForUser1();
          await setAmountForUser2();
          await approveProjectTokenToVesting();
          await activateAndReachStartTime();
          await advanceDays(VESTING_DURATION_DAYS / 4);
          await vesting.methods.claim(user1).send({ from: user1 });
          expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
            (await projectToken.amount(TOKENS_PER_USER)).dividedBy(4),
            await projectToken.amount(0.1)
          );
          await vesting.methods.emergencyRelease().send({ from: deployer });
          await vesting.methods.emergencyClaim(user1).send({ from: isProject ? projectWallet : user1 });
          expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
          await vesting.methods.emergencyClaim(user2).send({ from: isProject ? projectWallet : user2 });
          expect(await projectToken.methods.balanceOf(user2).call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
        });

        it("cannot emergency claim if no allocation", async () => {
          await setAmountForUser1();
          await approveProjectTokenToVesting();
          await activateAndReachStartTime();
          await vesting.methods.emergencyRelease().send({ from: deployer });
          await expectRevert(async () => vesting.methods.emergencyClaim(user2).send({ from: isProject ? projectWallet : user2 }), Error.NothingToClaim);
        });

        it("can emergegency claim if activated, not reached start time yet", async () => {
          await setAmountForUser1();
          await approveProjectTokenToVesting();
          await vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
          await vesting.methods.emergencyRelease().send({ from: deployer });
          await vesting.methods.emergencyClaim(user1).send({ from: isProject ? projectWallet : user1 });
          expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
        });
        it("emergency claim twice does not cause double spend", async () => {
          await setAmountForUser1();
          await setAmountForUser2();
          await approveProjectTokenToVesting();
          await vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
          await vesting.methods.emergencyRelease().send({ from: deployer });
          await vesting.methods.emergencyClaim(user1).send({ from: isProject ? projectWallet : user1 });
          expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
          await vesting.methods.emergencyClaim(user1).send({ from: isProject ? projectWallet : user1 });
          expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
        });
        it("cannot emergency claim if not released", async () => {
          await setAmountForUser1();
          await approveProjectTokenToVesting();
          await activateAndReachStartTime();
          await expectRevert(async () => vesting.methods.emergencyClaim(user1).send({ from: isProject ? projectWallet : user1 }), Error.EmergencyNotReleased);
        });
        it("cannot regularly claim if emergency released", async () => {
          await setAmountForUser1();
          await approveProjectTokenToVesting();
          await activateAndReachStartTime();
          await vesting.methods.emergencyRelease().send({ from: deployer });
          await expectRevert(async () => vesting.methods.claim(user1).send({ from: isProject ? projectWallet : user1 }), Error.EmergencyReleased);
        });
      });
    });

    describe("Renounce ownership", () => {
      it("emergencyRelease, recoverEther, recoverToken should not be callable after renouncing ownership", async () => {
        await vesting.methods.renounceOwnership().send({ from: deployer });
        await expectRevert(async () => await vesting.methods.emergencyRelease().send({ from: deployer }), CALLER_NOT_OWNER_REVERT_MSG);
        await expectRevert(async () => await vesting.methods.recoverEther().send({ from: deployer }), CALLER_NOT_OWNER_REVERT_MSG);
        await expectRevert(async () => await vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer }), CALLER_NOT_OWNER_REVERT_MSG);
      });
    });
  });

  describe("view functions", () => {
    it("returns 0 vested when not activated", async () => {
      await setAmountForUser1();
      expect(await vesting.methods.totalVestedFor(user1).call()).to.be.bignumber.eq(0);
    });
  });
});
