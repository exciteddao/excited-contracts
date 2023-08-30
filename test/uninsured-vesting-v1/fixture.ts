import { Token, account, bn18, erc20, BlockInfo, Receipt, web3 } from "@defi.org/web3-candies";
import { deployArtifact, mineBlock, tag, useChaiBigNumber } from "@defi.org/web3-candies/dist/hardhat";
import BN from "bignumber.js";
import { UninsuredVestingV1 } from "../../typechain-hardhat/contracts/uninsured-vesting-v1/UninsuredVestingV1";
import { MockERC20 } from "../../typechain-hardhat/contracts/test/MockERC20";

useChaiBigNumber();

export let deployer: string;
export let user1: string;
export let user2: string;
export let anyUser: string;

export let xctd: MockERC20 & Token;
export let someOtherToken: MockERC20 & Token;
export let uninsuredVesting: UninsuredVestingV1;

export const DAY = 60 * 60 * 24;
export const MONTH = DAY * 30;
export const VESTING_DURATION_SECONDS = DAY * 730;

export const XCTD_TOKENS_ON_SALE = 1_000_000;
export const USDC_TO_XCTD_RATIO = 7;
export const VESTING_PERIODS = 24;
export const LOCKUP_MONTHS = 6;
export const TOKENS_PER_USER = 10_000;

export async function withFixture() {
  deployer = await account(9);
  user1 = await account(0);
  user2 = await account(3);
  anyUser = await account(1);
  tag(deployer, "deployer");
  tag(user1, "user1");
  tag(user2, "user2");
  tag(anyUser, "anyUser");

  xctd = erc20("MockERC20", (await deployArtifact<MockERC20>("MockERC20", { from: deployer }, [bn18(1e9), "XCTD"])).options.address);
  someOtherToken = erc20("MockERC20", (await deployArtifact<MockERC20>("MockERC20", { from: deployer }, [bn18(1e9), "SomeOtherToken"])).options.address);
  uninsuredVesting = await deployArtifact<UninsuredVestingV1>("UninsuredVestingV1", { from: deployer }, [xctd.options.address, await getDefaultStartTime()]);

  await transferXctdToVesting();
}

export enum Error {
  StartTimeTooSoon = "StartTimeTooSoon",
  StartTimeNotInFuture = "StartTimeNotInFuture",
  VestingNotStarted = "VestingNotStarted",
  VestingAlreadyStarted = "VestingAlreadyStarted",
  NothingToClaim = "NothingToClaim",
}

export async function transferXctdToVesting() {
  await xctd.methods.transfer(uninsuredVesting.options.address, await xctd.amount(XCTD_TOKENS_ON_SALE)).send({ from: deployer });
}

export function advanceDays(days: number): Promise<BlockInfo> {
  return mineBlock(days * DAY);
}

export function advanceMonths(months: number): Promise<BlockInfo> {
  return mineBlock(months * MONTH);
}

export async function getCurrentTimestamp(): Promise<string | number | BN> {
  return (await web3().eth.getBlock("latest")).timestamp;
}

export async function getDefaultStartTime(): Promise<BN> {
  return await BN(await getCurrentTimestamp()).plus(MONTH * 6);
}
