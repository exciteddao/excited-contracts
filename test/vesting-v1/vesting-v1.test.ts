import { expect } from "chai";
import BN from "bignumber.js";
import { deployArtifact, expectRevert, setBalance } from "@defi.org/web3-candies/dist/hardhat";
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
  setAmountForUser1,
  setAmountForUser2,
  setup,
  getDefaultStartTime,
  activateAndReachStartTime,
  projectWallet,
  differentProjectWallet,
  TOTAL_SUPPLY,
} from "./fixture";
import { web3, zeroAddress } from "@defi.org/web3-candies";
import { advanceDays, DAY_SECONDS, getCurrentTimestamp, MONTH_SECONDS } from "../utils";
import { VESTING_DURATION_DAYS } from "../insured-vesting-v1/fixture";
import { CALLER_NOT_OWNER_REVERT_MSG, CALLER_NOT_PROJECT_ROLE_MSG, ERC_20_EXCEEDS_ALLOWANCE, ERC_20_EXCEEDS_BALANCE } from "../constants";
import { config } from "../../deployment/vesting-v1";
import { VestingV1 } from "../../typechain-hardhat/contracts/vesting-v1";

describe("VestingV1", () => {
  before(async () => await setup());

  beforeEach(async () => withFixture());

  describe("claim", () => {
    const testCases = [0, 1, 5, 10, 100, 200, 534];

    for (const days of testCases) {
      it(`can claim tokens proportional to amount of seconds in ${days} days passed`, async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
        await approveProjectTokenToVesting(TOKENS_PER_USER);
        await activateAndReachStartTime();
        await advanceDays(days);
        await vesting.methods.claim(user1).send({ from: user1 });

        expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
          (await projectToken.amount(TOKENS_PER_USER)).multipliedBy(days * DAY_SECONDS).dividedBy(VESTING_DURATION_SECONDS),
          await projectToken.amount(0.01)
        );
      });
    }

    it("does not vest before start time", async () => {
      await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
      await approveProjectTokenToVesting(TOKENS_PER_USER);
      await vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
      await advanceDays(1);
      expect(await vesting.methods.totalVestedFor(user1).call()).to.be.bignumber.zero;
      await advanceDays(3);
      expect(await vesting.methods.totalVestedFor(user1).call()).to.be.bignumber.to.be.bignumber.closeTo(
        (await projectToken.amount(TOKENS_PER_USER)).multipliedBy(1 * DAY_SECONDS).dividedBy(VESTING_DURATION_SECONDS),
        await projectToken.amount(0.01)
      );
    });

    it("starts vesting if activated with current time stamp", async () => {
      await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
      await approveProjectTokenToVesting(TOKENS_PER_USER);
      await vesting.methods.activate(BN(await getCurrentTimestamp()).plus(1)).send({ from: projectWallet });
      await advanceDays(1);
      await vesting.methods.claim(user1).send({ from: user1 });

      expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
        (await projectToken.amount(TOKENS_PER_USER)).multipliedBy(1 * DAY_SECONDS).dividedBy(VESTING_DURATION_SECONDS),
        await projectToken.amount(0.01)
      );
    });

    it(`can claim tokens for the entire period`, async () => {
      await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
      await approveProjectTokenToVesting(TOKENS_PER_USER);
      await activateAndReachStartTime();
      await advanceDays(VESTING_DURATION_SECONDS);
      await vesting.methods.claim(user1).send({ from: user1 });

      expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
        await projectToken.amount(TOKENS_PER_USER),
        await projectToken.amount(0.01)
      );
    });

    [
      ["reduced", TOKENS_PER_USER / 4],
      ["increased", TOKENS_PER_USER * 3],
    ].forEach(([description, amount]) => {
      it(`can claim tokens for the entire period, amount ${description}`, async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
        await approveProjectTokenToVesting(TOKENS_PER_USER * 10);
        await vesting.methods.setAmount(user1, await projectToken.amount(amount)).send({ from: projectWallet });
        await activateAndReachStartTime();
        await advanceDays(VESTING_DURATION_SECONDS);
        await vesting.methods.claim(user1).send({ from: user1 });

        expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(await projectToken.amount(amount), await projectToken.amount(0.01));
      });
    });

    it(`can claim tokens for the entire period, longer than vesting period has passed`, async () => {
      await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
      await approveProjectTokenToVesting(TOKENS_PER_USER);
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
      await approveProjectTokenToVesting(TOKENS_PER_USER);
      await activateAndReachStartTime();
      const daysToAdvance = 66;
      await advanceDays(daysToAdvance);

      await vesting.methods.claim(user1).send({ from: user1 });
      const balanceAfterFirstClaim = await projectToken.methods.balanceOf(user1).call();
      expect(balanceAfterFirstClaim).to.be.bignumber.closeTo(
        (await projectToken.amount(TOKENS_PER_USER)).multipliedBy(daysToAdvance * DAY_SECONDS).dividedBy(VESTING_DURATION_SECONDS),
        await projectToken.amount(0.01)
      );

      await vesting.methods.claim(user1).send({ from: user1 });
      expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(balanceAfterFirstClaim, await projectToken.amount(0.01));

      await advanceDays(VESTING_DURATION_DAYS - daysToAdvance);
      await vesting.methods.claim(user1).send({ from: user1 });
      expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
      await expectRevert(() => vesting.methods.claim(user1).send({ from: user1 }), Error.NothingToClaim);
      await advanceDays(100);
      await expectRevert(() => vesting.methods.claim(user1).send({ from: user1 }), Error.NothingToClaim);
    });

    it("cannot claim tokens before starting period - not activated", async () => {
      await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
      await expectRevert(() => vesting.methods.claim(user1).send({ from: user1 }), Error.VestingNotStarted);
    });

    it("cannot claim tokens before starting period - activated", async () => {
      await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
      await approveProjectTokenToVesting(TOKENS_PER_USER);
      const startTime = BN(await getCurrentTimestamp()).plus(MONTH_SECONDS);
      await vesting.methods.activate(startTime).send({ from: projectWallet });
      await expectRevert(() => vesting.methods.claim(user1).send({ from: user1 }), Error.VestingNotStarted);
      await advanceDays(1);
      await expectRevert(() => vesting.methods.claim(user1).send({ from: user1 }), Error.VestingNotStarted);
      await advanceDays(28);
      await expectRevert(() => vesting.methods.claim(user1).send({ from: user1 }), Error.VestingNotStarted);
    });

    it("cannot claim if there's no eligibility", async () => {
      await vesting.methods.setAmount(user2, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
      await approveProjectTokenToVesting(TOKENS_PER_USER);
      await activateAndReachStartTime();
      await advanceDays(1);
      await expectRevert(() => vesting.methods.claim(user1).send({ from: user1 }), Error.NothingToClaim);
    });

    it("project can claim on behalf of user", async () => {
      await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
      await approveProjectTokenToVesting(TOKENS_PER_USER);
      await activateAndReachStartTime();
      await advanceDays(70);
      await vesting.methods.claim(user1).send({ from: projectWallet });

      expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
        (await projectToken.amount(TOKENS_PER_USER)).multipliedBy(70 * DAY_SECONDS).dividedBy(VESTING_DURATION_SECONDS),
        await projectToken.amount(0.01)
      );
    });

    it("cannot claim if not user or project", async () => {
      await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
      await approveProjectTokenToVesting(TOKENS_PER_USER);
      await activateAndReachStartTime();
      await advanceDays(70);
      for (const user of [anyUser, user2, deployer]) {
        await expectRevert(() => vesting.methods.claim(user1).send({ from: user }), Error.OnlyProjectOrSender);
      }
    });

    it("lets multiple users claim", async () => {
      await setAmountForUser1(100);
      await setAmountForUser2(50);
      await approveProjectTokenToVesting(150);
      expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.zero;
      expect(await projectToken.methods.balanceOf(user2).call()).to.be.bignumber.zero;
      await activateAndReachStartTime();
      await advanceDays(VESTING_DURATION_DAYS);
      await vesting.methods.claim(user1).send({ from: user1 });
      await vesting.methods.claim(user2).send({ from: user2 });
      expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.eq(await projectToken.amount(100));
      expect(await projectToken.methods.balanceOf(user2).call()).to.be.bignumber.eq(await projectToken.amount(50));
    });

    it("extra project token balance doesn't affect claim", async () => {
      await setAmountForUser1(100);
      await approveProjectTokenToVesting(100);
      expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.zero;
      await activateAndReachStartTime();
      // Add 100 extra tokens
      await projectToken.methods.transfer(vesting.options.address, await projectToken.amount(100)).send({ from: projectWallet });

      await advanceDays(VESTING_DURATION_DAYS);
      await vesting.methods.claim(user1).send({ from: user1 });
      expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.eq(await projectToken.amount(100));
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
      await approveProjectTokenToVesting(TOKENS_PER_USER);
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
        CALLER_NOT_PROJECT_ROLE_MSG
      );

      await expectRevert(async () => await vesting.methods.claim(user1).send({ from: projectWallet }), Error.OnlyProjectOrSender);
    });

    it("old wallet address should not be able to call transfer role again after initial transfer", async () => {
      await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
      await vesting.methods.transferProjectRole(differentProjectWallet).send({ from: projectWallet });

      await expectRevert(async () => await vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet }), CALLER_NOT_PROJECT_ROLE_MSG);
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

    it("recovers ether (project role transferred)", async () => {
      const startingBalanceOrigProjWallet = await web3().eth.getBalance(projectWallet);
      const startingBalanceDifferentProjWallet = await web3().eth.getBalance(differentProjectWallet);
      expect(await web3().eth.getBalance(vesting.options.address)).to.bignumber.eq(0);
      await setBalance(vesting.options.address, BN(12345 * 1e18));
      await vesting.methods.transferProjectRole(differentProjectWallet).send({ from: projectWallet });
      await vesting.methods.recoverEther().send({ from: deployer });
      expect(await web3().eth.getBalance(vesting.options.address)).to.be.bignumber.zero;
      expect(await web3().eth.getBalance(projectWallet)).to.bignumber.closeTo(startingBalanceOrigProjWallet, BN(0.1e18));
      expect(await web3().eth.getBalance(differentProjectWallet)).to.bignumber.eq(BN(12345 * 1e18).plus(startingBalanceDifferentProjWallet));
    });

    it("does not recover ether if recovering token", async () => {
      expect(await web3().eth.getBalance(vesting.options.address)).to.bignumber.eq(0);
      await setBalance(vesting.options.address, BN(12345 * 1e18));
      await someOtherToken.methods.transfer(vesting.options.address, BN(12345 * 1e18)).send({ from: deployer });
      await vesting.methods.recoverToken(someOtherToken.options.address).send({ from: deployer });
      expect(await web3().eth.getBalance(vesting.options.address)).to.bignumber.closeTo(BN(12345 * 1e18), BN(0.1e18));
    });

    it("recovers other tokens", async () => {
      expect(await someOtherToken.methods.balanceOf(projectWallet).call()).to.be.bignumber.zero;
      await someOtherToken.methods.transfer(vesting.options.address, 12345).send({ from: deployer });
      await vesting.methods.recoverToken(someOtherToken.options.address).send({ from: deployer });
      expect(await someOtherToken.methods.balanceOf(vesting.options.address).call()).to.be.bignumber.zero;
      expect(await someOtherToken.methods.balanceOf(projectWallet).call()).to.be.bignumber.eq(12345);
    });

    it("recovers other tokens (project role transferred)", async () => {
      expect(await someOtherToken.methods.balanceOf(projectWallet).call()).to.be.bignumber.zero;
      expect(await someOtherToken.methods.balanceOf(differentProjectWallet).call()).to.be.bignumber.zero;
      await someOtherToken.methods.transfer(vesting.options.address, 12345).send({ from: deployer });
      await vesting.methods.transferProjectRole(differentProjectWallet).send({ from: projectWallet });
      await vesting.methods.recoverToken(someOtherToken.options.address).send({ from: deployer });
      expect(await someOtherToken.methods.balanceOf(vesting.options.address).call()).to.be.bignumber.zero;
      expect(await someOtherToken.methods.balanceOf(projectWallet).call()).to.be.bignumber.zero;
      expect(await someOtherToken.methods.balanceOf(differentProjectWallet).call()).to.be.bignumber.eq(12345);
    });

    it("recovers excess projectToken, before and after excess mixed", async () => {
      await vesting.methods.setAmount(user1, 100).send({ from: projectWallet });
      await projectToken.methods.approve(vesting.options.address, 100).send({ from: projectWallet });
      await projectToken.methods.transfer(vesting.options.address, 20).send({ from: projectWallet });
      await vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
      await projectToken.methods.transfer(vesting.options.address, 30).send({ from: projectWallet });
      const projectBalanceBefore = BN(await projectToken.methods.balanceOf(projectWallet).call());
      await vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer });
      expect(await projectToken.methods.balanceOf(projectWallet).call()).to.be.bignumber.eq(projectBalanceBefore.plus(50));
    });

    it("recovers projet token, partially claimed by user (half vesting period)", async () => {
      await vesting.methods.setAmount(user1, 100).send({ from: projectWallet });
      await projectToken.methods.approve(vesting.options.address, 100).send({ from: projectWallet });
      await vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
      await advanceDays(3);
      await projectToken.methods.transfer(vesting.options.address, 30).send({ from: projectWallet });
      await advanceDays(VESTING_DURATION_DAYS / 2);

      await vesting.methods.claim(user1).send({ from: user1 });
      expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.eq(50);

      let balanceBeforeRecover = BN(await projectToken.methods.balanceOf(projectWallet).call());
      await vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer });
      expect(await projectToken.methods.balanceOf(projectWallet).call()).to.be.bignumber.eq(balanceBeforeRecover.plus(30));

      await advanceDays(VESTING_DURATION_DAYS / 2);
      await vesting.methods.claim(user1).send({ from: user1 });
      expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.eq(100);

      await projectToken.methods.transfer(vesting.options.address, 20).send({ from: projectWallet });
      balanceBeforeRecover = BN(await projectToken.methods.balanceOf(projectWallet).call());
      await vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer });
      expect(await projectToken.methods.balanceOf(projectWallet).call()).to.be.bignumber.eq(balanceBeforeRecover.plus(20));
    });

    it("recovers excess projectToken, some allocations set, then reduced", async () => {
      await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
      await vesting.methods.setAmount(user2, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
      await projectToken.methods.transfer(vesting.options.address, await projectToken.amount(TOKENS_PER_USER * 10)).send({ from: projectWallet });

      let projectBalanceBefore = BN(await projectToken.methods.balanceOf(projectWallet).call());
      await vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer });
      // Recover all but the tokens allocated to users
      expect(await projectToken.methods.balanceOf(vesting.options.address).call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER * 2));
      expect(await projectToken.methods.balanceOf(projectWallet).call()).to.be.bignumber.eq(
        (await projectToken.amount(TOKENS_PER_USER * 8)).plus(projectBalanceBefore)
      );
      await vesting.methods.setAmount(user1, (await projectToken.amount(TOKENS_PER_USER)).minus(50)).send({ from: projectWallet });
      projectBalanceBefore = BN(await projectToken.methods.balanceOf(projectWallet).call());
      await vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer });
      expect(await projectToken.methods.balanceOf(projectWallet).call()).to.be.bignumber.eq(BN(50).plus(projectBalanceBefore));
    });

    it("recovers excess projectToken, some allocations set, then reduced to zero", async () => {
      await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
      await vesting.methods.setAmount(user2, (await projectToken.amount(TOKENS_PER_USER)).dividedBy(2)).send({ from: projectWallet });
      await projectToken.methods
        .transfer(vesting.options.address, (await projectToken.amount(TOKENS_PER_USER * 3)).dividedBy(2).plus(200))
        .send({ from: projectWallet });

      let projectBalanceBefore = BN(await projectToken.methods.balanceOf(projectWallet).call());
      await vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer });
      // Recover all but the tokens allocated to users
      expect(await projectToken.methods.balanceOf(projectWallet).call()).to.be.bignumber.eq(projectBalanceBefore.plus(200));
      await vesting.methods.setAmount(user1, 0).send({ from: projectWallet });
      await vesting.methods.setAmount(user2, 0).send({ from: projectWallet });
      projectBalanceBefore = BN(await projectToken.methods.balanceOf(projectWallet).call());
      await vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer });
      expect(await projectToken.methods.balanceOf(projectWallet).call()).to.be.bignumber.eq(
        (await projectToken.amount(TOKENS_PER_USER * 3)).dividedBy(2).plus(projectBalanceBefore)
      );
    });

    it("recovers excess projectToken, no allocations set", async () => {
      const excess = await projectToken.amount(TOKENS_PER_USER * 10);
      await projectToken.methods.transfer(vesting.options.address, excess).send({ from: projectWallet });
      const initialBalance = await projectToken.methods.balanceOf(projectWallet).call();
      await vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer });
      expect(await projectToken.methods.balanceOf(vesting.options.address).call()).to.be.bignumber.eq(await projectToken.amount(0));
      expect(await projectToken.methods.balanceOf(projectWallet).call()).to.be.bignumber.eq(excess.plus(initialBalance));
    });

    it("recovers excess projectToken, recovery called multiple times is idempotent", async () => {
      await projectToken.methods.transfer(vesting.options.address, await projectToken.amount(TOKENS_PER_USER * 10)).send({ from: projectWallet });
      await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER / 4)).send({ from: projectWallet });
      await vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer });
      expect(await projectToken.methods.balanceOf(vesting.options.address).call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER / 4));
      await expectRevert(() => vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer }), Error.NothingToClaim);
    });

    it("recovers correct amount of token not accounted for if part was claimed", async () => {
      await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
      await approveProjectTokenToVesting(TOKENS_PER_USER);
      await activateAndReachStartTime();
      await advanceDays(VESTING_DURATION_DAYS / 4);
      await vesting.methods.claim(user1).send({ from: user1 });
      let startingBalance = await projectToken.methods.balanceOf(projectWallet).call();
      // First recover, no excess tokens to be recovered
      await expectRevert(() => vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer }), Error.NothingToClaim);
      expect(BN(await projectToken.methods.balanceOf(projectWallet).call()).minus(startingBalance)).to.be.bignumber.zero;

      // Transfer excess tokens and try to recover them
      await projectToken.methods.transfer(vesting.options.address, await projectToken.amount(TOKENS_PER_USER * 3)).send({ from: projectWallet });
      startingBalance = await projectToken.methods.balanceOf(projectWallet).call();
      await vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer });
      expect(BN(await projectToken.methods.balanceOf(projectWallet).call()).minus(startingBalance)).to.be.bignumber.eq(
        await projectToken.amount(TOKENS_PER_USER * 3)
      );
    });

    it("recovers correct amount of token not accounted for if all was claimed", async () => {
      await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
      await vesting.methods.setAmount(user2, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
      await approveProjectTokenToVesting(TOKENS_PER_USER * 2);
      await activateAndReachStartTime();
      await advanceDays(VESTING_DURATION_DAYS * 1.5); // Pass entire vesting period
      await vesting.methods.claim(user1).send({ from: user1 });
      await vesting.methods.claim(user2).send({ from: user2 });

      // Transfer excess tokens and try to recover them
      await projectToken.methods.transfer(vesting.options.address, await projectToken.amount(TOKENS_PER_USER * 3)).send({ from: projectWallet });
      const startingBalance = await projectToken.methods.balanceOf(projectWallet).call();
      await vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer });
      expect(BN(await projectToken.methods.balanceOf(projectWallet).call()).minus(startingBalance)).to.be.bignumber.eq(
        await projectToken.amount(TOKENS_PER_USER * 3)
      );
    });

    it("reverts if nothing to recover (project token)", async () => {
      const startingBalance = await projectToken.methods.balanceOf(vesting.options.address).call();
      expect(startingBalance).to.be.bignumber.zero;
      await expectRevert(() => vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer }), Error.NothingToClaim);
    });

    it("no-op if nothing to recover (other token)", async () => {
      expect(await someOtherToken.methods.balanceOf(vesting.options.address).call()).to.bignumber.zero;
      await vesting.methods.recoverToken(someOtherToken.options.address).send({ from: deployer });
      expect(await someOtherToken.methods.balanceOf(vesting.options.address).call()).to.bignumber.zero;
    });

    it("reverts when project token allocations are larger than project token balance", async () => {
      await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
      await projectToken.methods.transfer(vesting.options.address, await projectToken.amount(TOKENS_PER_USER / 3)).send({ from: projectWallet });
      await expectRevert(() => vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer }), Error.NothingToClaim);
    });

    it("reverts when project token allocations are equal to projet token balance", async () => {
      await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
      await approveProjectTokenToVesting(TOKENS_PER_USER);
      await activateAndReachStartTime();
      await expectRevert(() => vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer }), Error.NothingToClaim);
    });

    it("reverts when project token allocations are equal to projet token balance (manual transfer)", async () => {
      await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
      await projectToken.methods.transfer(vesting.options.address, (await projectToken.amount(TOKENS_PER_USER)).dividedBy(4)).send({ from: projectWallet });
      await expectRevert(() => vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer }), Error.NothingToClaim);
      await projectToken.methods
        .transfer(vesting.options.address, (await projectToken.amount(TOKENS_PER_USER)).multipliedBy(3).dividedBy(4))
        .send({ from: projectWallet });
      await expectRevert(() => vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer }), Error.NothingToClaim);
    });
  });

  describe("access control", () => {
    describe("only project", () => {
      it("can activate", async () => {
        await projectToken.methods.approve(vesting.options.address, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
        const expectedInvalidUsers = [user1, deployer, anyUser];

        for (const invalidUser of expectedInvalidUsers) {
          await expectRevert(async () => vesting.methods.activate(await getDefaultStartTime()).send({ from: invalidUser }), CALLER_NOT_PROJECT_ROLE_MSG);
        }

        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
        await vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
        // should not revert
      });

      it("can set amounts", async () => {
        const expectedInvalidUsers = [user2, deployer, anyUser];

        for (const invalidUser of expectedInvalidUsers) {
          await expectRevert(async () => vesting.methods.setAmount(user1, 1).send({ from: invalidUser }), CALLER_NOT_PROJECT_ROLE_MSG);
        }

        await vesting.methods.setAmount(user1, 1).send({ from: projectWallet });
        // should not revert
      });
    });

    describe("only owner", () => {
      it("can recover ether", async () => {
        const expectedInvalidUsers = [projectWallet, anyUser, user2];

        for (const invalidUser of expectedInvalidUsers) {
          await expectRevert(async () => await vesting.methods.recoverEther().send({ from: invalidUser }), CALLER_NOT_OWNER_REVERT_MSG);
        }

        await vesting.methods.recoverEther().send({ from: deployer });
      });

      it("can recover token", async () => {
        const expectedInvalidUsers = [projectWallet, anyUser, user2];

        for (const invalidUser of expectedInvalidUsers) {
          await expectRevert(
            async () => await vesting.methods.recoverToken(someOtherToken.options.address).send({ from: invalidUser }),
            CALLER_NOT_OWNER_REVERT_MSG
          );
        }

        await vesting.methods.recoverToken(someOtherToken.options.address).send({ from: deployer });
      });

      it("can emergency release", async () => {
        await setAmountForUser1();
        await approveProjectTokenToVesting();
        await vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
        expect(await vesting.methods.isEmergencyReleased().call()).to.be.false;

        for (const user of [projectWallet, user2, anyUser]) {
          await expectRevert(async () => vesting.methods.emergencyRelease().send({ from: user }), CALLER_NOT_OWNER_REVERT_MSG);
        }

        await vesting.methods.emergencyRelease().send({ from: deployer });
        expect(await vesting.methods.isEmergencyReleased().call()).to.be.true;
      });
    });
  });

  describe("set amount", () => {
    it("cannot set amount after activation", async () => {
      await setAmountForUser1();
      await projectToken.methods.approve(vesting.options.address, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
      await vesting.methods.activate(await getCurrentTimestamp()).send({ from: projectWallet });
      await expectRevert(async () => await setAmountForUser2(), Error.AlreadyActivated);
      await expectRevert(async () => await setAmountForUser1(TOKENS_PER_USER / 4), Error.AlreadyActivated);
    });

    describe("per user and global amounts are accurate", () => {
      it("no users", async () => {
        expect(await vesting.methods.totalAmount().call()).to.be.bignumber.zero;
      });

      it("single user", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
        expect((await vesting.methods.userVestings(user1).call()).amount).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
        expect(await vesting.methods.totalAmount().call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
      });

      it("single user, amount updated to same amount as previously", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
        expect((await vesting.methods.userVestings(user1).call()).amount).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
        expect(await vesting.methods.totalAmount().call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
      });

      it("multiple users", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(3_500)).send({ from: projectWallet });
        await vesting.methods.setAmount(user2, await projectToken.amount(1_000)).send({ from: projectWallet });
        expect((await vesting.methods.userVestings(user1).call()).amount).to.be.bignumber.eq(await projectToken.amount(3_500));
        expect((await vesting.methods.userVestings(user2).call()).amount).to.be.bignumber.eq(await projectToken.amount(1_000));
        expect(await vesting.methods.totalAmount().call()).to.be.bignumber.eq(await (await projectToken.amount(3_500)).plus(await projectToken.amount(1_000)));
      });

      it("multiple users, amount reduced", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(10_000)).send({ from: projectWallet });
        await vesting.methods.setAmount(user2, await projectToken.amount(10_000)).send({ from: projectWallet });
        await vesting.methods.setAmount(user1, await projectToken.amount(3_000)).send({ from: projectWallet });
        expect((await vesting.methods.userVestings(user1).call()).amount).to.be.bignumber.eq(await projectToken.amount(3_000));
        expect((await vesting.methods.userVestings(user2).call()).amount).to.be.bignumber.eq(await projectToken.amount(10_000));
        expect(await vesting.methods.totalAmount().call()).to.be.bignumber.eq(await await projectToken.amount(13_000));
      });

      it("multiple users, amount reduced to zero", async () => {
        await vesting.methods.setAmount(user1, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
        await vesting.methods.setAmount(user2, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
        await vesting.methods.setAmount(user2, await projectToken.amount(0)).send({ from: projectWallet });
        expect((await vesting.methods.userVestings(user1).call()).amount).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
        expect((await vesting.methods.userVestings(user2).call()).amount).to.be.bignumber.eq(await projectToken.amount(0));
        expect(await vesting.methods.totalAmount().call()).to.be.bignumber.eq(await await projectToken.amount(TOKENS_PER_USER));
      });
    });
  });

  describe("activate", () => {
    it("fails if start time is in the past", async () => {
      const timeInPast = BN(await getCurrentTimestamp()).minus(1);
      await expectRevert(async () => vesting.methods.activate(timeInPast).send({ from: projectWallet }), Error.StartTimeInPast);
    });

    it("fails if start time is too far in to the future", async () => {
      const timeInDistantFuture = BN(await getCurrentTimestamp())
        .plus(MONTH_SECONDS * 3)
        .plus(DAY_SECONDS);
      await expectRevert(async () => vesting.methods.activate(timeInDistantFuture).send({ from: projectWallet }), Error.StartTimeTooDistant);
    });

    it("fails if there isn't enough PROJECT_TOKEN allowance to cover total allocated", async () => {
      await setAmountForUser1();
      await expectRevert(async () => vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet }), ERC_20_EXCEEDS_ALLOWANCE);
      await approveProjectTokenToVesting(TOKENS_PER_USER - 1);
      await expectRevert(async () => vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet }), ERC_20_EXCEEDS_ALLOWANCE);
    });

    it("fails if there isn't enough PROJECT_TOKEN balance to cover total allocated", async () => {
      await setAmountForUser1();
      await approveProjectTokenToVesting(TOTAL_SUPPLY);
      // Get rid of all balance
      await projectToken.methods.transfer(anyUser, await projectToken.amount(TOTAL_SUPPLY - 50)).send({ from: projectWallet });
      await expectRevert(async () => vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet }), ERC_20_EXCEEDS_BALANCE);
    });

    it("transfers PROJECT_TOKEN in an amount matching total allocated", async () => {
      await setAmountForUser1(100);
      await setAmountForUser2(50);
      await projectToken.methods.transfer(anyUser, await projectToken.amount(TOTAL_SUPPLY - 150)).send({ from: projectWallet });
      await approveProjectTokenToVesting(150);
      await vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
      expect(await projectToken.methods.balanceOf(vesting.options.address).call()).to.be.bignumber.eq(await projectToken.amount(150));
      expect(await projectToken.methods.balanceOf(projectWallet).call()).to.be.bignumber.zero;
    });

    it("transfers the allocated amount of PROJECT_TOKEN even if already funded sufficiently, able to recover", async () => {
      await setAmountForUser1();
      await approveProjectTokenToVesting();

      // excess
      await projectToken.methods.transfer(vesting.options.address, await projectToken.amount(12_345)).send({ from: projectWallet });

      await projectToken.methods.approve(vesting.options.address, await projectToken.amount(TOKENS_PER_USER)).send({ from: projectWallet });
      const initialContractProjectTokenBalance = await projectToken.methods.balanceOf(vesting.options.address).call();
      await vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
      const currentContractBalance = await projectToken.methods.balanceOf(vesting.options.address).call();
      expect(BN(currentContractBalance).minus(initialContractProjectTokenBalance)).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));

      const initialProjectWalletBalance = await projectToken.methods.balanceOf(projectWallet).call();
      await vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer });
      const currentProjectWalletBalance = await projectToken.methods.balanceOf(projectWallet).call();
      expect(BN(currentProjectWalletBalance).minus(initialProjectWalletBalance)).to.be.bignumber.eq(await projectToken.amount(12_345));
    });

    it("transfers PROJECT_TOKEN required to back FUNDING_TOKEN funding (partially pre-funded)", async () => {
      await setAmountForUser1();
      await approveProjectTokenToVesting();
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
      await expectRevert(async () => vesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet }), Error.TotalAmountZero);
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
      await expectRevert(async () => vesting.methods.emergencyRelease().send({ from: deployer }), Error.EmergencyReleaseActive);
    });

    it("non-user, non-project cannot emergency claim", async () => {
      await setAmountForUser1();
      await approveProjectTokenToVesting();
      await activateAndReachStartTime();
      await vesting.methods.emergencyRelease().send({ from: deployer });

      for (const user of [anyUser, user2, deployer]) {
        await expectRevert(async () => vesting.methods.emergencyClaim(user1).send({ from: user }), Error.OnlyProjectOrSender);
      }

      await vesting.methods.emergencyClaim(user1).send({ from: projectWallet });
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
          await expectRevert(() => vesting.methods.emergencyClaim(user1).send({ from: isProject ? projectWallet : user1 }), Error.NothingToClaim);
          await vesting.methods.emergencyClaim(user2).send({ from: isProject ? projectWallet : user2 });
          expect(await projectToken.methods.balanceOf(user2).call()).to.be.bignumber.eq(await projectToken.amount(TOKENS_PER_USER));
        });

        it("cannot emergency claim if not released", async () => {
          await setAmountForUser1();
          await approveProjectTokenToVesting();
          await activateAndReachStartTime();
          await expectRevert(async () => vesting.methods.emergencyClaim(user1).send({ from: isProject ? projectWallet : user1 }), Error.NotEmergencyReleased);
        });
        it("can regularly claim even if emergency released", async () => {
          await setAmountForUser1();
          await approveProjectTokenToVesting();
          await activateAndReachStartTime();
          await advanceDays(VESTING_DURATION_DAYS / 4);
          await vesting.methods.emergencyRelease().send({ from: deployer });
          await vesting.methods.claim(user1).send({ from: isProject ? projectWallet : user1 });
          expect(await projectToken.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
            (await projectToken.amount(TOKENS_PER_USER)).dividedBy(4),
            await projectToken.amount(0.1)
          );
        });
      });
    });

    describe("Renounce/transfer ownership", () => {
      it("emergencyRelease, recoverEther, recoverToken should not be callable after renouncing ownership", async () => {
        await vesting.methods.renounceOwnership().send({ from: deployer });
        await expectRevert(async () => await vesting.methods.emergencyRelease().send({ from: deployer }), CALLER_NOT_OWNER_REVERT_MSG);
        await expectRevert(async () => await vesting.methods.recoverEther().send({ from: deployer }), CALLER_NOT_OWNER_REVERT_MSG);
        await expectRevert(async () => await vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer }), CALLER_NOT_OWNER_REVERT_MSG);
      });

      it("emergencyRelease, recoverEther, recoverToken should not be callable after transferring ownership", async () => {
        await vesting.methods.transferOwnership(anyUser).send({ from: deployer });
        await expectRevert(async () => await vesting.methods.emergencyRelease().send({ from: deployer }), CALLER_NOT_OWNER_REVERT_MSG);
        await expectRevert(async () => await vesting.methods.recoverEther().send({ from: deployer }), CALLER_NOT_OWNER_REVERT_MSG);
        await expectRevert(async () => await vesting.methods.recoverToken(projectToken.options.address).send({ from: deployer }), CALLER_NOT_OWNER_REVERT_MSG);

        // Still fail, but passes auth
        await expectRevert(async () => await vesting.methods.emergencyRelease().send({ from: anyUser }), Error.NotActivated);
        await vesting.methods.recoverEther().send({ from: anyUser });
        await vesting.methods.recoverToken(someOtherToken.options.address).send({ from: anyUser });
      });
    });
  });

  describe("view functions", () => {
    it("returns 0 vested when not activated", async () => {
      await setAmountForUser1();
      expect(await vesting.methods.totalVestedFor(user1).call()).to.be.bignumber.eq(0);
    });
  });

  describe("deployment", () => {
    it("cannot set vesting duration to over 10 years", async () => {
      // TODO TEMPORARY: until having production PROJECT_TOKEN address
      const testConfig = [...config];
      testConfig[0] = projectToken.options.address;
      testConfig[2] = projectWallet;
      // END TEMPORARY

      const YEAR = 365 * DAY_SECONDS;
      for (const duration of [YEAR * 11, YEAR * 100, YEAR * 10 + 1]) {
        testConfig[1] = duration;
        await expectRevert(() => deployArtifact<VestingV1>("VestingV1", { from: deployer }, testConfig), Error.VestingDurationTooLong);
      }

      for (const duration of [0, YEAR * 3, YEAR * 10, YEAR * 9, YEAR * 10 - 1]) {
        testConfig[1] = duration;
        await deployArtifact<VestingV1>("VestingV1", { from: deployer }, testConfig);
      }
    });
  });
});
