import { Token, account, bn18, erc20, BlockInfo, Receipt, web3 } from "@defi.org/web3-candies";
import { deployArtifact, mineBlock, tag, useChaiBigNumber } from "@defi.org/web3-candies/dist/hardhat";
import BN from "bignumber.js";
import { UninsuredVestingV1 } from "../../typechain-hardhat/contracts/uninsured-vesting-v1/UninsuredVestingV1";
import { MockERC20 } from "../../typechain-hardhat/contracts/test/MockERC20";
import { config } from "../../deployment/uninsured-vesting-v1/config";

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
export const LOCKUP_MONTHS = 6;
export const TOKENS_PER_USER = 10_000;

export async function setup() {
  deployer = await account(9);
  user1 = await account(0);
  user2 = await account(3);
  anyUser = await account(1);
  tag(deployer, "deployer");
  tag(user1, "user1");
  tag(user2, "user2");
  tag(anyUser, "anyUser");
}

export async function withFixture() {
  xctd = erc20("MockERC20", (await deployArtifact<MockERC20>("MockERC20", { from: deployer }, [bn18(1e9), "XCTD"])).options.address);
  someOtherToken = erc20("MockERC20", (await deployArtifact<MockERC20>("MockERC20", { from: deployer }, [bn18(1e9), "SomeOtherToken"])).options.address);

  // TODO TEMPORARY: until having production XCTD address
  const testConfig = [...config];
  testConfig[0] = xctd.options.address;
  // END TEMPORARY

  uninsuredVesting = await deployArtifact<UninsuredVestingV1>("UninsuredVestingV1", { from: deployer }, testConfig);
}

export enum Error {
  ZeroAddress = "ZeroAddress",
  StartTimeTooSoon = "StartTimeTooSoon",
  StartTimeNotInFuture = "StartTimeNotInFuture",
  VestingNotStarted = "VestingNotStarted",
  VestingAlreadyStarted = "VestingAlreadyStarted",
  NothingToClaim = "NothingToClaim",
  NoAllocationsAdded = "NoAllocationsAdded",
  OnlyOwnerOrSender = "OnlyOwnerOrSender",
}

export async function transferXctdToVesting() {
  await xctd.methods.transfer(uninsuredVesting.options.address, await xctd.amount(XCTD_TOKENS_ON_SALE)).send({ from: deployer });
}

export async function approveXctdToVesting(amount = XCTD_TOKENS_ON_SALE) {
  await xctd.methods.approve(uninsuredVesting.options.address, await xctd.amount(amount)).send({ from: deployer });
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

export async function setAmountForUser1(amount = TOKENS_PER_USER) {
  await uninsuredVesting.methods.setAmount(user1, await xctd.amount(amount)).send({ from: deployer });
}

export async function setAmountForUser2(amount = TOKENS_PER_USER) {
  await uninsuredVesting.methods.setAmount(user2, await xctd.amount(amount)).send({ from: deployer });
}

export async function vestedAmount(days: number) {
  let amount = BN(TOKENS_PER_USER)
    .dividedBy(VESTING_DURATION_SECONDS)
    .multipliedBy(DAY * days);
  return xctd.amount(amount);
}
