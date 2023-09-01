import { expect } from "chai";
import BN from "bignumber.js";
import { deployArtifact, expectRevert, setBalance } from "@defi.org/web3-candies/dist/hardhat";
import {
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
  Error,
  advanceDays,
  DAY,
  VESTING_DURATION_SECONDS,
  approveXctdToVesting,
  transferXctdToVesting,
  setAmountForUser1,
  setAmountForUser2,
} from "./fixture";
import { web3, zeroAddress } from "@defi.org/web3-candies";
import { UninsuredVestingV1 } from "../../typechain-hardhat/contracts/uninsured-vesting-v1/UninsuredVestingV1";

describe("VestingV1", () => {
  beforeEach(async () => withFixture());

  describe("with xctd approved to contract", () => {
    beforeEach(async () => {
      transferXctdToVesting();
    });

    const testCases = [0, 1, 5, 10, 100, 200, 534];

    for (const days of testCases) {
      it(`can claim tokens proportional to amount of seconds in ${days} days passed`, async () => {
        await uninsuredVesting.methods.setAmount(user1, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer });
        await uninsuredVesting.methods.activate().send({ from: deployer });
        await advanceDays(days);
        await uninsuredVesting.methods.claim(user1).send({ from: anyUser });

        expect(await xctd.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(
          (await xctd.amount(TOKENS_PER_USER)).multipliedBy(days * DAY).dividedBy(VESTING_DURATION_SECONDS),
          await xctd.amount(0.01)
        );
      });
    }

    it(`can claim tokens for the entire period`, async () => {
      await uninsuredVesting.methods.setAmount(user1, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer });
      await uninsuredVesting.methods.activate().send({ from: deployer });
      await advanceDays(VESTING_DURATION_SECONDS);
      await uninsuredVesting.methods.claim(user1).send({ from: anyUser });

      expect(await xctd.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(await xctd.amount(TOKENS_PER_USER), await xctd.amount(0.01));
    });

    it(`can claim tokens for the entire period, longer than vesting period has passed`, async () => {
      await uninsuredVesting.methods.setAmount(user1, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer });
      await uninsuredVesting.methods.activate().send({ from: deployer });
      await advanceDays(VESTING_DURATION_SECONDS * 2);
      await uninsuredVesting.methods.claim(user1).send({ from: anyUser });

      expect(await xctd.methods.balanceOf(user1).call()).to.be.bignumber.closeTo(await xctd.amount(TOKENS_PER_USER), await xctd.amount(0.01));
    });

    it("cannot double-claim tokens for same period of time", async () => {
      await uninsuredVesting.methods.setAmount(user1, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer });
      await uninsuredVesting.methods.activate().send({ from: deployer });
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
      await uninsuredVesting.methods.setAmount(user1, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer });
      await expectRevert(() => uninsuredVesting.methods.claim(user1).send({ from: anyUser }), Error.VestingNotStarted);
    });

    it("cannot claim if there's no eligibility", async () => {
      await uninsuredVesting.methods.setAmount(user2, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer });
      await uninsuredVesting.methods.activate().send({ from: deployer });
      await advanceDays(1);
      await expectRevert(() => uninsuredVesting.methods.claim(user1).send({ from: anyUser }), Error.NothingToClaim);
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
        await uninsuredVesting.methods.setAmount(user1, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer });
        await uninsuredVesting.methods.setAmount(user2, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer });
        await uninsuredVesting.methods.recover(xctd.options.address).send({ from: deployer });
        // Recover all but the tokens allocated to users
        expect(await xctd.methods.balanceOf(uninsuredVesting.options.address).call()).to.be.bignumber.eq(await xctd.amount(TOKENS_PER_USER * 2));
      });
    });

    describe("access control", () => {
      it("cannot call activate if not owner", async () => {
        await expectRevert(async () => uninsuredVesting.methods.activate().send({ from: anyUser }), "Ownable: caller is not the owner");
      });

      it("cannot set amounts if not owner", async () => {
        await expectRevert(async () => uninsuredVesting.methods.setAmount(user1, 1).send({ from: anyUser }), "Ownable: caller is not the owner");
      });

      it("cannot recover if not owner", async () => {
        await expectRevert(async () => uninsuredVesting.methods.recover(xctd.options.address).send({ from: anyUser }), "Ownable: caller is not the owner");
      });
    });

    describe("admin", () => {
      describe("set amount", () => {
        it("cannot set amount after period started", async () => {
          await setAmountForUser1();
          await uninsuredVesting.methods.activate().send({ from: deployer });
          await expectRevert(async () => await setAmountForUser2(), Error.VestingAlreadyStarted);
        });

        describe("per user and global amounts are accurate", () => {
          it("no users", async () => {
            expect(await uninsuredVesting.methods.totalAllocated().call()).to.be.bignumber.zero;
          });

          it("single user", async () => {
            await uninsuredVesting.methods.setAmount(user1, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer });
            expect((await uninsuredVesting.methods.userVestings(user1).call()).amount).to.be.bignumber.eq(await xctd.amount(TOKENS_PER_USER));
            expect(await uninsuredVesting.methods.totalAllocated().call()).to.be.bignumber.eq(await xctd.amount(TOKENS_PER_USER));
          });

          it("single user, amount updated to same amount as previously", async () => {
            await uninsuredVesting.methods.setAmount(user1, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer });
            await uninsuredVesting.methods.setAmount(user1, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer });
            expect((await uninsuredVesting.methods.userVestings(user1).call()).amount).to.be.bignumber.eq(await xctd.amount(TOKENS_PER_USER));
            expect(await uninsuredVesting.methods.totalAllocated().call()).to.be.bignumber.eq(await xctd.amount(TOKENS_PER_USER));
          });

          it("multiple users", async () => {
            await uninsuredVesting.methods.setAmount(user1, await xctd.amount(3_500)).send({ from: deployer });
            await uninsuredVesting.methods.setAmount(user2, await xctd.amount(1_000)).send({ from: deployer });
            expect((await uninsuredVesting.methods.userVestings(user1).call()).amount).to.be.bignumber.eq(await xctd.amount(3_500));
            expect((await uninsuredVesting.methods.userVestings(user2).call()).amount).to.be.bignumber.eq(await xctd.amount(1_000));
            expect(await uninsuredVesting.methods.totalAllocated().call()).to.be.bignumber.eq(await (await xctd.amount(3_500)).plus(await xctd.amount(1_000)));
          });

          it("multiple users, amount reduced", async () => {
            await uninsuredVesting.methods.setAmount(user1, await xctd.amount(10_000)).send({ from: deployer });
            await uninsuredVesting.methods.setAmount(user2, await xctd.amount(10_000)).send({ from: deployer });
            await uninsuredVesting.methods.setAmount(user1, await xctd.amount(3_000)).send({ from: deployer });
            expect((await uninsuredVesting.methods.userVestings(user1).call()).amount).to.be.bignumber.eq(await xctd.amount(3_000));
            expect((await uninsuredVesting.methods.userVestings(user2).call()).amount).to.be.bignumber.eq(await xctd.amount(10_000));
            expect(await uninsuredVesting.methods.totalAllocated().call()).to.be.bignumber.eq(await await xctd.amount(13_000));
          });

          it("multiple users, amount reduced to zero", async () => {
            await uninsuredVesting.methods.setAmount(user1, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer });
            await uninsuredVesting.methods.setAmount(user2, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer });
            await uninsuredVesting.methods.setAmount(user2, await xctd.amount(0)).send({ from: deployer });
            expect((await uninsuredVesting.methods.userVestings(user1).call()).amount).to.be.bignumber.eq(await xctd.amount(TOKENS_PER_USER));
            expect((await uninsuredVesting.methods.userVestings(user2).call()).amount).to.be.bignumber.eq(await xctd.amount(0));
            expect(await uninsuredVesting.methods.totalAllocated().call()).to.be.bignumber.eq(await await xctd.amount(TOKENS_PER_USER));
          });
        });
      });
    });
  });

  describe("deployment", () => {
    it("project address cannot be zero", async () => {
      await expectRevert(async () => await deployArtifact<UninsuredVestingV1>("UninsuredVestingV1", { from: deployer }, [zeroAddress]), Error.ZeroAddress);
    });
  });

  describe("activate", () => {
    it("fails if there isn't enough XCTD allowance to cover total allocated", async () => {
      await setAmountForUser1();
      await expectRevert(async () => uninsuredVesting.methods.activate().send({ from: deployer }), "ERC20: insufficient allowance");
    });

    it("fails if there isn't enough XCTD balance to cover total allocated", async () => {
      await setAmountForUser1();
      await approveXctdToVesting();
      // Get rid of all balance
      await xctd.methods.transfer(anyUser, await xctd.amount(1e9)).send({ from: deployer });
      await expectRevert(async () => uninsuredVesting.methods.activate().send({ from: deployer }), "ERC20: transfer amount exceeds balance");
    });

    it("transfers XCTD proportional to total allocated", async () => {
      await setAmountForUser1();
      await approveXctdToVesting();
      await uninsuredVesting.methods.activate().send({ from: deployer });
      expect(await xctd.methods.balanceOf(uninsuredVesting.options.address).call()).to.be.bignumber.eq(await xctd.amount(TOKENS_PER_USER));
    });

    it("does not transfer XCTD if already funded sufficiently", async () => {
      await setAmountForUser1();
      await approveXctdToVesting();
      await xctd.methods.transfer(uninsuredVesting.options.address, await xctd.amount(TOKENS_PER_USER)).send({ from: deployer });
      const initialContractXctdBalance = await xctd.methods.balanceOf(uninsuredVesting.options.address).call();
      await uninsuredVesting.methods.activate().send({ from: deployer });
      const currentContractBalance = await xctd.methods.balanceOf(uninsuredVesting.options.address).call();
      expect(initialContractXctdBalance).to.be.bignumber.eq(currentContractBalance);
    });

    it("transfers XCTD required to back USDC funding (partially pre-funded)", async () => {
      await setAmountForUser1();
      await approveXctdToVesting();
      await xctd.methods.transfer(uninsuredVesting.options.address, await xctd.amount(TOKENS_PER_USER / 4)).send({ from: deployer });
      await uninsuredVesting.methods.activate().send({ from: deployer });
      const contractXctdBalance = await xctd.methods.balanceOf(uninsuredVesting.options.address).call();
      expect(contractXctdBalance).to.be.bignumber.eq(await xctd.amount(TOKENS_PER_USER));
    });

    it("fails if already activated", async () => {
      await setAmountForUser1();
      await approveXctdToVesting();
      await uninsuredVesting.methods.activate().send({ from: deployer });
      await expectRevert(async () => uninsuredVesting.methods.activate().send({ from: deployer }), Error.VestingAlreadyStarted);
    });

    it("fails if no allocations added", async () => {
      await expectRevert(async () => uninsuredVesting.methods.activate().send({ from: deployer }), Error.NoAllocationsAdded);
    });

    it("sets start time", async () => {
      await setAmountForUser1();
      await approveXctdToVesting();
      await uninsuredVesting.methods.activate().send({ from: deployer });
      expect(await uninsuredVesting.methods.startTime().call()).to.be.bignumber.eq(await getCurrentTimestamp());
    });
  });
});
